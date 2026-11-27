"use strict";

// Find My Crew: a temporary, per-show crew for people marked going.
//
// Who is in my crew for a show?
//   Everyone who (1) has an event_going RSVP for that show, (2) is a match of
//   mine or a mutual follow (we follow each other), (3) has not blocked me and
//   I have not blocked them, (4) is 18+, and (5) has not left the show's crew.
//   Crews are ego-centric and pairwise: you see someone's note, location, pins
//   and "I'm lost" pings only when both of you are going, connected, unblocked
//   and still in the crew. There is no "friend of a friend" visibility.
//
// When is it open?
//   From midnight (America/Denver) on the show's start day (or 12 hours before
//   start, whichever is earlier) until 6 AM Denver after the show ends. Without
//   ends_at, a show is assumed to run 4 hours. After that, every crew row for
//   the show (notes, GPS, pins, pings) is deleted by the sweeper and is never
//   returned by the API even before the sweeper runs.
//
// Location is opt-in. Browser geolocation is rounded to ~11 m (4 decimals) and
// only the latest point is kept per person per show. Stopping sharing or
// leaving the crew wipes it immediately.
//
// -------------------------------------------------------------------------
// Reusable API (for the Safety buddy check-in and other features)
// -------------------------------------------------------------------------
// In-process (require("./show-crew")):
//   crewWindow(eventRow)                       -> { opensAt, expiresAt } (ms) or null
//   getCrewSnapshot(db, viewerId, eventIdOrKey, { blockedSet })
//        -> { status: "active"|"upcoming"|"ended"|"not_going"|"no_time"|"not_found",
//             event, opensAt, expiresAt, me, members[], pins[], pings[] }
//   crewMemberIds(db, userId, eventIdOrKey, { blockedSet }) -> [userId, ...]
//        (the user's current crew for the show, excluding themselves; [] when closed)
//   isCrewPair(db, viewerId, targetId, eventIdOrKey, { blockedSet }) -> boolean
//   getLastLocation(db, userId, eventIdOrKey)
//        -> { lat, lng, accuracy, at, note } or null (null when not sharing / expired)
//   getCrewMemberStatus(db, viewerId, targetId, eventIdOrKey, { blockedSet })
//        -> { member: boolean, user, note, location|null, expiresAt } (location only for crew pairs)
//   notifyCrew(ctx, userId, event, payload)    -> broadcast a WS payload to the user's crew
//
// HTTP (all require a signed-in session):
//   GET  /api/show-crew/today                         active crews for shows I'm going to (home banner)
//   GET  /api/show-crew/:eventId                      full snapshot (shape above)
//   GET  /api/show-crew/:eventId/members/:userId      { member, user, note, location, expiresAt }
//                                                 403 unless viewer is that user or a crew pair
//   POST /api/show-crew/:eventId/note        { note }                 short location note (<= 60 chars)
//   POST /api/show-crew/:eventId/location    { lat, lng, accuracy }   opt-in GPS update
//   POST /api/show-crew/:eventId/location/stop                        stop sharing + wipe GPS
//   POST /api/show-crew/:eventId/pins        { label, lat?, lng? }    meet-up pin (max 3 each)
//   DELETE /api/show-crew/:eventId/pins/:pinId
//   POST /api/show-crew/:eventId/lost        { note? }                "I'm lost" ping to the crew
//   POST /api/show-crew/:eventId/pings/:pingId/resolve                mark my ping found
//   POST /api/show-crew/:eventId/leave | /rejoin
// WebSocket payload to crew members on any change:
//   { type: "show-crew", eventId, kind: "note"|"location"|"pin"|"lost"|"found"|"leave"|"join", from }

const crypto = require("crypto");
const { resolveEvent, isAdult } = require("./meetup");

const TZ = "America/Denver";
const HOUR = 3600 * 1000;
const DEFAULT_SHOW_HOURS = 4;
const MAX_NOTE = 60;
const MAX_PIN_LABEL = 40;
const MAX_PINS_EACH = 3;
const LOST_COOLDOWN_MS = 60 * 1000;
const LOCATION_FRESH_MS = 30 * 60 * 1000;

