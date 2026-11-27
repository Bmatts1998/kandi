"use strict";

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const safety = require("../src/safety");

function startServer(extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-safety-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", KANDI_SQLITE_PATH: path.join(dir, "k.sqlite"), SEED_ON_BOOT: "0", ...extraEnv };
  delete env.DATABASE_URL;
  for (const k of ["RENDER", "RENDER_SERVICE_ID", "RENDER_GIT_COMMIT", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "GMAIL_REFRESH_TOKEN", "EMAIL_PROVIDER", "EMAIL_VERIFICATION", "KANDI_PUBLIC_URL"]) {
    if (!(k in (extraEnv || {}))) delete env[k];
  }
  const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const base = "http://127.0.0.1:" + port;
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start:\n" + out)), 60000);
    const iv = setInterval(() => {
      if (/listening on/.test(out)) { clearInterval(iv); clearTimeout(t); resolve(); }
    }, 100);
  });
  return { child, base, dir, ready, log: () => out, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function client(base) {
  const jar = new Map();
  function cookieHeader() {
    return Array.from(jar.entries()).map(([k, v]) => k + "=" + v).join("; ");
  }
  return async function call(method, url, body) {
    const headers = { "Content-Type": "application/json" };
    const existing = cookieHeader();
    if (existing) headers.Cookie = existing;
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    for (const line of raw) {
      const pair = String(line || "").split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

function signupBody(username, name) {
  return { username, password: "test-pass-123", name: name || "Tester", age: 25, acceptedTerms: true, email: username + "@example.com", meetIntent: "both" };
}

async function openDb(file) {
  process.env.KANDI_SQLITE_PATH = file;
  delete process.env.DATABASE_URL;
  const resolved = require.resolve("../src/db");
  delete require.cache[resolved];
  const { open } = require("../src/db");
  return open();
}

describe("safety schedule helpers", () => {
  test("nextMorningEnd is 8am local the following morning after 8am", () => {
    // 9:30pm MT on Nov 27, 2026 is 4:30am UTC on Nov 28
    const start = Date.parse("2026-11-28T04:30:00Z");
    const end = safety.nextMorningEnd(start, "America/Denver");
    assert.equal(new Date(end).toISOString(), "2026-11-28T15:00:00.000Z"); // 8am MT
  });

  test("a check started at 2am ends at 8am the same morning", () => {
    const start = Date.parse("2026-11-28T09:00:00Z"); // 2am MT
    const end = safety.nextMorningEnd(start, "America/Denver");
    assert.equal(new Date(end).toISOString(), "2026-11-28T15:00:00.000Z");
  });

  test("invalid time zones fall back to America/Denver", () => {
    assert.equal(safety.validTimeZone("Not/A_Zone"), "America/Denver");
    assert.equal(safety.validTimeZone("Pacific/Honolulu"), "Pacific/Honolulu");
  });
});

describe("safety check-in HTTP + missed logic", () => {
  let srv, owner, buddy, stranger, evId;

  before(async () => {
    srv = startServer({ NODE_ENV: "production", EMAIL_VERIFICATION: "off", EMAIL_PROVIDER: "none" });
    await srv.ready;
    owner = client(srv.base);
    buddy = client(srv.base);
    stranger = client(srv.base);
    const a = await owner("POST", "/api/signup", signupBody("safe_owner", "Nova"));
    const b = await buddy("POST", "/api/signup", signupBody("safe_buddy", "Hex"));
    const c = await stranger("POST", "/api/signup", signupBody("safe_stranger", "Riot"));
    assert.equal(a.status, 200, JSON.stringify(a.data));
    assert.equal(b.status, 200, JSON.stringify(b.data));
    assert.equal(c.status, 200, JSON.stringify(c.data));
    owner.id = a.data.user.id;
    buddy.id = b.data.user.id;
    stranger.id = c.data.user.id;

    const ev = await owner("POST", "/api/like", { userId: buddy.id, type: "photo", targetId: "0" });
    assert.equal(ev.status, 200, JSON.stringify(ev.data));
    const match = await buddy("POST", "/api/like", { userId: owner.id, type: "photo", targetId: "0" });
    assert.equal(match.status, 200, JSON.stringify(match.data));
    assert.ok(match.data.matched, "expected a match so they can be buddies");

    // Make a show they can attach the check to, using the sqlite file directly.
    const db = await openDb(srv.dir + "/k.sqlite");
    evId = "safety-test-show";
    await db.prepare(`INSERT OR REPLACE INTO events (id, name, city, date_label, venue, starts_at, status) VALUES (?,?,?,?,?,?,?)`)
      .run(evId, "Test Rave", "Salt Lake City", "Tonight", "The Depot", new Date(Date.now() + 3600000).toISOString(), "active");
    if (typeof db.close === "function") await db.close();
  });

  after(() => { if (srv) srv.stop(); });

  test("starting a check requires an eligible buddy and is not paywalled", async () => {
    const none = await owner("POST", "/api/safety", { scheduleKind: "interval", intervalMinutes: 120, buddyIds: [] });
    assert.equal(none.status, 400);
    const notFriend = await owner("POST", "/api/safety", { scheduleKind: "interval", intervalMinutes: 120, buddyIds: [stranger.id] });
    assert.equal(notFriend.status, 400);

    const buddies = await owner("GET", "/api/safety/buddies");
    assert.equal(buddies.status, 200);
    assert.ok((buddies.data.people || []).some((p) => Number(p.id) === Number(buddy.id)));
    assert.ok(!(buddies.data.people || []).some((p) => Number(p.id) === Number(stranger.id)));

    const started = await owner("POST", "/api/safety", {
      scheduleKind: "interval",
      intervalMinutes: 120,
      buddyIds: [buddy.id],
      eventId: evId,
      locationNote: "rail, left side",
      timezone: "America/Denver",
    });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    assert.ok(started.data.check && started.data.check.id);
    assert.equal(started.data.check.status, "active");
    assert.equal(started.data.check.locationNote, "rail, left side");
    assert.ok(String(started.data.disclaimer || started.data.check.disclaimer).toLowerCase().includes("not an emergency"));
    assert.ok((started.data.check.buddies || []).some((p) => Number(p.id) === Number(buddy.id)));

    const again = await owner("POST", "/api/safety", { scheduleKind: "interval", intervalMinutes: 120, buddyIds: [buddy.id] });
    assert.equal(again.status, 409);

    const incoming = await buddy("GET", "/api/safety");
    assert.equal(incoming.status, 200);
    assert.ok((incoming.data.incoming || []).some((a) => a.kind === "safety_started"));
    assert.ok((incoming.data.incoming || []).some((a) => /Nova/.test(a.text)));
  });

  test("I'm good moves the next interval due time", async () => {
    const cur = await owner("GET", "/api/safety");
    const check = cur.data.check;
    assert.ok(check);
    const db = await openDb(srv.dir + "/k.sqlite");
    const soon = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    await db.prepare(`UPDATE safety_checks SET due_at=? WHERE id=?`).run(soon, check.id);
    if (typeof db.close === "function") await db.close();
    const ok = await owner("POST", "/api/safety/" + check.id + "/checkin", { locationNote: "by the Ferris wheel" });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const after = Date.parse(ok.data.check.dueAt);
    assert.ok(after - Date.now() > 60 * 60 * 1000, "due time should reset to about the next interval, got " + ok.data.check.dueAt);
    assert.ok(ok.data.check.lastCheckinAt, "expected lastCheckinAt");
    assert.equal(ok.data.check.locationNote, "by the Ferris wheel");
  });

  test("a missed check-in plus grace alerts buddies once (idempotent)", async () => {
    const cur = await owner("GET", "/api/safety");
    const check = cur.data.check;
    const db = await openDb(srv.dir + "/k.sqlite");
    const due = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await db.prepare(`UPDATE safety_checks SET due_at=?, grace_minutes=15, missed_window=NULL WHERE id=?`).run(due, check.id);

    const first = await safety.processDueChecks(db, Date.now());
    assert.ok(first.missed >= 1, "expected a missed alert, got " + JSON.stringify(first));
    const second = await safety.processDueChecks(db, Date.now());
    assert.equal(second.missed, 0, "second sweep must be idempotent: " + JSON.stringify(second));
    if (typeof db.close === "function") await db.close();

    const inbox = await buddy("GET", "/api/safety");
    const missed = (inbox.data.incoming || []).filter((a) => a.kind === "safety_missed");
    assert.equal(missed.length, 1, JSON.stringify(inbox.data.incoming));
    assert.match(missed[0].text, /missed a safety check-in/i);
    assert.match(missed[0].text, /Ferris wheel|rail|Test Rave/i);
    assert.ok(missed[0].eventLabel);

    const notifs = await buddy("GET", "/api/notifications");
    assert.ok((notifs.data.notifications || []).some((n) => n.kind === "safety_missed" && /Nova/.test((n.user && n.user.name) || "") || /missed/.test(n.text || "")),
      JSON.stringify(notifs.data.notifications));
  });

  test("I need help alerts buddies immediately and 911 is advertised", async () => {
    const cur = await owner("GET", "/api/safety");
    const help = await owner("POST", "/api/safety/" + cur.data.check.id + "/help", { locationNote: "lost near bathrooms" });
    assert.equal(help.status, 200, JSON.stringify(help.data));
    assert.equal(help.data.emergency.href, "tel:911");
    assert.ok(/911/.test(help.data.disclaimer) || /911/.test(JSON.stringify(help.data)));
    const inbox = await buddy("GET", "/api/safety");
    const alerts = (inbox.data.incoming || []).filter((a) => a.kind === "safety_help");
    assert.ok(alerts.length >= 1);
    assert.match(alerts[0].text, /need help/i);
    assert.match(alerts[0].text, /bathrooms/i);
  });

  test("blocks stop new alerts, and the owner can end the check", async () => {
    const cur = await owner("GET", "/api/safety");
    await buddy("POST", "/api/block", { userId: owner.id, reason: "test" });
    const help = await owner("POST", "/api/safety/" + cur.data.check.id + "/help", { locationNote: "still lost" });
    assert.equal(help.status, 200);
    assert.equal(help.data.alerted, 0);

    const ended = await owner("POST", "/api/safety/" + cur.data.check.id + "/end", {});
    assert.equal(ended.status, 200, JSON.stringify(ended.data));
    const after = await owner("GET", "/api/safety");
    assert.equal(after.data.check, null);
  });

  test("a check past ends_at is auto-ended the next morning", async () => {
    // Unblock so they can be buddies again, then start a fresh check and expire it.
    await buddy("POST", "/api/blocks/" + owner.id + "/unblock", {});
    await owner("POST", "/api/like", { userId: buddy.id, type: "photo", targetId: "0" });
    const rematch = await buddy("POST", "/api/like", { userId: owner.id, type: "photo", targetId: "0" });
    assert.ok(rematch.data.matched || rematch.status === 200, JSON.stringify(rematch.data));
    const started = await owner("POST", "/api/safety", {
      scheduleKind: "interval",
      intervalMinutes: 30,
      buddyIds: [buddy.id],
      eventId: evId,
      timezone: "America/Denver",
    });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const db = await openDb(srv.dir + "/k.sqlite");
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    await db.prepare(`UPDATE safety_checks SET ends_at=? WHERE id=?`).run(past, started.data.check.id);
    const result = await safety.processDueChecks(db, Date.now());
    assert.ok(result.ended >= 1, JSON.stringify(result));
    const row = await db.prepare(`SELECT status, ended_reason FROM safety_checks WHERE id=?`).get(started.data.check.id);
    assert.equal(row.status, "ended");
    assert.equal(row.ended_reason, "morning");
    if (typeof db.close === "function") await db.close();
    const mine = await owner("GET", "/api/safety");
    assert.equal(mine.data.check, null);
  });
});
