"use strict";
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { eventHappensOn, dayStamp, parseDesign, cleanCode, TZ } = require("../src/trade-routes");

describe("trade helpers", () => {
  test("dayStamp is YYYY-MM-DD in the given zone", () => {
    // 2026-11-27 09:30 MT is 16:30 UTC
    const d = new Date("2026-11-27T16:30:00Z");
    assert.equal(dayStamp(d, "America/Denver"), "2026-11-27");
    // late evening MT is already the next day in UTC
    const late = new Date("2026-11-28T05:30:00Z"); // 10:30pm Nov 27 MT
    assert.equal(dayStamp(late, "America/Denver"), "2026-11-27");
  });

  test("eventHappensOn covers same-day, multi-day, and late-night sets", () => {
    const day = "2026-11-27";
    assert.equal(eventHappensOn({ starts_at: "2026-11-27T20:00:00-07:00" }, day), true);
    assert.equal(eventHappensOn({ starts_at: "2026-11-25T20:00:00-07:00" }, day), false);
    // late-night warehouse with no ends_at: 10pm Nov 26 lasts 8 hours into Nov 27
    assert.equal(eventHappensOn({ starts_at: "2026-11-26T22:00:00-07:00" }, day), true);
    // multi-day festival
    assert.equal(eventHappensOn({
      starts_at: "2026-11-26T14:00:00-07:00",
      ends_at: "2026-11-28T23:00:00-07:00",
    }, day), true);
    assert.equal(eventHappensOn({
      starts_at: "2026-11-20T14:00:00-07:00",
      ends_at: "2026-11-22T23:00:00-07:00",
    }, day), false);
    assert.equal(eventHappensOn({ starts_at: "" }, day), false);
  });

  test("parseDesign validates beads, style, word, and filtered text", () => {
    const ok = parseDesign({ style: "sunset", beads: ["#ff5c00", "#ff8a1a", "#ffc14d", "#fff7f0", "#111111"], word: "plur!!", message: "see you at rail" });
    assert.ok(ok.design);
    assert.equal(ok.design.word, "PLUR!!");
    assert.equal(ok.design.beads.length, 5);
    assert.equal(parseDesign({ style: "classic", beads: ["#fff"], word: "HI" }).error.includes("beads"), true);
    assert.ok(parseDesign({ style: "nope", beads: ["#ff5c00", "#ff8a1a", "#ffc14d", "#fff7f0", "#111111"] }).error);
    const bad = parseDesign({ style: "classic", beads: ["#ff5c00", "#ff8a1a", "#ffc14d", "#fff7f0", "#111111"], message: "child porn" });
    assert.ok(bad.error);
  });

  test("cleanCode strips separators and uppercases", () => {
    assert.equal(cleanCode("ab-12 cd"), "AB12CD");
  });
});