// ---------- time helpers (America/Denver) ----------
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function tzParts(ms) {
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}
function tzOffset(ms) {
  const p = tzParts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - (Math.floor(ms / 1000) * 1000);
}
// Wall-clock time in Denver -> epoch ms. Day overflow (d+1) is normalized by Date.UTC.
function zoned(y, m, d, h) {
  const guess = Date.UTC(y, m - 1, d, h || 0);
  const off = tzOffset(guess);
  let t = guess - off;
  const off2 = tzOffset(t);
  if (off2 !== off) t = guess - off2;
  return t;
}
function nextSixAm(ms) {
  const p = tzParts(ms);
  let t = zoned(p.y, p.m, p.d, 6);
  if (t <= ms) t = zoned(p.y, p.m, p.d + 1, 6);
  return t;
}
function parseTime(v) {
  if (!v) return NaN;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
}

function crewWindow(ev) {
  if (!ev) return null;
  const start = parseTime(ev.starts_at || ev.startsAt);
  if (!Number.isFinite(start)) return null;
  let end = parseTime(ev.ends_at || ev.endsAt);
  if (!Number.isFinite(end) || end < start) end = start;
  end = Math.max(end, start + DEFAULT_SHOW_HOURS * HOUR);
  const p = tzParts(start);
  const opensAt = Math.min(zoned(p.y, p.m, p.d, 0), start - 12 * HOUR);
  return { opensAt, expiresAt: nextSixAm(end) };
}
function windowStatus(win, now) {
  if (!win) return "no_time";
  if (now < win.opensAt) return "upcoming";
  if (now >= win.expiresAt) return "ended";
  return "active";
}

// ---------- small helpers ----------
const iso = (ms) => new Date(ms).toISOString();
const clip = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
function roundCoord(v) { return Math.round(Number(v) * 1e4) / 1e4; }
function validLat(v) { const n = Number(v); return v !== null && v !== "" && Number.isFinite(n) && n >= -90 && n <= 90; }
function validLng(v) { const n = Number(v); return v !== null && v !== "" && Number.isFinite(n) && n >= -180 && n <= 180; }
function num(v) { return v == null || v === "" ? null : Number(v); }
function newId() { return crypto.randomBytes(9).toString("base64url"); }

async function defaultBlockedSet(db, userId) {
  const rows = await db.prepare(`SELECT blocked_id AS id FROM blocks WHERE user_id=? UNION SELECT user_id AS id FROM blocks WHERE blocked_id=?`).all(userId, userId);
  return new Set(rows.map((r) => Number(r.id)));
}

async function connectedIds(db, userId) {
  const me = Number(userId);
  const out = new Set();
  const ms = await db.prepare(`SELECT a_id, b_id FROM matches WHERE a_id=? OR b_id=?`).all(me, me);
  for (const m of ms) out.add(Number(m.a_id) === me ? Number(m.b_id) : Number(m.a_id));
  const fs = await db.prepare(`SELECT f1.following_id AS id FROM follows f1 JOIN follows f2 ON f2.follower_id = f1.following_id AND f2.following_id = f1.follower_id WHERE f1.follower_id=?`).all(me);
  for (const f of fs) out.add(Number(f.id));
  out.delete(me);
  return out;
}

async function goingUserIds(db, ev) {
  let key = ev.event_key || "";
  if (!key) { try { key = require("./event-key").eventKey(ev) || ""; } catch (_) { key = ""; } }
  const rows = key
    ? await db.prepare(`SELECT DISTINCT user_id FROM event_going WHERE event_id=? OR event_key=?`).all(ev.id, key)
    : await db.prepare(`SELECT DISTINCT user_id FROM event_going WHERE event_id=?`).all(ev.id);
  return new Set(rows.map((r) => Number(r.user_id)));
}

function isAgeBlocked(u) {
  try { return require("./age-check").isUnder18(u); } catch (_) { return false; }
}

