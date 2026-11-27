"use strict";

// Find My Crew: membership rules, privacy, expiry, and the reusable API.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-crew-"));
process.env.KANDI_SQLITE_PATH = path.join(dir, "k.sqlite");
delete process.env.DATABASE_URL;

const express = require("express");
const { open } = require("../src/db");
const crew = require("../src/show-crew");

const HOUR = 3600 * 1000;
let db, server, base;
const sent = [];
const U = {};

async function addUser(username, age) {
  const r = await db.prepare(`INSERT INTO users (username, password_hash, name, age) VALUES (?,?,?,?)`).run(username, "x", username[0].toUpperCase() + username.slice(1), age || 25);
  U[username] = r.lastInsertRowid;
  return r.lastInsertRowid;
}
async function addEvent(id, startsAt, endsAt) {
  await db.prepare(`INSERT INTO events (id, name, city, date_label, venue, starts_at, ends_at, event_key) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, "Show " + id, "Denver", "Tonight", "Red Rocks", new Date(startsAt).toISOString(), endsAt ? new Date(endsAt).toISOString() : "", "key-" + id);
}
async function going(user, eventId) {
  await db.prepare(`INSERT INTO event_going (user_id, event_id, event_key) VALUES (?,?,?)`).run(U[user], eventId, "key-" + eventId);
}
async function match(a, b) {
  const [x, y] = U[a] < U[b] ? [U[a], U[b]] : [U[b], U[a]];
  await db.prepare(`INSERT INTO matches (a_id, b_id) VALUES (?,?)`).run(x, y);
}
async function follow(a, b) { await db.prepare(`INSERT INTO follows (follower_id, following_id) VALUES (?,?)`).run(U[a], U[b]); }
async function block(a, b) { await db.prepare(`INSERT INTO blocks (user_id, blocked_id) VALUES (?,?)`).run(U[a], U[b]); }

function as(user) {
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json", "x-test-user": String(U[user]) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

before(async () => {
  db = await open();
  const app = express();
  app.use(express.json());
  const auth = async (req, res, next) => {
    const u = await db.prepare(`SELECT * FROM users WHERE id=?`).get(Number(req.headers["x-test-user"]));
    if (!u) return res.status(401).json({ error: "Sign in required" });
    req.user = u; next();
  };
  const blockedSet = async (id) => {
    const rows = await db.prepare(`SELECT blocked_id AS id FROM blocks WHERE user_id=? UNION SELECT user_id AS id FROM blocks WHERE blocked_id=?`).all(id, id);
    return new Set(rows.map((r) => Number(r.id)));
  };
  const publicUser = (u) => ({ id: Number(u.id), name: u.name, username: u.username, photos: [] });
  crew.installShowCrew({ app, getDb: () => db, auth, publicUser, blockedSet, broadcastToUser: (id, p) => sent.push({ id: Number(id), ...p }) });
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = "http://127.0.0.1:" + server.address().port;

  for (const n of ["ava", "ben", "cam", "dee", "eli", "fay", "gus"]) await addUser(n);
  await addUser("kid", 16);
  const now = Date.now();
  await addEvent("tonight", now - 1 * HOUR, now + 3 * HOUR);
  await addEvent("later", now + 30 * 24 * HOUR);
  await addEvent("past", now - 72 * HOUR, now - 68 * HOUR);
  for (const n of ["ava", "ben", "cam", "dee", "eli", "fay", "kid"]) await going(n, "tonight");
  await going("ava", "later"); await going("ben", "later"); await going("ava", "past"); await going("ben", "past");
  await match("ava", "ben");            // match -> crew
  await follow("ava", "cam"); await follow("cam", "ava"); // mutual follow -> crew
  await follow("ava", "dee");           // one-way follow -> not crew
  await match("ava", "eli"); await block("eli", "ava"); // blocked -> hidden
  await match("ava", "gus");            // gus is not going
  await match("ava", "kid");            // under 18 -> excluded
  await match("ben", "fay");            // ben's crew only, not ava's
});

after(async () => {
  if (server) server.close();
  try { await db.close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("crew window", () => {
  test("expires at 6 AM Denver after the show ends", () => {
    // 9 PM MST Jan 10 2026 -> 04:00Z Jan 11; ends 1 AM MST -> expires 6 AM MST Jan 11 = 13:00Z
    const w = crew.crewWindow({ starts_at: "2026-01-11T04:00:00Z", ends_at: "2026-01-11T08:00:00Z" });
    assert.equal(new Date(w.expiresAt).toISOString(), "2026-01-11T13:00:00.000Z");
    assert.equal(new Date(w.opensAt).toISOString(), "2026-01-10T07:00:00.000Z"); // midnight MST Jan 10
  });
  test("defaults to a 4 hour show and handles daylight time", () => {
    // 8 PM MDT Jul 4 2026 = 02:00Z Jul 5; no end -> midnight -> 6 AM MDT Jul 5 = 12:00Z
    const w = crew.crewWindow({ starts_at: "2026-07-05T02:00:00Z" });
    assert.equal(new Date(w.expiresAt).toISOString(), "2026-07-05T12:00:00.000Z");
  });
  test("no start time means no crew", () => {
    assert.equal(crew.crewWindow({ starts_at: "" }), null);
  });
});

describe("membership and privacy", () => {
  test("only mutual friends and matches who are going, minus blocks and minors", async () => {
    const r = await as("ava")("GET", "/api/show-crew/tonight");
    assert.equal(r.status, 200);
    assert.equal(r.data.status, "active");
    const names = r.data.members.map((m) => m.user.username).sort();
    assert.deepEqual(names, ["ben", "cam"]);
  });
  test("crews are pairwise: ben sees ava and fay; fay does not see ava", async () => {
    const b = await as("ben")("GET", "/api/show-crew/tonight");
    assert.deepEqual(b.data.members.map((m) => m.user.username).sort(), ["ava", "fay"]);
    const f = await as("fay")("GET", "/api/show-crew/tonight");
    assert.deepEqual(f.data.members.map((m) => m.user.username), ["ben"]);
  });
  test("not going -> no crew data", async () => {
    const r = await as("gus")("GET", "/api/show-crew/tonight");
    assert.equal(r.data.status, "not_going");
    assert.equal(r.data.members.length, 0);
    const w = await as("gus")("POST", "/api/show-crew/tonight/note", { note: "rail" });
    assert.equal(w.status, 403);
  });
  test("future show is upcoming and refuses writes", async () => {
    const r = await as("ava")("GET", "/api/show-crew/later");
    assert.equal(r.data.status, "upcoming");
    const w = await as("ava")("POST", "/api/show-crew/later/note", { note: "x" });
    assert.equal(w.status, 409);
  });
});

describe("notes, location, pins, pings", () => {
  test("note is shared with the crew and broadcast", async () => {
    sent.length = 0;
    const r = await as("ava")("POST", "/api/show-crew/tonight/note", { note: "  rail   left side  " });
    assert.equal(r.status, 200);
    assert.equal(r.data.me.note, "rail left side");
    assert.deepEqual(sent.map((s) => s.id).sort((a, b) => a - b), [U.ben, U.cam].sort((a, b) => a - b));
    const b = await as("ben")("GET", "/api/show-crew/tonight");
    assert.equal(b.data.members.find((m) => m.user.username === "ava").note, "rail left side");
    const f = await as("fay")("GET", "/api/show-crew/tonight");
    assert.ok(!JSON.stringify(f.data).includes("rail left side"));
  });
  test("location is opt-in, rounded, and wiped on stop", async () => {
    const bad = await as("ava")("POST", "/api/show-crew/tonight/location", { lat: 200, lng: 0 });
    assert.equal(bad.status, 400);
    const r = await as("ava")("POST", "/api/show-crew/tonight/location", { lat: 39.66551234, lng: -105.20531234, accuracy: 12.4 });
    assert.equal(r.status, 200);
    assert.equal(r.data.me.sharing, true);
    const b = await as("ben")("GET", "/api/show-crew/tonight");
    const loc = b.data.members.find((m) => m.user.username === "ava").location;
    assert.equal(loc.lat, 39.6655); assert.equal(loc.lng, -105.2053); assert.equal(loc.accuracy, 12);
    const api = await crew.getLastLocation(db, U.ava, "tonight");
    assert.equal(api.lat, 39.6655);
    const stop = await as("ava")("POST", "/api/show-crew/tonight/location/stop");
    assert.equal(stop.data.me.sharing, false);
    assert.equal(await crew.getLastLocation(db, U.ava, "tonight"), null);
    await as("ava")("POST", "/api/show-crew/tonight/location", { lat: 39.6655, lng: -105.2053 });
  });
  test("meet-up pins: visible to crew, max 3 each, owner can delete", async () => {
    for (const label of ["Ferris wheel", "Merch tent", "Left speaker", "Water station"]) {
      const r = await as("ava")("POST", "/api/show-crew/tonight/pins", { label, lat: 39.66, lng: -105.2 });
      assert.equal(r.status, 200);
    }
    const b = await as("ben")("GET", "/api/show-crew/tonight");
    const labels = b.data.pins.map((p) => p.label);
    assert.equal(labels.length, 3);
    assert.ok(!labels.includes("Ferris wheel"));
    const mine = (await as("ava")("GET", "/api/show-crew/tonight")).data.pins.find((p) => p.label === "Merch tent");
    const nope = await as("ben")("DELETE", "/api/show-crew/tonight/pins/" + mine.id);
    assert.equal(nope.data.pins.length, 3);
    const del = await as("ava")("DELETE", "/api/show-crew/tonight/pins/" + mine.id);
    assert.equal(del.data.pins.length, 2);
    const f = await as("fay")("GET", "/api/show-crew/tonight");
    assert.equal(f.data.pins.filter((p) => p.by && p.by.username === "ava").length, 0);
  });
  test("I'm lost ping notifies the crew, is rate limited, and shows in notifications", async () => {
    sent.length = 0;
    const r = await as("cam")("POST", "/api/show-crew/tonight/lost", { note: "near the bathrooms" });
    assert.equal(r.status, 200);
    assert.equal(r.data.notified, 1);
    assert.deepEqual(sent.filter((s) => s.kind === "lost").map((s) => s.id), [U.ava]);
    const again = await as("cam")("POST", "/api/show-crew/tonight/lost", {});
    assert.equal(again.status, 429);
    const notifs = await crew.crewNotifications(db, U.ava);
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].kind, "crew_lost");
    assert.equal(notifs[0].fromId, U.cam);
    assert.equal((await crew.crewNotifications(db, U.ben)).length, 0);
    const ping = r.data.pings.find((p) => p.mine);
    const fixed = await as("cam")("POST", "/api/show-crew/tonight/pings/" + ping.id + "/resolve");
    assert.ok(fixed.data.pings.find((p) => p.id === ping.id).resolvedAt);
  });
});

describe("leave, block, expiry", () => {
  test("leaving hides you and wipes your data; rejoin restores", async () => {
    const r = await as("ava")("POST", "/api/show-crew/tonight/leave");
    assert.equal(r.data.me.left, true);
    assert.equal(r.data.members.length, 0);
    const b = await as("ben")("GET", "/api/show-crew/tonight");
    assert.ok(!b.data.members.some((m) => m.user.username === "ava"));
    assert.ok(!b.data.pins.some((p) => p.by && p.by.username === "ava"));
    assert.equal(await crew.getLastLocation(db, U.ava, "tonight"), null);
    const w = await as("ava")("POST", "/api/show-crew/tonight/note", { note: "x" });
    assert.equal(w.status, 409);
    const back = await as("ava")("POST", "/api/show-crew/tonight/rejoin");
    assert.equal(back.data.me.left, false);
    assert.equal(back.data.members.length, 2);
  });
  test("a new block hides both people from each other", async () => {
    await block("cam", "ava");
    const a = await as("ava")("GET", "/api/show-crew/tonight");
    assert.deepEqual(a.data.members.map((m) => m.user.username), ["ben"]);
    const c = await as("cam")("GET", "/api/show-crew/tonight");
    assert.equal(c.data.members.length, 0);
    assert.equal((await crew.crewNotifications(db, U.ava)).length, 0);
    await db.prepare(`DELETE FROM blocks WHERE user_id=? AND blocked_id=?`).run(U.cam, U.ava);
  });
  test("member status API is limited to crew pairs", async () => {
    await as("ava")("POST", "/api/show-crew/tonight/location", { lat: 39.6655, lng: -105.2053 });
    const ok = await as("ben")("GET", "/api/show-crew/tonight/members/" + U.ava);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.member, true);
    assert.equal(ok.data.location.lat, 39.6655);
    const no = await as("fay")("GET", "/api/show-crew/tonight/members/" + U.ava);
    assert.equal(no.status, 403);
    assert.equal(await crew.isCrewPair(db, U.ben, U.ava, "tonight"), true);
    assert.equal(await crew.isCrewPair(db, U.fay, U.ava, "tonight"), false);
    assert.deepEqual((await crew.crewMemberIds(db, U.ava, "tonight")).sort(), [U.ben, U.cam].sort());
  });
  test("ended shows return nothing and the sweeper deletes location data", async () => {
    const r = await as("ava")("GET", "/api/show-crew/past");
    assert.equal(r.data.status, "ended");
    assert.equal(r.data.members.length, 0);
    const later = Date.now() + 48 * HOUR;
    assert.equal(await crew.getLastLocation(db, U.ava, "tonight", { now: later }), null);
    const n = await crew.sweepExpired(db, later);
    assert.ok(n >= 2);
    const rows = await db.prepare(`SELECT COUNT(*) AS c FROM crew_show_status`).get();
    assert.equal(Number(rows.c), 0);
    const pins = await db.prepare(`SELECT COUNT(*) AS c FROM crew_show_pins`).get();
    assert.equal(Number(pins.c), 0);
  });
  test("today lists only active crews", async () => {
    const r = await as("ava")("GET", "/api/show-crew/today");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.crews.map((c) => c.event.id), ["tonight"]);
    assert.equal(r.data.crews[0].memberCount, 2);
  });
});