describe("digital kandi trades API", () => {
  let child, base, dir, sqlitePath;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-trade-"));
    sqlitePath = path.join(dir, "k.sqlite");
    const port = 20000 + Math.floor(Math.random() * 20000);
    base = "http://127.0.0.1:" + port;
    const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", KANDI_SQLITE_PATH: sqlitePath, NODE_ENV: "production", KANDI_PUBLIC_URL: "https://kandi.example" };
    delete env.DATABASE_URL;
    child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(out || "server start timeout")), 60000);
      const iv = setInterval(() => { if (/listening on/.test(out)) { clearInterval(iv); clearTimeout(t); resolve(); } }, 100);
    });
  });
  after(() => { child && child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

  function client() {
    let cookie = "";
    return async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const list = typeof r.headers.getSetCookie === "function"
        ? r.headers.getSetCookie()
        : String(r.headers.get("set-cookie") || "").split(/,(?=\s*kandi_)/);
      for (const c of list) {
        if (/^kandi_sid=/i.test(String(c).trim())) cookie = String(c).trim().split(";")[0];
      }
      return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
    };
  }
  async function signup(name) {
    const c = client();
    const r = await c("POST", "/api/signup", { username: name, password: "pass-12345", name: "N " + name, age: 25, acceptedTerms: true, email: name + "@example.com" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { c, id: r.data.user.id, user: r.data.user };
  }
  function design(word, extra) {
    return Object.assign({ style: "classic", beads: ["#ff5c00", "#ff8a1a", "#ffc14d", "#fff7f0", "#111111", "#ff3d9a"], word, message: "rail left" }, extra || {});
  }
  function insertTodayEvent(id, name) {
    const db = new DatabaseSync(sqlitePath);
    const start = new Date();
    // 8pm today in America/Denver, expressed as ISO with offset -07 or -06
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(start);
    const y = parts.find((p) => p.type === "year").value;
    const m = parts.find((p) => p.type === "month").value;
    const d = parts.find((p) => p.type === "day").value;
    const starts = `${y}-${m}-${d}T20:00:00-07:00`;
    const ends = `${y}-${m}-${d}T23:30:00-07:00`;
    db.prepare(`INSERT INTO events (id, name, city, date_label, venue, starts_at, ends_at, status, is_example, emoji) VALUES (?,?,?,?,?,?,?,?,0,?)`)
      .run(id, name, "Salt Lake City", "Tonight", "The Depot", starts, ends, "active", "🧡");
    db.close();
    return id;
  }

  test("full trade: code + confirm, collection, hide, blocked join, own code rejected", async () => {
    const a = await signup("tr_alice_" + Date.now().toString(36).slice(-5));
    const b = await signup("tr_bob_" + Date.now().toString(36).slice(-5));
    const evId = "trade-show-" + Date.now();
    insertTodayEvent(evId, "Neon Warehouse");
    const ga = await a.c("POST", "/api/events/" + evId + "/going", { going: true });
    const gb = await b.c("POST", "/api/events/" + evId + "/going", { going: true });
    assert.equal(ga.status, 200, JSON.stringify(ga.data));
    assert.equal(gb.status, 200, JSON.stringify(gb.data));

    const created = await a.c("POST", "/api/trades/offers", {});
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const offer = created.data.offer;
    assert.ok(offer.code && offer.code.length === 6, offer.code);
    assert.equal(offer.status, "open");
    assert.equal(offer.role, "host");
    assert.match(offer.qrPayload, /https:\/\/kandi\.example\/t\/[A-Z0-9]{6}/);
    // auto-detected today's shared-capable show for the host
    assert.equal(offer.event && offer.event.id, evId, JSON.stringify(offer.event));

    const own = await a.c("POST", "/api/trades/offers/" + offer.code + "/join", {});
    assert.equal(own.status, 400);

    const joined = await b.c("POST", "/api/trades/offers/" + offer.code.toLowerCase() + "/join", {});
    assert.equal(joined.status, 200, JSON.stringify(joined.data));
    assert.equal(joined.data.offer.status, "joined");
    assert.equal(joined.data.offer.role, "guest");
    assert.equal(joined.data.offer.host.id, a.id);
    assert.equal(joined.data.offer.event.id, evId);

    const readyA = await a.c("POST", "/api/trades/offers/" + offer.id + "/ready", { design: design("PLUR") });
    assert.equal(readyA.status, 200, JSON.stringify(readyA.data));
    assert.equal(readyA.data.completed, false);
    assert.equal(readyA.data.offer.hostReady, true);

    const readyB = await b.c("POST", "/api/trades/offers/" + offer.id + "/ready", { design: design("RAVE", { style: "sunset", message: "by the ferris wheel" }) });
    assert.equal(readyB.status, 200, JSON.stringify(readyB.data));
    assert.equal(readyB.data.completed, true);
    assert.equal(readyB.data.offer.status, "completed");
    assert.equal(readyB.data.offer.theirs.word, "PLUR");
    assert.equal(readyB.data.offer.mine.word, "RAVE");

    const colA = await a.c("GET", "/api/trades/collection");
    const colB = await b.c("GET", "/api/trades/collection?userId=" + a.id);
    assert.equal(colA.status, 200, JSON.stringify(colA.data));
    assert.equal(colA.data.items.length, 1);
    assert.equal(colA.data.items[0].word, "RAVE");
    assert.equal(colA.data.items[0].from.id, b.id);
    assert.equal(colA.data.items[0].event.name, "Neon Warehouse");
    assert.equal(colA.data.items[0].message, "by the ferris wheel");
    assert.equal(colB.data.items.length, 1);
    assert.equal(colB.data.items[0].word, "RAVE");

    const itemId = colA.data.items[0].id;
    const hid = await a.c("POST", "/api/trades/items/" + itemId + "/hide", { hidden: true });
    assert.equal(hid.status, 200);
    assert.equal(hid.data.item.hidden, true);
    const asB = await b.c("GET", "/api/trades/collection?userId=" + a.id);
    assert.equal(asB.data.items.length, 0, "hidden kandi is omitted for others");
    const asA = await a.c("GET", "/api/trades/collection");
    assert.equal(asA.data.items.length, 1);
    assert.equal(asA.data.items[0].hidden, true);

    // blocked users cannot start a trade with each other
    const c = await signup("tr_carl_" + Date.now().toString(36).slice(-5));
    await a.c("POST", "/api/block", { userId: c.id, reason: "test" });
    const offer2 = await c.c("POST", "/api/trades/offers", {});
    assert.equal(offer2.status, 200);
    const blockedJoin = await a.c("POST", "/api/trades/offers/" + offer2.data.offer.code + "/join", {});
    assert.equal(blockedJoin.status, 403);
  });

  test("today-shows lists a show the user is going to today", async () => {
    const u = await signup("tr_show_" + Date.now().toString(36).slice(-5));
    const evId = "trade-today-" + Date.now();
    insertTodayEvent(evId, "Das Energi");
    await u.c("POST", "/api/events/" + evId + "/going", { going: true });
    const r = await u.c("GET", "/api/trades/today-shows");
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.shows.some((s) => s.id === evId), JSON.stringify(r.data));
  });

  test("/t/:code redirects into the app with the trade query", async () => {
    const r = await fetch(base + "/t/AB12CD", { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/?trade=AB12CD");
  });
});