async function statusRow(db, eventId, userId) {
  return db.prepare(`SELECT * FROM crew_show_status WHERE event_id=? AND user_id=?`).get(eventId, Number(userId));
}

// Core membership resolution shared by every reader.
async function resolveCrew(db, viewerId, eventIdOrKey, opts) {
  const now = (opts && opts.now) || Date.now();
  const ev = typeof eventIdOrKey === "object" && eventIdOrKey ? eventIdOrKey : await resolveEvent(db, eventIdOrKey);
  if (!ev || ev.is_example || String(ev.status || "active") === "removed") return { status: "not_found", ev: null };
  const win = crewWindow(ev);
  const status = windowStatus(win, now);
  const going = await goingUserIds(db, ev);
  const me = Number(viewerId);
  const imGoing = going.has(me);
  const base = { ev, win, status, imGoing, memberIds: [] };
  if (!imGoing) return { ...base, status: status === "ended" ? "ended" : "not_going" };
  const myRow = await statusRow(db, ev.id, me);
  const iLeft = Boolean(myRow && myRow.left_at);
  base.myRow = myRow;
  base.iLeft = iLeft;
  if (status !== "active" && status !== "upcoming") return base;
  const blocked = opts && opts.blockedSet ? await opts.blockedSet(me) : await defaultBlockedSet(db, me);
  const conn = await connectedIds(db, me);
  const candidates = [...conn].filter((id) => going.has(id) && !blocked.has(id));
  if (!candidates.length || iLeft) return base;
  const leftRows = await db.prepare(`SELECT user_id FROM crew_show_status WHERE event_id=? AND left_at IS NOT NULL`).all(ev.id);
  const left = new Set(leftRows.map((r) => Number(r.user_id)));
  const ids = [];
  for (const id of candidates) {
    if (left.has(id)) continue;
    const u = await db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
    if (!u || !isAdult(u) || isAgeBlocked(u)) continue;
    ids.push(id);
  }
  base.memberIds = ids;
  return base;
}

function shapeEvent(ev) {
  if (!ev) return null;
  return {
    id: ev.id,
    name: ev.name,
    venue: ev.venue || "",
    city: ev.city || "",
    date: ev.date_label || "",
    startsAt: ev.starts_at || "",
    endsAt: ev.ends_at || "",
    emoji: ev.emoji || "",
    color: ev.color || "",
    imageUrl: ev.image_url || "",
    address: ev.address || "",
  };
}

function shapeLocation(row, now) {
  if (!row || !Number(row.sharing) || row.lat == null || row.lng == null || !row.loc_at) return null;
  const at = parseTime(row.loc_at);
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy: num(row.accuracy),
    at: row.loc_at,
    fresh: Number.isFinite(at) && now - at < LOCATION_FRESH_MS,
  };
}

function miniUser(u, publicUser) {
  if (!u) return null;
  if (publicUser) {
    const p = publicUser(u);
    return { id: p.id, name: p.name, username: p.username, photos: (p.photos || []).slice(0, 1), avatar: p.avatar };
  }
  return { id: Number(u.id), name: u.name, username: u.username, photos: [] };
}

