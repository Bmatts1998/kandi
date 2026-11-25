"use strict";

// Unit tests for Kandi+ Stripe billing. Uses fixtures and a temp SQLite DB.
// Never prints secrets or connection strings.
process.env.DATABASE_URL = "";
process.env.SEED_ON_BOOT = "0";
process.env.STRIPE_SECRET_KEY = "";
process.env.STRIPE_WEBHOOK_SECRET = "";
process.env.STRIPE_PRICE_IDS = "";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");
const assert = require("node:assert/strict");
const { test, before, after, describe } = require("node:test");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-stripe-"));
const dbFile = path.join(tmpDir, "kandi.sqlite");
process.env.KANDI_SQLITE_PATH = dbFile;

const { open } = require("../src/db");
const billing = require("../src/stripe-billing");

const TEST_SECRET = "whsec_test_fixture_not_a_real_secret";
const PRICE = {
  plus_monthly: "price_plus_month_test",
  plus_yearly: "price_plus_year_test",
};

let db;

function sign(payload, secret, ts = Math.floor(Date.now() / 1000)) {
  const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const crypto = require("crypto");
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.`).update(raw).digest("hex");
  return `t=${ts},v1=${sig}`;
}

async function addUser(fields = {}) {
  const info = await db.prepare(
    `INSERT INTO users (username,password_hash,name,age) VALUES (?,?,?,?)`
  ).run(fields.username || ("u" + Math.random().toString(36).slice(2, 8)), "x", fields.name || "Test", fields.age || 24);
  const id = Number(info.lastInsertRowid || info.lastID || info.id);
  if (fields.subscription || fields.stripe_customer_id) {
    await db.prepare(
      `UPDATE users SET subscription=?, stripe_customer_id=?, stripe_subscription_id=?, stripe_price_id=?, subscription_status=? WHERE id=?`
    ).run(
      fields.subscription || null,
      fields.stripe_customer_id || null,
      fields.stripe_subscription_id || null,
      fields.stripe_price_id || null,
      fields.subscription_status || null,
      id
    );
  }
  return db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
}

before(async () => {
  db = await open();
});

after(async () => {
  try { if (db && db.close) await db.close(); } catch (_) {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

describe("config", () => {
  test("stays disabled without keys", () => {
    const cfg = billing.getConfig({ STRIPE_SECRET_KEY: "", STRIPE_PRICE_IDS: "" });
    assert.equal(cfg.enabled, false);
  });

  test("parses JSON and comma-separated price ids", () => {
    const json = billing.parsePriceIds(JSON.stringify(PRICE));
    assert.equal(json.plus_monthly, "price_plus_month_test");
    const csv = billing.parsePriceIds("plus_monthly:price_a, plus_yearly:price_b");
    assert.equal(csv.plus_monthly, "price_a");
    assert.equal(csv.plus_yearly, "price_b");
  });

  test("enables only when a secret and at least one price id are set", () => {
    const cfg = billing.getConfig({
      STRIPE_SECRET_KEY: "sk_test_xxx",
      STRIPE_PRICE_IDS: "plus_monthly:price_a",
    });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.prices.plus_monthly, "price_a");
  });
});

describe("signature", () => {
  test("accepts a valid Stripe-Signature and rejects a bad or stale one", () => {
    const payload = '{"id":"evt_1","type":"checkout.session.completed","data":{"object":{}}}';
    const header = sign(payload, TEST_SECRET);
    assert.equal(billing.verifyStripeSignature(payload, header, TEST_SECRET), true);
    assert.throws(() => billing.verifyStripeSignature(payload, header, "whsec_other"), { code: "bad_signature" });
    assert.throws(() => billing.verifyStripeSignature(payload, "t=1,v1=deadbeef", TEST_SECRET), { code: "bad_signature" });
    const old = sign(payload, TEST_SECRET, Math.floor(Date.now() / 1000) - 10_000);
    assert.throws(() => billing.verifyStripeSignature(payload, old, TEST_SECRET), { code: "bad_signature" });
  });
});

describe("public plans and iOS hiding", () => {
  const enabled = billing.getConfig({
    STRIPE_SECRET_KEY: "sk_test_xxx",
    STRIPE_PRICE_IDS: JSON.stringify(PRICE),
  });

  test("hides Stripe and payment amounts from the iOS client even when keys are set", () => {
    const plans = billing.publicPlans(enabled, { ios: true, priceDetails: { plus_monthly: { label: "$9.99", amount: 999, currency: "usd" } } });
    assert.equal(plans.paymentsEnabled, false);
    assert.equal(plans.store, "iap_coming_soon");
    const blob = JSON.stringify(plans).toLowerCase();
    assert.equal(blob.includes("stripe"), false);
    assert.equal(blob.includes("checkout.stripe"), false);
    assert.equal(blob.includes("http"), false);
    assert.equal(plans.store, "iap_coming_soon");
  });

  test("web stays hidden when keys are missing", () => {
    const plans = billing.publicPlans(billing.getConfig({}), { ios: false });
    assert.equal(plans.paymentsEnabled, false);
    assert.equal(plans.store, "disabled");
  });

  test("web exposes monthly/yearly plans when configured, without leaking price ids that look like checkout urls", () => {
    const plans = billing.publicPlans(enabled, {
      ios: false,
      priceDetails: { plus_monthly: { label: "$9.99", amount: 999, currency: "usd" }, plus_yearly: { label: "$79.99", amount: 7999, currency: "usd" } },
    });
    assert.equal(plans.paymentsEnabled, true);
    assert.equal(plans.store, "stripe");
    const monthly = plans.catalog.plans.find((x) => x.interval === "monthly");
    const yearly = plans.catalog.plans.find((x) => x.interval === "yearly");
    assert.ok(monthly);
    assert.ok(yearly);
    assert.equal(yearly.amount, 59.99);
  });

  test("iOS billing flags never offer a customer portal", () => {
    const flags = billing.publicBillingForUser(
      { stripe_customer_id: "cus_123", subscription: "plus", subscription_status: "active" },
      enabled,
      { ios: true }
    );
    assert.equal(flags.paymentsEnabled, false);
    assert.equal(flags.managed, false);
  });
});

describe("entitlement webhooks", () => {
  const config = billing.getConfig({
    STRIPE_SECRET_KEY: "sk_test_xxx",
    STRIPE_PRICE_IDS: JSON.stringify(PRICE),
  });

  test("checkout.session.completed grants Kandi+", async () => {
    const user = await addUser({ username: "checkoutgrant" });
    const result = await billing.handleStripeEvent(db, {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          payment_status: "paid",
          client_reference_id: String(user.id),
          customer: "cus_grant",
          subscription: "sub_grant",
          metadata: { userId: String(user.id), plan: "plus" },
        },
      },
    }, config);
    assert.equal(result.ok, true);
    assert.equal(result.granted, true);
    const got = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
    assert.equal(got.subscription, "plus");
    assert.equal(got.stripe_customer_id, "cus_grant");
    assert.equal(got.stripe_subscription_id, "sub_grant");
    assert.equal(got.subscription_status, "active");
  });

  test("customer.subscription.updated past_due keeps Kandi+", async () => {
    const user = await addUser({
      username: "pastdue",
      subscription: "plus",
      stripe_customer_id: "cus_due",
      stripe_subscription_id: "sub_due",
      subscription_status: "active",
    });
    const result = await billing.handleStripeEvent(db, {
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_due",
          status: "past_due",
          customer: "cus_due",
          metadata: { userId: String(user.id), plan: "plus" },
          items: { data: [{ price: { id: PRICE.plus_monthly } }] },
        },
      },
    }, config);
    assert.equal(result.granted, true);
    const got = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
    assert.equal(got.subscription, "plus");
    assert.equal(got.subscription_status, "past_due");
  });

  test("customer.subscription.deleted revokes Kandi+", async () => {
    const user = await addUser({
      username: "revoked",
      subscription: "plus",
      stripe_customer_id: "cus_del",
      stripe_subscription_id: "sub_del",
      subscription_status: "active",
    });
    await billing.handleStripeEvent(db, {
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_del",
          status: "canceled",
          customer: "cus_del",
          metadata: { userId: String(user.id) },
        },
      },
    }, config);
    const got = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
    assert.equal(got.subscription, null);
    assert.equal(got.subscription_status, "canceled");
    assert.equal(got.stripe_customer_id, "cus_del");
  });

  test("invoice.payment_failed marks past_due but does not revoke", async () => {
    const user = await addUser({
      username: "failedpay",
      subscription: "plus",
      stripe_customer_id: "cus_fail",
      stripe_subscription_id: "sub_fail",
      subscription_status: "active",
    });
    const result = await billing.handleStripeEvent(db, {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_fail", subscription: "sub_fail" } },
    }, config);
    assert.equal(result.granted, true);
    const got = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
    assert.equal(got.subscription, "plus");
    assert.equal(got.subscription_status, "past_due");
  });
});

describe("HTTP routes", () => {
  test("checkout and portal stay closed on iOS and work on the web with mocked Stripe", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
    process.env.STRIPE_PRICE_IDS = JSON.stringify(PRICE);
    process.env.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
    process.env.KANDI_PUBLIC_URL = "https://kandi.example";
    billing.resetPriceCache();

    const mockStripe = {
      checkout: { sessions: { create: async () => ({ id: "cs_test", url: "https://checkout.stripe.com/c/pay/cs_test" }) } },
      billingPortal: { sessions: { create: async () => ({ url: "https://billing.stripe.com/session/test" }) } },
      prices: { retrieve: async () => ({ unit_amount: 999, currency: "usd" }) },
    };
    billing.setStripeFactory(() => mockStripe);

    const user = await addUser({
      username: "httpuser",
      subscription: "plus",
      stripe_customer_id: "cus_http",
    });

    const app = express();
    billing.mountStripeWebhook(app, () => db);
    app.use(express.json({ limit: "1mb" }));
    const auth = (req, _res, next) => { req.user = user; next(); };
    const isNativeIosClient = (req) => {
      const h = String(req.headers["x-kandi-client"] || "").toLowerCase();
      if (h === "ios") return true;
      const ua = String(req.headers["user-agent"] || "");
      return /Capacitor/i.test(ua) && /iPhone|iPad|iPod/i.test(ua);
    };
    billing.installStripeBilling({
      app,
      getDb: () => db,
      auth,
      isNativeIosClient,
      publicUser: (u, extra) => ({ id: Number(u.id), subscription: u.subscription || null, ...(extra || {}) }),
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const port = server.address().port;

    function call(pathname, { method = "GET", headers = {}, body, raw = false } = {}) {
      return new Promise((resolve, reject) => {
        const payload = body == null ? null : (Buffer.isBuffer(body) ? body : Buffer.from((raw || typeof body === "string") ? String(body) : JSON.stringify(body)));
        const reqHeaders = Object.assign({}, headers);
        if (payload && !reqHeaders["content-type"]) reqHeaders["content-type"] = "application/json";
        if (payload) reqHeaders["content-length"] = Buffer.byteLength(payload);
        const req = http.request({ hostname: "127.0.0.1", port, path: pathname, method, headers: reqHeaders }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            const text = buf.toString("utf8");
            let json = null;
            try { json = JSON.parse(text); } catch (_) {}
            resolve({ status: res.statusCode, text, json });
          });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
      });
    }

    try {
      const iosPlans = await call("/api/plans", { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Capacitor/7.0.0" } });
      assert.equal(iosPlans.status, 200);
      assert.equal(iosPlans.json.paymentsEnabled, false);
      assert.equal(iosPlans.json.store, "iap_coming_soon");
      assert.equal(JSON.stringify(iosPlans.json).toLowerCase().includes("stripe"), false);

      const headerPlans = await call("/api/plans", { headers: { "x-kandi-client": "ios" } });
      assert.equal(headerPlans.json.paymentsEnabled, false);

      const webPlans = await call("/api/plans", { headers: { "user-agent": "Mozilla/5.0" } });
      assert.equal(webPlans.json.paymentsEnabled, true);
      assert.equal(webPlans.json.store, "stripe");

      const iosCheckout = await call("/api/billing/checkout", {
        method: "POST",
        headers: { "x-kandi-client": "ios", "content-type": "application/json" },
        body: { plan: "plus", interval: "monthly" },
      });
      assert.equal(iosCheckout.status, 403);
      assert.equal(iosCheckout.json.code, "plus_coming_soon");
      assert.ok(!iosCheckout.json.url);
      assert.equal(JSON.stringify(iosCheckout.json).includes("stripe.com"), false);

      const iosPortal = await call("/api/billing/portal", {
        method: "POST",
        headers: { "x-kandi-client": "ios", "content-type": "application/json" },
        body: {},
      });
      assert.equal(iosPortal.status, 403);
      assert.ok(!iosPortal.json.url);

      const webCheckout = await call("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { plan: "plus", interval: "monthly" },
      });
      assert.equal(webCheckout.status, 200);
      assert.equal(webCheckout.json.url, "https://checkout.stripe.com/c/pay/cs_test");

      const webPortal = await call("/api/billing/portal", { method: "POST", body: {} });
      assert.equal(webPortal.status, 200);
      assert.equal(webPortal.json.url, "https://billing.stripe.com/session/test");

      // Valid signed webhook grants plus to a fresh user.
      const fresh = await addUser({ username: "hookuser" });
      const event = {
        id: "evt_test_1",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            payment_status: "paid",
            client_reference_id: String(fresh.id),
            customer: "cus_hook",
            subscription: "sub_hook",
            metadata: { userId: String(fresh.id), plan: "plus" },
          },
        },
      };
      const payload = JSON.stringify(event);
      const okHook = await call("/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": sign(payload, TEST_SECRET), "content-type": "application/json" },
        body: payload,
        raw: true,
      });
      assert.equal(okHook.status, 200);
      const granted = await db.prepare("SELECT * FROM users WHERE id=?").get(fresh.id);
      assert.equal(granted.subscription, "plus");

      const badHook = await call("/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=nope", "content-type": "application/json" },
        body: payload,
        raw: true,
      });
      assert.equal(badHook.status, 400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      billing.setStripeFactory(null);
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_PRICE_IDS;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.KANDI_PUBLIC_URL;
    }
  });

  test("checkout is disabled when Stripe keys are missing", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_IDS;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    billing.setStripeFactory(null);
    billing.resetPriceCache();

    const user = await addUser({ username: "nokeys" });
    const app = express();
    billing.mountStripeWebhook(app, () => db);
    app.use(express.json({ limit: "1mb" }));
    billing.installStripeBilling({
      app,
      getDb: () => db,
      auth: (req, _res, next) => { req.user = user; next(); },
      isNativeIosClient: () => false,
      publicUser: (u) => ({ id: Number(u.id), subscription: u.subscription || null }),
    });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const port = server.address().port;
    try {
      const result = await new Promise((resolve, reject) => {
        const payload = Buffer.from(JSON.stringify({ plan: "plus", interval: "monthly" }));
        const req = http.request({
          hostname: "127.0.0.1",
          port,
          path: "/api/billing/checkout",
          method: "POST",
          headers: { "content-type": "application/json", "content-length": payload.length },
        }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
      });
      assert.equal(result.status, 503);
      assert.equal(result.json.code, "billing_disabled");
      assert.ok(!result.json.url);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
