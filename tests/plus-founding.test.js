"use strict";

process.env.DATABASE_URL = "";
process.env.SEED_ON_BOOT = "0";
process.env.KANDI_FOUNDING_CAP = "3";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("node:assert/strict");
const { test, before, after, describe } = require("node:test");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-plus-"));
const dbFile = path.join(tmpDir, "kandi.sqlite");
process.env.KANDI_SQLITE_PATH = dbFile;

const { open } = require("../src/db");
const founding = require("../src/founding");
const plusPlans = require("../src/plus-plans");
const billing = require("../src/stripe-billing");

let db;
async function addUser(fields = {}) {
  const info = await db.prepare(
    `INSERT INTO users (username,password_hash,name,age,date_of_birth,home_location,is_demo,created_at) VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    fields.username || ("u" + Math.random().toString(36).slice(2, 8)),
    "x",
    fields.name || "Test",
    fields.age || 24,
    fields.date_of_birth || null,
    fields.home_location || null,
    fields.is_demo || 0,
    fields.created_at || new Date().toISOString()
  );
  return db.prepare(`SELECT * FROM users WHERE id=?`).get(Number(info.lastInsertRowid));
}

before(async () => { db = await open(); });
after(async () => {
  try { if (db && db.close) await db.close(); } catch (_) {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

describe("prices", () => {
  test("yearly is $59.99 and confirmed, with the other published rates", () => {
    assert.equal(plusPlans.PLANS.plus_monthly.amount, 7.99);
    assert.equal(plusPlans.PLANS.plus_3mo.amount, 19.99);
    assert.equal(plusPlans.PLANS.plus_6mo.amount, 34.99);
    assert.equal(plusPlans.PLANS.plus_yearly.amount, 59.99);
    assert.equal(plusPlans.PLANS.plus_yearly.confirmed, true);
    assert.equal(plusPlans.PLANS.founding_monthly.amount, 4.99);
    const catalog = plusPlans.publicCatalog({ ios: true });
    assert.equal(catalog.yearlyConfirmed, true);
    assert.equal(catalog.payments.websiteReady, false);
    assert.equal(catalog.payments.iapComingSoon, true);
    assert.equal(catalog.plans.length, 0);
    assert.equal(catalog.founding.available, false);
    assert.equal(JSON.stringify(catalog).includes("stripe.com"), false);
    assert.equal(/\$\d/.test(JSON.stringify(catalog)), false);
  });
});

describe("eligibility", () => {
  test("accepts Salt Lake and Utah County cities and ZIPs, rejects elsewhere", () => {
    assert.equal(founding.isSlcMetro("Springville, UT"), true);
    assert.equal(founding.isSlcMetro("salt lake city"), true);
    assert.equal(founding.isSlcMetro("Provo"), true);
    assert.equal(founding.isSlcMetro("84663"), true);
    assert.equal(founding.isSlcMetro("84101"), true);
    assert.equal(founding.isSlcMetro("Lehi, Utah"), true);
    assert.equal(founding.isSlcMetro("Utah County"), true);
    assert.equal(founding.isSlcMetro("Ogden, UT"), false);
    assert.equal(founding.isSlcMetro("Utah"), false);
    assert.equal(founding.isSlcMetro("Denver, CO"), false);
  });

  test("18+ is computed from date of birth", () => {
    const now = new Date("2026-11-25T00:00:00Z");
    assert.equal(founding.isAdultDob("2008-11-25", now), true);
    assert.equal(founding.isAdultDob("2008-11-26", now), false);
    assert.equal(founding.parseDob("2000-13-01"), null);
  });
});

describe("founding cap", () => {
  test("grants plus and a badge, then enforces the cap atomically", async () => {
    const a = await addUser({ username: "f1", date_of_birth: "1998-01-15", home_location: "Springville, UT" });
    const b = await addUser({ username: "f2", date_of_birth: "1999-05-05", home_location: "SLC 84101" });
    const c = await addUser({ username: "f3", date_of_birth: "2000-03-03", home_location: "Lehi" });
    const d = await addUser({ username: "f4", date_of_birth: "2001-04-04", home_location: "Provo" });
    const r1 = await founding.claimFounding(db, a, { env: process.env });
    const r2 = await founding.claimFounding(db, b, { env: process.env });
    const r3 = await founding.claimFounding(db, c, { env: process.env });
    const r4 = await founding.claimFounding(db, d, { env: process.env });
    assert.equal(r1.granted, true);
    assert.equal(r2.granted, true);
    assert.equal(r3.granted, true);
    assert.equal(r4.reason, "full");
    const one = await db.prepare(`SELECT * FROM users WHERE id=?`).get(a.id);
    assert.equal(Number(one.is_founder), 1);
    assert.equal(Number(one.founding_number), 1);
    assert.equal(one.subscription, "plus");
    assert.ok(Date.parse(one.plus_until) > Date.now());
    const status = await founding.spots(db, process.env);
    assert.equal(status.claimed, 3);
    assert.equal(status.left, 0);
    assert.equal(status.open, false);
  });

  test("backfill grants the first accounts by sign-up order, skips demos and appreview, and leaves paid Stripe alone", async () => {
    await db.prepare(`UPDATE founding_meta SET claimed=0, cap=3 WHERE id=1`).run();
    await db.prepare(`UPDATE users SET is_founder=0, founding_number=NULL`).run();
    const demo = await addUser({ username: "bfdemo", is_demo: 1, created_at: "2019-01-01T00:00:00.000Z" });
    let review = await db.prepare(`SELECT * FROM users WHERE lower(username)='appreview'`).get();
    if (!review) review = await addUser({ username: "appreview", created_at: "2019-01-02T00:00:00.000Z" });
    else await db.prepare(`UPDATE users SET created_at='2019-01-02T00:00:00.000Z', is_demo=0, is_founder=0, founding_number=NULL WHERE id=?`).run(review.id);

    const early = await addUser({ username: "earlybird", created_at: "2019-01-03T00:00:00.000Z" });
    const paid = await addUser({ username: "paying", created_at: "2019-01-04T00:00:00.000Z" });
    const mid = await addUser({ username: "midbird", created_at: "2019-01-05T00:00:00.000Z" });
    const after = await addUser({ username: "aftercap", created_at: "2019-01-06T00:00:00.000Z" });
    try { await db.exec(`ALTER TABLE users ADD COLUMN subscription_status TEXT`); } catch (_) {}
    await db.prepare(`UPDATE users SET subscription_status='active', subscription='plus' WHERE id=?`).run(paid.id);
    const result = await founding.backfillFounders(db, { env: process.env });
    assert.equal(result.granted, 3);
    assert.ok((result.leftPaid || []).some((u) => u.username === "paying"));
    const earlyRow = await db.prepare(`SELECT * FROM users WHERE id=?`).get(early.id);
    const paidRow = await db.prepare(`SELECT * FROM users WHERE id=?`).get(paid.id);
    const midRow = await db.prepare(`SELECT * FROM users WHERE id=?`).get(mid.id);
    const afterRow = await db.prepare(`SELECT * FROM users WHERE id=?`).get(after.id);
    const reviewRow = await db.prepare(`SELECT * FROM users WHERE id=?`).get(review.id);
    const demoRow = await db.prepare(`SELECT * FROM users WHERE id=?`).get(demo.id);
    assert.equal(Number(earlyRow.is_founder), 1);
    assert.ok(Date.parse(earlyRow.plus_until) > Date.now());
    assert.equal(Number(paidRow.is_founder), 1);
    assert.equal(paidRow.subscription_status, "active");
    assert.ok(!paidRow.plus_until);
    assert.equal(Number(midRow.is_founder), 1);
    assert.equal(Number(afterRow.is_founder) || 0, 0);
    assert.equal(Number(reviewRow.is_founder) || 0, 0);
    assert.equal(Number(demoRow.is_founder) || 0, 0);
  });

  test("demo and App Review accounts are not eligible; location is not required", async () => {
    const demo = await addUser({ username: "demodude", date_of_birth: "1995-01-01", home_location: "Salt Lake City", is_demo: 1 });
    let review = await db.prepare(`SELECT * FROM users WHERE lower(username)='appreview'`).get();
    if (!review) review = await addUser({ username: "appreview", date_of_birth: "1995-01-01", home_location: "Salt Lake City" });
    const rDemo = await founding.claimFounding(db, demo, { env: process.env });
    const rReview = await founding.claimFounding(db, review, { env: process.env });
    assert.equal(rDemo.reason, "demo");
    assert.equal(rReview.reason, "review");
  });
});

describe("billing catalog for iOS", () => {
  test("iOS catalog hides prices, Stripe, and checkout even when keys are set", () => {
    const cfg = billing.getConfig({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_IDS: "plus_monthly:price_a" });
    const plans = billing.publicPlans(cfg, { ios: true });
    assert.equal(plans.paymentsEnabled, false);
    assert.equal(plans.store, "iap_coming_soon");
    assert.equal(plans.yearlyConfirmed, true);
    assert.deepEqual(plans.catalog.plans, []);
    assert.equal(plans.catalog.founding.available, false);
    const blob = JSON.stringify(plans).toLowerCase();
    assert.equal(blob.includes("stripe"), false);
    assert.equal(blob.includes("checkout"), false);
    assert.equal(/\$\d/.test(blob), false);
  });
});