async function getCrewSnapshot(db, viewerId, eventIdOrKey, opts) {
  const now = (opts && opts.now) || Date.now();
  const publicUser = opts && opts.publicUser;
  const r = await resolveCrew(db, viewerId, eventIdOrKey, opts);
  const out = {
    status: r.status,
    event: shapeEvent(r.ev),
    opensAt: r.win ? iso(r.win.opensAt) : null,
    expiresAt: r.win ? iso(r.win.expiresAt) : null,
    me: null,
    members: [],
    pins: [],
    pings: [],
  };
  if (!r.ev || !r.imGoing) return out;
  const myRow = r.myRow;
  out.me = {
    id: Number(viewerId),
    left: Boolean(r.iLeft),
    note: myRow && !myRow.left_at ? String(myRow.note || "") : "",
    noteAt: myRow ? myRow.note_at || null : null,
    sharing: Boolean(myRow && Number(myRow.sharing)),
    location: r.status === "active" ? shapeLocation(myRow, now) : null,
  };
  if (r.status !== "active" && r.status !== "upcoming") return out;
  const visible = [Number(viewerId), ...r.memberIds];
  const memberRows = [];
  for (const id of r.memberIds) {
    const u = await db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
    const s = await statusRow(db, r.ev.id, id);
    memberRows.push({ u, s });
  }
  out.members = memberRows.map(({ u, s }) => ({
    user: miniUser(u, publicUser),
    note: s ? String(s.note || "") : "",
    noteAt: s ? s.note_at || null : null,
    location: r.status === "active" ? shapeLocation(s, now) : null,
    lastSeenAt: s ? s.updated_at || null : null,
  })).sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));
  if (r.iLeft || r.status !== "active") return out;
  const nowIso = iso(now);
  const marks = visible.map(() => "?").join(",");
  const users = new Map(memberRows.map(({ u }) => [Number(u.id), u]));
  const meRow = await db.prepare(`SELECT * FROM users WHERE id=?`).get(Number(viewerId));
  if (meRow) users.set(Number(meRow.id), meRow);
  const pins = await db.prepare(`SELECT * FROM crew_show_pins WHERE event_id=? AND expires_at > ? AND user_id IN (${marks}) ORDER BY created_at DESC`).all(r.ev.id, nowIso, ...visible);
  out.pins = pins.map((p) => ({
    id: p.id,
    label: p.label,
    lat: num(p.lat),
    lng: num(p.lng),
    at: p.created_at,
    mine: Number(p.user_id) === Number(viewerId),
    by: miniUser(users.get(Number(p.user_id)), publicUser),
  }));
  const pings = await db.prepare(`SELECT * FROM crew_show_pings WHERE event_id=? AND expires_at > ? AND user_id IN (${marks}) ORDER BY created_at DESC LIMIT 20`).all(r.ev.id, nowIso, ...visible);
  out.pings = pings.map((p) => ({
    id: p.id,
    kind: p.kind || "lost",
    note: p.note || "",
    lat: num(p.lat),
    lng: num(p.lng),
    at: p.created_at,
    resolvedAt: p.resolved_at || null,
    mine: Number(p.user_id) === Number(viewerId),
    by: miniUser(users.get(Number(p.user_id)), publicUser),
  }));
  return out;
}

async function crewMemberIds(db, userId, eventIdOrKey, opts) {
  const r = await resolveCrew(db, userId, eventIdOrKey, opts);
  return r.status === "active" && !r.iLeft ? r.memberIds.slice() : [];
}

async function isCrewPair(db, viewerId, targetId, eventIdOrKey, opts) {
  if (Number(viewerId) === Number(targetId)) return false;
  const ids = await crewMemberIds(db, viewerId, eventIdOrKey, opts);
  return ids.includes(Number(targetId));
}

async function getLastLocation(db, userId, eventIdOrKey, opts) {
  const now = (opts && opts.now) || Date.now();
  const ev = typeof eventIdOrKey === "object" && eventIdOrKey ? eventIdOrKey : await resolveEvent(db, eventIdOrKey);
  if (!ev) return null;
  if (windowStatus(crewWindow(ev), now) !== "active") return null;
  const row = await statusRow(db, ev.id, userId);
  if (!row || row.left_at) return null;
  const loc = shapeLocation(row, now);
  return loc ? { ...loc, note: String(row.note || "") } : null;
}

async function getCrewMemberStatus(db, viewerId, targetId, eventIdOrKey, opts) {
  const now = (opts && opts.now) || Date.now();
  const publicUser = opts && opts.publicUser;
  const ev = await resolveEvent(db, eventIdOrKey);
  if (!ev) return { member: false };
  const self = Number(viewerId) === Number(targetId);
  const member = self || (await isCrewPair(db, viewerId, targetId, ev, opts));
  if (!member) return { member: false };
  const win = crewWindow(ev);
  const row = await statusRow(db, ev.id, targetId);
  const u = await db.prepare(`SELECT * FROM users WHERE id=?`).get(Number(targetId));
  return {
    member: true,
    user: miniUser(u, publicUser),
    event: shapeEvent(ev),
    note: row && !row.left_at ? String(row.note || "") : "",
    location: await getLastLocation(db, targetId, ev, { now }),
    expiresAt: win ? iso(win.expiresAt) : null,
  };
}

