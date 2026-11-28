"use strict";

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const end = require("../src/event-end");

describe("event over-at rule", () => {
  test("uses ends_at when a real clock time is set", () => {
    const ev = { starts_at: "2026-11-27T21:00:00-07:00", ends_at: "2026-11-28T02:00:00-07:00" };
    assert.equal(new Date(end.eventOverAt(ev)).toISOString(), "2026-11-28T09:00:00.000Z");
    assert.equal(end.eventIsOver(ev, Date.parse("2026-11-28T08:59:59.000Z")), false);
    assert.equal(end.eventIsOver(ev, Date.parse("2026-11-28T09:00:00.000Z")), true);
  });

  test("date-only ends_at hides at 6 AM MT the morning after that date", () => {
    // Last day Aug 8, 2027 (MDT) -> 6 AM Aug 9 = 12:00Z
    const ev = { starts_at: "2027-08-06T16:00:00-06:00", ends_at: "2027-08-08" };
    assert.equal(new Date(end.eventOverAt(ev)).toISOString(), "2027-08-09T12:00:00.000Z");
  });

  test("club night with no ends_at lasts 8 hours from start", () => {
    // 9 PM MST Nov 27 -> 5 AM MST Nov 28 = 12:00Z
    const ev = { starts_at: "2026-11-27T21:00:00-07:00" };
    assert.equal(new Date(end.eventOverAt(ev)).toISOString(), "2026-11-28T12:00:00.000Z");
    assert.equal(end.eventIsListed(ev, Date.parse("2026-11-28T11:59:00.000Z")), true);
    assert.equal(end.eventIsListed(ev, Date.parse("2026-11-28T12:00:00.000Z")), false);
  });

  test("8 hour default also applies in MDT", () => {
    // 9 PM MDT Jul 4 2026 = 03:00Z Jul 5; +8h = 11:00Z Jul 5 (5 AM MDT)
    const ev = { starts_at: "2026-07-04T21:00:00-06:00" };
    assert.equal(new Date(end.eventOverAt(ev)).toISOString(), "2026-07-05T11:00:00.000Z");
  });

  test("time TBA / 11:59 PM start hides at 6 AM MT the next morning", () => {
    // Das Energi style: Fri Aug 6, 2027 11:59 PM MDT, time TBA -> 6 AM MDT Aug 7 = 12:00Z
    const ev = { starts_at: "2027-08-06T23:59:00-06:00", time_tba: 1 };
    assert.equal(new Date(end.eventOverAt(ev)).toISOString(), "2027-08-07T12:00:00.000Z");
    const ev2 = { startsAt: "2027-08-06T23:59:00-06:00" };
    assert.equal(new Date(end.eventOverAt(ev2)).toISOString(), "2027-08-07T12:00:00.000Z");
  });

  test("date-only start with no end hides at 6 AM MT the next morning", () => {
    const ev = { starts_at: "2026-11-28" };
    // 6 AM MST Nov 29 = 13:00Z
    assert.equal(new Date(end.eventOverAt(ev)).toISOString(), "2026-11-29T13:00:00.000Z");
  });

  test("time TBA in winter uses MST 6 AM", () => {
    const ev = { starts_at: "2026-01-10T23:59:00-07:00", timeTba: true };
    // 6 AM MST Jan 11 = 13:00Z
    assert.equal(new Date(end.eventOverAt(ev)).toISOString(), "2026-01-11T13:00:00.000Z");
  });

  test("a show stays listed while it is in progress", () => {
    const ev = { starts_at: "2026-11-27T21:00:00-07:00", ends_at: "2026-11-28T02:00:00-07:00" };
    const during = Date.parse("2026-11-28T06:00:00.000Z"); // 11 PM MST
    assert.equal(end.eventIsListed(ev, during), true);
  });

  test("removed, past status, and examples are not listed", () => {
    const future = { starts_at: "2028-01-01T20:00:00-07:00", status: "removed" };
    const marked = { starts_at: "2028-01-01T20:00:00-07:00", status: "past" };
    const sample = { starts_at: "2028-01-01T20:00:00-07:00", is_example: 1 };
    assert.equal(end.eventIsListed(future), false);
    assert.equal(end.eventIsListed(marked), false);
    assert.equal(end.eventIsListed(sample), false);
  });

  test("shows with no start or end stay listed", () => {
    assert.equal(end.eventIsListed({ name: "TBA" }), true);
    assert.equal(end.eventOverAt({ name: "TBA" }), null);
  });

  test("camelCase field names work the same as snake_case", () => {
    const a = end.eventOverAt({ startsAt: "2026-11-27T19:30:00-07:00", endsAt: "2026-11-27T23:00:00-07:00" });
    const b = end.eventOverAt({ starts_at: "2026-11-27T19:30:00-07:00", ends_at: "2026-11-27T23:00:00-07:00" });
    assert.equal(a, b);
  });

  test("2 AM on the start date rolls overnight to the next morning", () => {
    const ev = { starts_at: "2026-11-27T22:00:00-07:00", ends_at: "2026-11-27T02:00:00-07:00" };
    assert.equal(new Date(end.eventOverAt(ev)).toISOString(), "2026-11-28T09:00:00.000Z");
    assert.equal(end.eventIsOver(ev, Date.parse("2026-11-28T08:59:00.000Z")), false);
    assert.equal(end.eventIsOver(ev, Date.parse("2026-11-28T09:00:00.000Z")), true);
  });

  test("an end time more than a day before start means the show is already over", () => {
    const ev = { starts_at: "2026-12-05T20:00:00-07:00", ends_at: "2026-11-20T02:00:00-07:00" };
    assert.equal(end.eventIsOver(ev, Date.parse("2026-11-28T12:00:00.000Z")), true);
  });

  test("parseAdminEndsAt reads Denver wall time and can be cleared", () => {
    const cleared = end.parseAdminEndsAt("");
    assert.equal(cleared.ok, true);
    assert.equal(cleared.value, "");
    const local = end.parseAdminEndsAt("2026-11-28T02:00");
    assert.equal(local.ok, true);
    assert.equal(local.value, "2026-11-28T09:00:00.000Z");
    const day = end.parseAdminEndsAt("2027-08-08");
    assert.equal(day.ok, true);
    assert.equal(day.value, "2027-08-08");
    const bad = end.parseAdminEndsAt("nope");
    assert.equal(bad.ok, false);
  });
});

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-ended-"));
  const dbPath = path.join(dir, "k.sqlite");
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", KANDI_SQLITE_PATH: dbPath, SEED_ON_BOOT: "0", NODE_ENV: "production" };
  delete env.DATABASE_URL;
  for (const k of ["RENDER", "RENDER_SERVICE_ID", "RENDER_GIT_COMMIT", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "GMAIL_REFRESH_TOKEN", "EMAIL_PROVIDER", "EMAIL_VERIFICATION", "KANDI_PUBLIC_URL"]) {
    delete env[k];
  }
  const child = spawn(process.execPath, [path.join(__dirname, "..", "src/server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
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
  return { child, base, dbPath, ready, log: () => out, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function client(base) {
  const jar = new Map();
  return async function call(method, url, body, headers) {
    const h = { "Content-Type": "application/json", ...(headers || {}) };
    const existing = Array.from(jar.entries()).map(([k, v]) => k + "=" + v).join("; ");
    if (existing) h.Cookie = existing;
    const res = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    for (const line of raw) {
      const pair = String(line || "").split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

function signupBody(username, extra) {
  return Object.assign({ username, password: "test-pass-123", name: username[0].toUpperCase() + username.slice(1), age: 25, acceptedTerms: true, email: username + "@example.com", meetIntent: "both" }, extra || {});
}

function insertEvent(dbPath, row) {
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.prepare(`
    INSERT INTO events (id, event_key, name, city, date_label, venue, genres, artists, emoji, color, is_example, category, starts_at, ends_at, status, time_tba)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,'active',?)
  `).run(
    row.id, row.key || row.id, row.name, "Salt Lake City", row.date || "", row.venue || "The Complex",
    "[]", "[]", "🎧", "", row.category || "rave", row.starts_at || "", row.ends_at || "", row.time_tba ? 1 : 0
  );
  raw.close();
}

describe("ended shows leave user-facing lists", () => {
  let srv, boston, alice;
  before(async () => {
    srv = startServer();
    await srv.ready;
    // Frozen "now" is whenever the test runs. Use relative times plus a couple of fixed past SLC shows.
    const now = Date.now();
    insertEvent(srv.dbPath, {
      id: "past-krush",
      name: "Krush",
      venue: "The Depot",
      date: "Wed, Nov 25 · 10:00 PM",
      starts_at: "2026-11-25T22:00:00-07:00",
    });
    insertEvent(srv.dbPath, {
      id: "past-yheti",
      name: "Yheti b2b Toadface",
      venue: "Soundwell",
      date: "Fri, Nov 27 · 9:00 PM",
      starts_at: "2026-11-27T21:00:00-07:00",
    });
    insertEvent(srv.dbPath, {
      id: "live-now",
      name: "Live Right Now",
      starts_at: new Date(now - 2 * 3600 * 1000).toISOString(),
      ends_at: new Date(now + 3 * 3600 * 1000).toISOString(),
    });
    insertEvent(srv.dbPath, {
      id: "future-halo",
      name: "Halo Retro Disco",
      starts_at: new Date(now + 24 * 3600 * 1000).toISOString(),
    });
    insertEvent(srv.dbPath, {
      id: "just-ended",
      name: "Just Ended",
      starts_at: new Date(now - 9 * 3600 * 1000).toISOString(),
      // no ends_at: default start+8h, started 9h ago so it's over
    });
    insertEvent(srv.dbPath, {
      id: "tba-fest",
      name: "Future Fest",
      starts_at: "2027-08-06T23:59:00-06:00",
      time_tba: 1,
    });
    boston = client(srv.base);
    alice = client(srv.base);
    let r = await boston("POST", "/api/signup", signupBody("boston"));
    assert.equal(r.status, 200, r.data.error);
    r = await alice("POST", "/api/signup", signupBody("endedalice"));
    assert.equal(r.status, 200, r.data.error);
  });
  after(() => srv && srv.stop());

  test("GET /api/events hides shows the moment they are over, keeps live and upcoming", async () => {
    const r = await alice("GET", "/api/events");
    assert.equal(r.status, 200, r.data.error);
    const ids = (r.data.events || []).map((e) => e.id);
    assert.ok(!ids.includes("past-krush"), "Krush should be gone");
    assert.ok(!ids.includes("past-yheti"), "Yheti Nov 27 should be gone");
    assert.ok(!ids.includes("just-ended"), "start+8h ended show should be gone");
    assert.ok(ids.includes("live-now"), "in-progress show should stay");
    assert.ok(ids.includes("future-halo"), "upcoming show should stay");
    assert.ok(ids.includes("tba-fest"), "future time-TBA fest should stay");
    const live = (r.data.events || []).find((e) => e.id === "live-now");
    assert.ok(live.overAt);
    assert.equal(live.isPast, false);
  });

  test("admins can still see past shows, marked Past", async () => {
    const r = await boston("GET", "/api/events?includePast=1");
    assert.equal(r.status, 200, r.data.error);
    const ids = (r.data.events || []).map((e) => e.id);
    assert.ok(ids.includes("past-krush"));
    assert.ok(ids.includes("just-ended"));
    const past = (r.data.events || []).find((e) => e.id === "past-krush");
    assert.equal(past.isPast, true);
    const regular = await alice("GET", "/api/events?includePast=1");
    const regularIds = (regular.data.events || []).map((e) => e.id);
    assert.ok(!regularIds.includes("past-krush"), "non-admins do not get past shows");
  });

  test("a single past event can still be opened by id", async () => {
    const r = await alice("GET", "/api/events/past-krush");
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.event.id, "past-krush");
    assert.equal(r.data.event.isPast, true);
    assert.equal(r.data.event.name, "Krush");
  });

  test("you cannot mark yourself going to a show that already ended", async () => {
    const r = await alice("POST", "/api/events/past-yheti/going", { going: true });
    assert.equal(r.status, 410);
    assert.match(String(r.data.error || ""), /ended/i);
  });

  test("upcoming shows on the profile drop ended RSVPs and keep live ones", async () => {
    let r = await alice("POST", "/api/events/live-now/going", { going: true });
    assert.equal(r.status, 200, r.data.error);
    r = await alice("POST", "/api/events/future-halo/going", { going: true });
    assert.equal(r.status, 200, r.data.error);
    // Force an RSVP row onto a past show (as if they went last night).
    const raw = new DatabaseSync(srv.dbPath);
    raw.prepare(`INSERT INTO event_going (user_id, event_id, event_key) VALUES ((SELECT id FROM users WHERE username='endedalice'), 'past-krush', 'past-krush')`).run();
    raw.close();
    r = await alice("GET", "/api/me");
    assert.equal(r.status, 200, r.data.error);
    const upcoming = (r.data.user && r.data.user.upcomingShows) || r.data.upcomingShows || [];
    const ids = upcoming.map((e) => e.id);
    assert.ok(ids.includes("live-now"), "live show stays on Upcoming");
    assert.ok(ids.includes("future-halo"), "future show stays on Upcoming");
    assert.ok(!ids.includes("past-krush"), "past show must leave Upcoming");
  });

  test("admin can set and clear ends_at", async () => {
    const futureStart = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    insertEvent(srv.dbPath, { id: "admin-end", name: "Admin End", starts_at: futureStart });
    let r = await boston("PATCH", "/api/admin/events/admin-end", { endsAt: "2026-11-20T02:00" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.event.isPast, true);
    assert.ok(r.data.event.endsAt);
    r = await alice("GET", "/api/events");
    assert.ok(!(r.data.events || []).some((e) => e.id === "admin-end"));
    r = await boston("PATCH", "/api/admin/events/admin-end", { endsAt: "" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.event.endsAt, "");
    assert.equal(r.data.event.isPast, false);
    r = await alice("GET", "/api/events");
    assert.ok((r.data.events || []).some((e) => e.id === "admin-end"));
  });
});