async function upsertStatus(db, ev, userId, fields, now) {
  const win = crewWindow(ev);
  const nowIso = iso(now || Date.now());
  const existing = await statusRow(db, ev.id, userId);
  const row = Object.assign({
    note: "", note_at: null, lat: null, lng: null, accuracy: null, loc_at: null, sharing: 0, left_at: null,
  }, existing || {}, fields, { expires_at: iso(win.expiresAt), updated_at: nowIso });
  await db.prepare(`INSERT INTO crew_show_status (event_id, user_id, note, note_at, lat, lng, accuracy, loc_at, sharing, left_at, expires_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (event_id, user_id) DO UPDATE SET note=excluded.note, note_at=excluded.note_at, lat=excluded.lat, lng=excluded.lng,
      accuracy=excluded.accuracy, loc_at=excluded.loc_at, sharing=excluded.sharing, left_at=excluded.left_at,
      expires_at=excluded.expires_at, updated_at=excluded.updated_at`)
    .run(ev.id, Number(userId), row.note || "", row.note_at, row.lat, row.lng, row.accuracy, row.loc_at, Number(row.sharing) ? 1 : 0, row.left_at, row.expires_at, row.updated_at);
}

async function sweepExpired(db, now) {
  const nowIso = iso(now || Date.now());
  let n = 0;
  for (const t of ["crew_show_status", "crew_show_pins", "crew_show_pings"]) {
    const r = await db.prepare(`DELETE FROM ${t} WHERE expires_at <= ?`).run(nowIso);
    n += (r && r.changes) || 0;
  }
  return n;
}

async function deleteUserCrewData(db, userId) {
  for (const t of ["crew_show_status", "crew_show_pins", "crew_show_pings"]) {
    try { await db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(Number(userId)); } catch (_) { /* table may not exist yet */ }
  }
}

// Notifications feed items: "I'm lost" pings from my current crews.
async function crewNotifications(db, userId, opts) {
  const now = (opts && opts.now) || Date.now();
  const rows = await db.prepare(`SELECT p.*, e.name AS event_name FROM crew_show_pings p JOIN events e ON e.id = p.event_id
    WHERE p.expires_at > ? AND p.user_id != ? ORDER BY p.created_at DESC LIMIT 30`).all(iso(now), Number(userId));
  const out = [];
  const pairCache = new Map();
  for (const r of rows) {
    const key = r.event_id;
    if (!pairCache.has(key)) pairCache.set(key, new Set(await crewMemberIds(db, userId, r.event_id, opts)));
    if (!pairCache.get(key).has(Number(r.user_id))) continue;
    out.push({ kind: "crew_lost", fromId: Number(r.user_id), at: r.created_at, eventId: r.event_id, text: r.resolved_at ? "found their crew" : (r.note || ""), eventName: r.event_name || "", resolved: Boolean(r.resolved_at) });
  }
  return out;
}

async function migrateShowCrew(db) {
  const pg = db.driver === "postgres";
  const real = pg ? "DOUBLE PRECISION" : "REAL";
  const stmts = [
    `CREATE TABLE IF NOT EXISTS crew_show_status (
      event_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note TEXT DEFAULT '',
      note_at TEXT,
      lat ${real},
      lng ${real},
      accuracy ${real},
      loc_at TEXT,
      sharing INTEGER DEFAULT 0,
      left_at TEXT,
      expires_at TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (event_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS crew_show_pins (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      lat ${real},
      lng ${real},
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS crew_show_pings (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'lost',
      note TEXT DEFAULT '',
      lat ${real},
      lng ${real},
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      resolved_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_crew_show_status_expires ON crew_show_status(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_crew_show_pins_event ON crew_show_pins(event_id, expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_crew_show_pings_event ON crew_show_pings(event_id, expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_crew_show_pings_expires ON crew_show_pings(expires_at)`,
  ];
  for (const sql of stmts) {
    try { await db.exec(sql); } catch (err) { console.error("crew_show migrate:", err.message || err); }
  }
}

async function notifyCrew(ctx, userId, ev, payload) {
  if (!ctx || !ctx.broadcastToUser) return;
  let ids = [];
  try { ids = await crewMemberIds(ctx.getDb(), userId, ev, { blockedSet: ctx.blockedSet }); } catch (_) { ids = []; }
  for (const id of ids) ctx.broadcastToUser(id, { type: "show-crew", eventId: ev.id, ...payload });
  return ids;
}

function installShowCrew(ctx) {
  const { app, getDb, auth, publicUser, blockedSet, broadcastToUser } = ctx;
  const db = () => getDb();
  const opts = () => ({ blockedSet, publicUser });
  const lastLost = new Map();

  async function loadActive(req, res, { allowLeft } = {}) {
    const ev = await resolveEvent(db(), req.params.eventId);
    if (!ev || ev.is_example || String(ev.status || "active") === "removed") { res.status(404).json({ error: "Show not found." }); return null; }
    const st = windowStatus(crewWindow(ev), Date.now());
    if (st !== "active") {
      res.status(409).json({ error: st === "upcoming" ? "Find My Crew opens on show day." : (st === "ended" ? "This show's crew has ended." : "This show doesn't have a start time yet."), code: "crew_" + st });
      return null;
    }
    const going = await goingUserIds(db(), ev);
    if (!going.has(Number(req.user.id))) { res.status(403).json({ error: "Mark yourself going to this show to use Find My Crew.", code: "crew_not_going" }); return null; }
    if (!allowLeft) {
      const row = await statusRow(db(), ev.id, req.user.id);
      if (row && row.left_at) { res.status(409).json({ error: "You left this crew. Rejoin to share again.", code: "crew_left" }); return null; }
    }
    return ev;
  }
  const from = (u) => ({ id: Number(u.id), name: u.name });
  async function snapshot(req, ev) { return getCrewSnapshot(db(), req.user.id, ev, opts()); }

  app.get("/api/show-crew/today", auth, async (req, res) => {
    const now = Date.now();
    const rows = await db().prepare(`SELECT DISTINCT e.* FROM event_going g JOIN events e ON (e.id = g.event_id OR (e.event_key IS NOT NULL AND e.event_key <> '' AND e.event_key = g.event_key)) WHERE g.user_id=?`).all(req.user.id);
    const seen = new Set();
    const crews = [];
    for (const ev of rows) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      if (ev.is_example || String(ev.status || "active") === "removed") continue;
      if (windowStatus(crewWindow(ev), now) !== "active") continue;
      const snap = await getCrewSnapshot(db(), req.user.id, ev, opts());
      crews.push({
        event: snap.event,
        expiresAt: snap.expiresAt,
        left: Boolean(snap.me && snap.me.left),
        memberCount: snap.members.length,
        members: snap.members.slice(0, 5).map((m) => m.user),
        openLost: snap.pings.filter((p) => !p.mine && !p.resolvedAt).length,
      });
    }
    crews.sort((a, b) => String(a.event.startsAt).localeCompare(String(b.event.startsAt)));
    res.json({ crews });
  });

  app.get("/api/show-crew/:eventId", auth, async (req, res) => {
    const snap = await getCrewSnapshot(db(), req.user.id, req.params.eventId, opts());
    if (snap.status === "not_found") return res.status(404).json({ error: "Show not found." });
    res.json(snap);
  });

  app.get("/api/show-crew/:eventId/members/:userId", auth, async (req, res) => {
    const out = await getCrewMemberStatus(db(), req.user.id, Number(req.params.userId), req.params.eventId, opts());
    if (!out.member) return res.status(403).json({ error: "Not in your crew for this show.", member: false });
    res.json(out);
  });

  app.post("/api/show-crew/:eventId/note", auth, async (req, res) => {
    const ev = await loadActive(req, res);
    if (!ev) return;
    const note = clip(req.body && req.body.note, MAX_NOTE);
    try {
      const { contentRejected } = require("./content-filter");
      if (note && contentRejected && contentRejected(note)) return res.status(400).json({ error: "Keep your note friendly." });
    } catch (_) {}
    await upsertStatus(db(), ev, req.user.id, { note, note_at: note ? iso(Date.now()) : null });
    await notifyCrew(ctx, req.user.id, ev, { kind: "note", from: from(req.user) });
    res.json(await snapshot(req, ev));
  });

  app.post("/api/show-crew/:eventId/location", auth, async (req, res) => {
    const ev = await loadActive(req, res);
    if (!ev) return;
    const b = req.body || {};
    if (!validLat(b.lat) || !validLng(b.lng)) return res.status(400).json({ error: "Send a valid location." });
    const acc = Number(b.accuracy);
    await upsertStatus(db(), ev, req.user.id, {
      lat: roundCoord(b.lat), lng: roundCoord(b.lng),
      accuracy: Number.isFinite(acc) && acc >= 0 ? Math.min(Math.round(acc), 100000) : null,
      loc_at: iso(Date.now()), sharing: 1,
    });
    await notifyCrew(ctx, req.user.id, ev, { kind: "location", from: from(req.user) });
    res.json(await snapshot(req, ev));
  });

  app.post("/api/show-crew/:eventId/location/stop", auth, async (req, res) => {
    const ev = await resolveEvent(db(), req.params.eventId);
    if (!ev) return res.status(404).json({ error: "Show not found." });
    const row = await statusRow(db(), ev.id, req.user.id);
    if (row && crewWindow(ev)) await upsertStatus(db(), ev, req.user.id, { lat: null, lng: null, accuracy: null, loc_at: null, sharing: 0 });
    await notifyCrew(ctx, req.user.id, ev, { kind: "location", from: from(req.user) });
    res.json(await snapshot(req, ev));
  });

  app.post("/api/show-crew/:eventId/pins", auth, async (req, res) => {
    const ev = await loadActive(req, res);
    if (!ev) return;
    const b = req.body || {};
    const label = clip(b.label, MAX_PIN_LABEL);
    if (!label) return res.status(400).json({ error: "Give the meet-up spot a name." });
    const hasCoords = validLat(b.lat) && validLng(b.lng);
    const win = crewWindow(ev);
    const nowIso = iso(Date.now());
    const mine = await db().prepare(`SELECT id FROM crew_show_pins WHERE event_id=? AND user_id=? AND expires_at > ? ORDER BY created_at ASC`).all(ev.id, req.user.id, nowIso);
    for (const old of mine.slice(0, Math.max(0, mine.length - (MAX_PINS_EACH - 1)))) {
      await db().prepare(`DELETE FROM crew_show_pins WHERE id=?`).run(old.id);
    }
    await db().prepare(`INSERT INTO crew_show_pins (id, event_id, user_id, label, lat, lng, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(newId(), ev.id, req.user.id, label, hasCoords ? roundCoord(b.lat) : null, hasCoords ? roundCoord(b.lng) : null, nowIso, iso(win.expiresAt));
    await notifyCrew(ctx, req.user.id, ev, { kind: "pin", from: from(req.user), label });
    res.json(await snapshot(req, ev));
  });

  app.delete("/api/show-crew/:eventId/pins/:pinId", auth, async (req, res) => {
    const ev = await resolveEvent(db(), req.params.eventId);
    if (!ev) return res.status(404).json({ error: "Show not found." });
    await db().prepare(`DELETE FROM crew_show_pins WHERE id=? AND user_id=? AND event_id=?`).run(String(req.params.pinId), req.user.id, ev.id);
    await notifyCrew(ctx, req.user.id, ev, { kind: "pin", from: from(req.user) });
    res.json(await snapshot(req, ev));
  });

  app.post("/api/show-crew/:eventId/lost", auth, async (req, res) => {
    const ev = await loadActive(req, res);
    if (!ev) return;
    const key = req.user.id + "|" + ev.id;
    const last = lastLost.get(key) || 0;
    if (Date.now() - last < LOST_COOLDOWN_MS) return res.status(429).json({ error: "Your crew already got your ping. Give them a minute." });
    lastLost.set(key, Date.now());
    const b = req.body || {};
    const note = clip(b.note, MAX_NOTE);
    const row = await statusRow(db(), ev.id, req.user.id);
    const loc = shapeLocation(row, Date.now());
    const win = crewWindow(ev);
    const nowIso = iso(Date.now());
    // One open ping per person: a new ping replaces the previous open one.
    await db().prepare(`DELETE FROM crew_show_pings WHERE event_id=? AND user_id=? AND resolved_at IS NULL`).run(ev.id, req.user.id);
    await db().prepare(`INSERT INTO crew_show_pings (id, event_id, user_id, kind, note, lat, lng, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(newId(), ev.id, req.user.id, "lost", note || (row && row.note) || "", loc ? loc.lat : null, loc ? loc.lng : null, nowIso, iso(win.expiresAt));
    const notified = await notifyCrew(ctx, req.user.id, ev, { kind: "lost", from: from(req.user), note, eventName: ev.name });
    const snap = await snapshot(req, ev);
    res.json({ ...snap, notified: (notified || []).length });
  });

  app.post("/api/show-crew/:eventId/pings/:pingId/resolve", auth, async (req, res) => {
    const ev = await resolveEvent(db(), req.params.eventId);
    if (!ev) return res.status(404).json({ error: "Show not found." });
    const r = await db().prepare(`UPDATE crew_show_pings SET resolved_at=? WHERE id=? AND user_id=? AND event_id=? AND resolved_at IS NULL`).run(iso(Date.now()), String(req.params.pingId), req.user.id, ev.id);
    if (r && r.changes) await notifyCrew(ctx, req.user.id, ev, { kind: "found", from: from(req.user) });
    res.json(await snapshot(req, ev));
  });

  app.post("/api/show-crew/:eventId/leave", auth, async (req, res) => {
    const ev = await resolveEvent(db(), req.params.eventId);
    if (!ev) return res.status(404).json({ error: "Show not found." });
    if (!crewWindow(ev)) return res.status(409).json({ error: "This show doesn't have a start time yet." });
    // Tell the crew first (membership is computed live, so after leaving nobody is "in" it).
    await notifyCrew(ctx, req.user.id, ev, { kind: "leave", from: from(req.user) });
    await upsertStatus(db(), ev, req.user.id, { left_at: iso(Date.now()), note: "", note_at: null, lat: null, lng: null, accuracy: null, loc_at: null, sharing: 0 });
    await db().prepare(`DELETE FROM crew_show_pins WHERE event_id=? AND user_id=?`).run(ev.id, req.user.id);
    await db().prepare(`DELETE FROM crew_show_pings WHERE event_id=? AND user_id=?`).run(ev.id, req.user.id);
    res.json(await snapshot(req, ev));
  });

  app.post("/api/show-crew/:eventId/rejoin", auth, async (req, res) => {
    const ev = await loadActive(req, res, { allowLeft: true });
    if (!ev) return;
    await upsertStatus(db(), ev, req.user.id, { left_at: null });
    await notifyCrew(ctx, req.user.id, ev, { kind: "join", from: from(req.user) });
    res.json(await snapshot(req, ev));
  });

  const sweep = () => sweepExpired(db()).then((n) => { if (n) console.log("Find My Crew: cleared " + n + " expired row(s)."); }).catch((err) => console.error("crew sweep:", err.message || err));
  setTimeout(sweep, 15 * 1000).unref();
  setInterval(sweep, 10 * 60 * 1000).unref();
  return { sweep };
}

module.exports = {
  installShowCrew,
  migrateShowCrew,
  crewWindow,
  windowStatus,
  getCrewSnapshot,
  crewMemberIds,
  isCrewPair,
  getLastLocation,
  getCrewMemberStatus,
  crewNotifications,
  deleteUserCrewData,
  sweepExpired,
  notifyCrew,
  _time: { tzParts, zoned, nextSixAm },
};
