"use strict";

require("./load-env");

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const { WebSocketServer } = require("ws");
const { open } = require("./db");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const SECRET = process.env.KANDI_SECRET || "dev-kandi-secret-change-before-launch";
const DAILY_LIKES = 8;
const PLUS_REWINDS = 5;
const root = path.join(__dirname, "..");
const uploadDir = path.join(root, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

let db;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(new Error("Images only (jpeg, png, webp, gif)"));
    cb(null, true);
  },
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.get("/uploads/:id", async (req, res, next) => {
  try {
    const row = await db.prepare(`SELECT mime, data FROM photo_files WHERE id=?`).get(req.params.id);
    if (row) {
      res.setHeader("Content-Type", row.mime);
      res.setHeader("Cache-Control", "public, max-age=604800");
      return res.send(Buffer.from(row.data, "base64"));
    }
    next();
  } catch (err) { next(err); }
});
app.use("/uploads", express.static(uploadDir, { maxAge: "7d" }));
app.use(express.static(path.join(root, "public"), { maxAge: "1h", index: false }));

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  raw.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isHttps(req) {
  const proto = String((req && req.headers && req.headers["x-forwarded-proto"]) || "").split(",")[0].trim();
  return process.env.KANDI_SECURE_COOKIE === "1" || proto === "https";
}
function setSessionCookie(res, token, req) {
  const secure = isHttps(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `kandi_sid=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "kandi_sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

async function getUserFromReq(req) {
  const token = parseCookies(req).kandi_sid;
  if (!token) return null;
  const row = await db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  return row || null;
}

async function auth(req, res, next) {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Sign in required" });
    req.user = user;
    next();
  } catch (err) { next(err); }
}

function publicUser(u, extra) {
  if (!u) return null;
  return {
    id: Number(u.id),
    username: u.username,
    name: u.name,
    age: u.age,
    bio: u.bio || "",
    vibes: JSON.parse(u.vibes || "[]"),
    looking: JSON.parse(u.looking || "[]"),
    prompts: JSON.parse(u.prompts || "[]"),
    photos: JSON.parse(u.photos || "[]"),
    events: JSON.parse(u.events || "[]"),
    isDemo: Boolean(u.is_demo),
    subscription: u.subscription || null,
    createdAt: u.created_at,
    ...(extra || {}),
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function isPlus(sub) {
  return sub === "plus" || sub === "vip";
}
function pairIds(a, b) {
  return a < b ? [a, b] : [b, a];
}
async function likesUsedToday(userId) {
  const row = await db.prepare(`SELECT count FROM like_days WHERE user_id=? AND day=?`).get(userId, today());
  return row ? row.count : 0;
}
async function bumpLike(userId) {
  const day = today();
  const row = await db.prepare(`SELECT count FROM like_days WHERE user_id=? AND day=?`).get(userId, day);
  if (row) await db.prepare(`UPDATE like_days SET count=count+1 WHERE user_id=? AND day=?`).run(userId, day);
  else await db.prepare(`INSERT INTO like_days (user_id, day, count) VALUES (?,?,1)`).run(userId, day);
}

async function blockedSet(userId) {
  const rows = await db.prepare(`SELECT blocked_id AS id FROM blocks WHERE user_id=? UNION SELECT user_id AS id FROM blocks WHERE blocked_id=?`).all(userId, userId);
  return new Set(rows.map((r) => Number(r.id)));
}

// ---- auth ----
app.post("/api/signup", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").trim();
  const age = Number(req.body.age);
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username must be 3–20 letters, numbers, or underscores." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (name.length < 2) return res.status(400).json({ error: "Please enter your name." });
  if (!Number.isInteger(age) || age < 18 || age > 99) return res.status(400).json({ error: "Kandi is 18+. Enter an age between 18 and 99." });
  const exists = await db.prepare(`SELECT id FROM users WHERE username=?`).get(username);
  if (exists) return res.status(409).json({ error: "That username is taken." });
  const hash = bcrypt.hashSync(password, 10);
  const info = await db.prepare(`INSERT INTO users (username,password_hash,name,age) VALUES (?,?,?,?)`).run(username, hash, name, age);
  const token = crypto.randomBytes(24).toString("hex");
  await db.prepare(`INSERT INTO sessions (token, user_id) VALUES (?,?)`).run(token, Number(info.lastInsertRowid));
  setSessionCookie(res, token, req);
  const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(Number(info.lastInsertRowid));
  const demos = await db.prepare(`SELECT id FROM users WHERE is_demo=1 AND id != ? LIMIT 2`).all(user.id);
  for (const d of demos) {
    try {
      await db.prepare(`INSERT INTO likes (from_id,to_id,target_type,target_id,comment) VALUES (?,?,?,?,?)`)
        .run(d.id, user.id, "photo", "0", "Welcome to the floor.");
    } catch (_) { /* already liked */ }
  }
  res.json({ user: publicUser(user) });
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await db.prepare(`SELECT * FROM users WHERE username=?`).get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Wrong username or password." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  await db.prepare(`INSERT INTO sessions (token, user_id) VALUES (?,?)`).run(token, user.id);
  setSessionCookie(res, token, req);
  res.json({ user: publicUser(user), likesLeft: isPlus(user.subscription) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(user.id)) });
});

app.post("/api/logout", auth, async (req, res) => {
  const token = parseCookies(req).kandi_sid;
  if (token) await db.prepare(`DELETE FROM sessions WHERE token=?`).run(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", auth, async (req, res) => {
  const going = (await db.prepare(`SELECT event_id FROM event_going WHERE user_id=?`).all(req.user.id)).map((r) => r.event_id);
  const live = await db.prepare(`SELECT * FROM live WHERE user_id=?`).get(req.user.id);
  const share = await db.prepare(`SELECT * FROM location_shares WHERE user_id=? ORDER BY id DESC LIMIT 1`).get(req.user.id);
  res.json({
    user: publicUser(req.user, { events: going.length ? going : JSON.parse(req.user.events || "[]") }),
    likesLeft: isPlus(req.user.subscription) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(req.user.id)),
    live: live ? { on: true, eventId: live.event_id, meetupSpot: live.meetup_spot } : { on: false },
    locationShare: share ? { with: share.share_with, event: share.event_label, at: share.created_at } : null,
  });
});

app.put("/api/me", auth, async (req, res) => {
  const body = req.body || {};
  const name = body.name != null ? String(body.name).trim() : req.user.name;
  const bio = body.bio != null ? String(body.bio).slice(0, 500) : req.user.bio;
  const vibes = body.vibes != null ? JSON.stringify(body.vibes) : req.user.vibes;
  const looking = body.looking != null ? JSON.stringify(body.looking) : req.user.looking;
  const prompts = body.prompts != null ? JSON.stringify(body.prompts) : req.user.prompts;
  if (!name || name.length < 2) return res.status(400).json({ error: "Name is required." });
  await db.prepare(`UPDATE users SET name=?, bio=?, vibes=?, looking=?, prompts=? WHERE id=?`).run(name, bio, vibes, looking, prompts, req.user.id);
  const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/me/photo", auth, async (req, res) => {
  upload.single("photo")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    if (!req.file) return res.status(400).json({ error: "Choose a photo to upload." });
    const ext = path.extname(req.file.originalname || "").toLowerCase() || ".jpg";
    const safe = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
    const fileId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${safe}`;
    const mime = req.file.mimetype || "image/jpeg";
    await db.prepare(`INSERT INTO photo_files (id, user_id, mime, data) VALUES (?,?,?,?)`).run(
      fileId, req.user.id, mime, req.file.buffer.toString("base64")
    );
    try { fs.writeFileSync(path.join(uploadDir, fileId), req.file.buffer); } catch (_) { /* ephemeral disk is ok */ }
    const photos = JSON.parse(req.user.photos || "[]");
    photos.push({ type: "file", url: "/uploads/" + fileId, caption: String(req.body.caption || "") });
    await db.prepare(`UPDATE users SET photos=? WHERE id=?`).run(JSON.stringify(photos), req.user.id);
    const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
    res.json({ user: publicUser(user) });
  });
});

// ---- discover ----
app.get("/api/discover", auth, async (req, res) => {
  const blocked = await blockedSet(req.user.id);
  const liked = new Set((await db.prepare(`SELECT to_id FROM likes WHERE from_id=?`).all(req.user.id)).map((r) => Number(r.to_id)));
  const passed = new Set((await db.prepare(`SELECT to_id FROM passes WHERE from_id=?`).all(req.user.id)).map((r) => Number(r.to_id)));
  const matched = new Set(
    (await db.prepare(`SELECT a_id, b_id FROM matches WHERE a_id=? OR b_id=?`).all(req.user.id, req.user.id))
      .flatMap((r) => [Number(r.a_id), Number(r.b_id)])
  );
  const genre = String(req.query.genre || "all");
  const event = String(req.query.event || "all");
  if ((genre !== "all" || event !== "all") && !isPlus(req.user.subscription)) {
    return res.status(402).json({ error: "Advanced filters are a Kandi+ feature.", code: "plus_required", reason: "filters" });
  }
  let people = (await db.prepare(`SELECT * FROM users WHERE id != ?`).all(req.user.id))
    .filter((u) => !blocked.has(Number(u.id)) && !liked.has(u.id) && !passed.has(u.id) && !matched.has(u.id))
    .map((u) => publicUser(u));
  if (genre !== "all") people = people.filter((p) => p.vibes.includes(genre));
  if (event !== "all") people = people.filter((p) => p.events.includes(event));
  res.json({
    people,
    likesLeft: isPlus(req.user.subscription) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(req.user.id)),
  });
});

async function maybeMatch(fromId, toId) {
  const back = await db.prepare(`SELECT id FROM likes WHERE from_id=? AND to_id=?`).get(toId, fromId);
  if (!back) return null;
  const [a, b] = pairIds(fromId, toId);
  const existing = await db.prepare(`SELECT * FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
  if (existing) return existing;
  const info = await db.prepare(`INSERT INTO matches (a_id, b_id) VALUES (?,?)`).run(a, b);
  return await db.prepare(`SELECT * FROM matches WHERE id=?`).get(Number(info.lastInsertRowid));
}

app.post("/api/like", auth, async (req, res) => {
  const toId = Number(req.body.userId);
  const targetType = req.body.type === "prompt" ? "prompt" : "photo";
  const targetId = String(req.body.targetId || "0");
  const comment = String(req.body.comment || "").slice(0, 280);
  if (!toId || toId === req.user.id) return res.status(400).json({ error: "Invalid like." });
  if ((await blockedSet(req.user.id)).has(toId)) return res.status(400).json({ error: "You can't like this person." });
  if (!isPlus(req.user.subscription) && await likesUsedToday(req.user.id) >= DAILY_LIKES) {
    return res.status(402).json({ error: "You're out of free likes today.", code: "plus_required", reason: "likes" });
  }
  try {
    await db.prepare(`INSERT INTO likes (from_id,to_id,target_type,target_id,comment) VALUES (?,?,?,?,?)`).run(req.user.id, toId, targetType, targetId, comment);
  } catch (e) {
    return res.status(409).json({ error: "You already liked this person." });
  }
  await db.prepare(`DELETE FROM passes WHERE from_id=? AND to_id=?`).run(req.user.id, toId);
  if (!isPlus(req.user.subscription)) await bumpLike(req.user.id);
  const match = await maybeMatch(req.user.id, toId);
  if (match) broadcastToUser(toId, { type: "match", user: publicUser(req.user), matchId: match.id });
  else broadcastToUser(toId, { type: "like", from: publicUser(req.user), targetType, targetId, comment });
  res.json({
    ok: true,
    matched: Boolean(match),
    matchId: match ? match.id : null,
    likesLeft: isPlus(req.user.subscription) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(req.user.id)),
  });
});

app.post("/api/pass", auth, async (req, res) => {
  const toId = Number(req.body.userId);
  if (!toId || toId === req.user.id) return res.status(400).json({ error: "Invalid pass." });
  await db.prepare(`INSERT OR REPLACE INTO passes (from_id, to_id) VALUES (?,?)`).run(req.user.id, toId);
  res.json({ ok: true });
});

async function rewindsUsedToday(userId) {
  const row = await db.prepare(`SELECT count FROM rewind_days WHERE user_id=? AND day=?`).get(userId, today());
  return row ? row.count : 0;
}
async function bumpRewind(userId) {
  const day = today();
  const row = await db.prepare(`SELECT count FROM rewind_days WHERE user_id=? AND day=?`).get(userId, day);
  if (row) await db.prepare(`UPDATE rewind_days SET count=count+1 WHERE user_id=? AND day=?`).run(userId, day);
  else await db.prepare(`INSERT INTO rewind_days (user_id, day, count) VALUES (?,?,1)`).run(userId, day);
}

app.post("/api/rewind", auth, async (req, res) => {
  if (!isPlus(req.user.subscription)) return res.status(402).json({ error: "Rewind is a Kandi+ feature.", code: "plus_required", reason: "rewind" });
  if (req.user.subscription !== "vip" && await rewindsUsedToday(req.user.id) >= PLUS_REWINDS) {
    return res.status(402).json({ error: "You're out of rewinds today. Kandi VIP has unlimited rewinds.", code: "plus_required", reason: "rewind" });
  }
  const last = await db.prepare(`SELECT to_id, created_at FROM passes WHERE from_id=? ORDER BY created_at DESC LIMIT 1`).get(req.user.id);
  if (!last) return res.status(400).json({ error: "Nothing to rewind." });
  await db.prepare(`DELETE FROM passes WHERE from_id=? AND to_id=?`).run(req.user.id, last.to_id);
  if (req.user.subscription !== "vip") await bumpRewind(req.user.id);
  res.json({ ok: true, userId: last.to_id });
});

app.get("/api/likes-received", auth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT u.*, l.target_type, l.target_id, l.comment AS like_comment, l.created_at AS liked_at
    FROM likes l
    JOIN users u ON u.id = l.from_id
    WHERE l.to_id = ?
    AND l.from_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id=?)
    AND l.from_id NOT IN (SELECT user_id FROM blocks WHERE blocked_id=?)
    AND NOT EXISTS (SELECT 1 FROM matches m WHERE (m.a_id=l.from_id AND m.b_id=l.to_id) OR (m.a_id=l.to_id AND m.b_id=l.from_id))
    ORDER BY l.created_at DESC
  `).all(req.user.id, req.user.id, req.user.id);
  const count = rows.length;
  if (!isPlus(req.user.subscription)) {
    return res.json({ locked: true, count, people: rows.slice(0, 4).map((r) => ({ blurred: true, photos: publicUser(r).photos })) });
  }
  res.json({
    locked: false,
    count,
    people: rows.map((r) => ({
      ...publicUser(r),
      liked: { type: r.target_type, targetId: r.target_id, comment: r.like_comment },
    })),
  });
});

// ---- matches & chat ----
app.get("/api/matches", auth, async (req, res) => {
  const blocked = await blockedSet(req.user.id);
  const rows = await db.prepare(`SELECT * FROM matches WHERE a_id=? OR b_id=? ORDER BY created_at DESC`).all(req.user.id, req.user.id);
  const out = [];
  for (const m of rows) {
    const otherId = m.a_id === req.user.id ? m.b_id : m.a_id;
    const other = await db.prepare(`SELECT * FROM users WHERE id=?`).get(otherId);
    const last = await db.prepare(`SELECT * FROM messages WHERE match_id=? ORDER BY id DESC LIMIT 1`).get(m.id);
    const item = { matchId: m.id, user: publicUser(other), lastMessage: last ? { text: last.text, fromId: last.from_id, at: last.created_at } : null, createdAt: m.created_at };
    if (item.user && !blocked.has(item.user.id)) out.push(item);
  }
  res.json({ matches: out });
});

app.get("/api/chats/:userId", auth, async (req, res) => {
  const otherId = Number(req.params.userId);
  const [a, b] = pairIds(req.user.id, otherId);
  const match = await db.prepare(`SELECT * FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
  if (!match) return res.status(404).json({ error: "You can only chat after you match." });
  const messages = await db.prepare(`SELECT id, from_id as fromId, text, created_at as at FROM messages WHERE match_id=? ORDER BY id ASC`).all(match.id);
  res.json({ matchId: match.id, messages });
});

app.post("/api/chats/:userId", auth, async (req, res) => {
  const otherId = Number(req.params.userId);
  const text = String(req.body.text || "").trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: "Message is empty." });
  if ((await blockedSet(req.user.id)).has(otherId)) return res.status(403).json({ error: "You can't message this person." });
  const [a, b] = pairIds(req.user.id, otherId);
  const match = await db.prepare(`SELECT * FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
  if (!match) return res.status(404).json({ error: "You can only chat after you match." });
  const info = await db.prepare(`INSERT INTO messages (match_id, from_id, text) VALUES (?,?,?)`).run(match.id, req.user.id, text);
  const msg = await db.prepare(`SELECT id, from_id as fromId, text, created_at as at FROM messages WHERE id=?`).get(Number(info.lastInsertRowid));
  broadcastToUser(otherId, { type: "message", matchId: match.id, message: msg, from: publicUser(req.user) });
  res.json({ message: msg });
});

// ---- events / live ----
app.get("/api/events", auth, async (req, res) => {
  const blocked = await blockedSet(req.user.id);
  const raw = await db.prepare(`SELECT * FROM events`).all();
  const events = [];
  for (const e of raw) {
    const going = (await db.prepare(`SELECT u.* FROM event_going g JOIN users u ON u.id=g.user_id WHERE g.event_id=?`).all(e.id))
      .filter((u) => !blocked.has(Number(u.id)))
      .map((u) => publicUser(u));
    const imGoing = Boolean(await db.prepare(`SELECT 1 FROM event_going WHERE user_id=? AND event_id=?`).get(req.user.id, e.id));
    if (req.user.subscription === "vip") {
      going.sort((x, y) => Number(y.subscription === "vip") - Number(x.subscription === "vip"));
    }
    events.push({
      id: e.id, name: e.name, city: e.city, date: e.date_label, venue: e.venue,
      genres: JSON.parse(e.genres || "[]"), emoji: e.emoji, color: e.color,
      isExample: Boolean(e.is_example), imGoing, going,
    });
  }
  res.json({ events });
});

app.post("/api/events/:id/going", auth, async (req, res) => {
  const id = String(req.params.id);
  const ev = await db.prepare(`SELECT id FROM events WHERE id=?`).get(id);
  if (!ev) return res.status(404).json({ error: "Event not found." });
  const going = Boolean(req.body.going);
  if (going) await db.prepare(`INSERT OR IGNORE INTO event_going (user_id, event_id) VALUES (?,?)`).run(req.user.id, id);
  else {
    await db.prepare(`DELETE FROM event_going WHERE user_id=? AND event_id=?`).run(req.user.id, id);
    const live = await db.prepare(`SELECT event_id FROM live WHERE user_id=?`).get(req.user.id);
    if (live && live.event_id === id) await db.prepare(`DELETE FROM live WHERE user_id=?`).run(req.user.id);
  }
  const events = JSON.parse(req.user.events || "[]");
  const next = going ? Array.from(new Set(events.concat(id))) : events.filter((x) => x !== id);
  await db.prepare(`UPDATE users SET events=? WHERE id=?`).run(JSON.stringify(next), req.user.id);
  res.json({ ok: true, going });
});

app.post("/api/live", auth, async (req, res) => {
  const on = Boolean(req.body.on);
  const eventId = String(req.body.eventId || "");
  const meetupSpot = req.body.meetupSpot ? String(req.body.meetupSpot).slice(0, 80) : null;
  if (!on) {
    await db.prepare(`DELETE FROM live WHERE user_id=?`).run(req.user.id);
    return res.json({ live: { on: false } });
  }
  const ev = await db.prepare(`SELECT id FROM events WHERE id=?`).get(eventId);
  if (!ev) return res.status(400).json({ error: "Pick an event first." });
  await db.prepare(`INSERT OR IGNORE INTO event_going (user_id, event_id) VALUES (?,?)`).run(req.user.id, eventId);
  await db.prepare(`INSERT INTO live (user_id, event_id, meetup_spot, updated_at) VALUES (?,?,?,datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET event_id=excluded.event_id, meetup_spot=excluded.meetup_spot, updated_at=datetime('now')`).run(req.user.id, eventId, meetupSpot);
  res.json({ live: { on: true, eventId, meetupSpot } });
});

app.get("/api/live", auth, async (req, res) => {
  const eventId = String(req.query.eventId || "");
  const mine = await db.prepare(`SELECT * FROM live WHERE user_id=?`).get(req.user.id);
  const eid = eventId || (mine && mine.event_id);
  if (!eid) return res.json({ live: { on: Boolean(mine) }, nearby: [] });
  const blocked = await blockedSet(req.user.id);
  const nearby = (await db.prepare(`
    SELECT u.*, l.meetup_spot, l.user_id AS live_uid FROM event_going g
    JOIN users u ON u.id=g.user_id
    LEFT JOIN live l ON l.user_id=u.id AND l.event_id=g.event_id
    WHERE g.event_id=? AND u.id != ?
  `).all(eid, req.user.id))
    .filter((u) => !blocked.has(Number(u.id)))
    .map((u) => publicUser(u, { meetupSpot: u.meetup_spot || null, live: Boolean(u.live_uid) }));
  if (req.user.subscription === "vip") nearby.sort((x, y) => Number(y.subscription === "vip") - Number(x.subscription === "vip"));
  res.json({ live: mine ? { on: true, eventId: mine.event_id, meetupSpot: mine.meetup_spot } : { on: false }, nearby });
});

// ---- safety ----
app.post("/api/block", auth, async (req, res) => {
  const id = Number(req.body.userId);
  const reason = String(req.body.reason || "");
  if (!id || id === req.user.id) return res.status(400).json({ error: "Invalid user." });
  await db.prepare(`INSERT OR REPLACE INTO blocks (user_id, blocked_id, reason) VALUES (?,?,?)`).run(req.user.id, id, reason);
  const [a, b] = pairIds(req.user.id, id);
  await db.prepare(`DELETE FROM matches WHERE a_id=? AND b_id=?`).run(a, b);
  await db.prepare(`DELETE FROM likes WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)`).run(req.user.id, id, id, req.user.id);
  res.json({ ok: true });
});

app.post("/api/report", auth, async (req, res) => {
  const id = Number(req.body.userId);
  const reason = String(req.body.reason || "Something else").slice(0, 200);
  if (!id) return res.status(400).json({ error: "Invalid user." });
  await db.prepare(`INSERT INTO reports (reporter_id, target_id, reason) VALUES (?,?,?)`).run(req.user.id, id, reason);
  await db.prepare(`INSERT OR IGNORE INTO blocks (user_id, blocked_id, reason) VALUES (?,?,?)`).run(req.user.id, id, reason);
  const [ra, rb] = pairIds(req.user.id, id);
  await db.prepare(`DELETE FROM matches WHERE a_id=? AND b_id=?`).run(ra, rb);
  await db.prepare(`DELETE FROM likes WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)`).run(req.user.id, id, id, req.user.id);
  res.json({ ok: true, blocked: true });
});

app.get("/api/blocks", auth, async (req, res) => {
  const rows = await db.prepare(`SELECT u.* FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=?`).all(req.user.id);
  res.json({ blocked: rows.map((u) => publicUser(u)) });
});

app.post("/api/blocks/:id/unblock", auth, async (req, res) => {
  await db.prepare(`DELETE FROM blocks WHERE user_id=? AND blocked_id=?`).run(req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

app.post("/api/safety/share", auth, async (req, res) => {
  // Demo / in-app only: records a share, does not send a real location or SMS.
  const shareWith = String(req.body.with || "Trusted friend").slice(0, 80);
  const eventLabel = String(req.body.event || "").slice(0, 80);
  await db.prepare(`INSERT INTO location_shares (user_id, share_with, event_label) VALUES (?,?,?)`).run(req.user.id, shareWith, eventLabel);
  res.json({ ok: true, demo: true, message: "Location share recorded in-app only. No real location was sent." });
});

// ---- billing stub ----
// TODO: Replace this stub with Stripe Checkout or Apple/Google in-app purchases before any public launch.
// Do not collect card numbers here. No charges are made.
app.get("/api/plans", (_req, res) => {
  res.json({
    note: "Example pricing — payment is stubbed. No real charges. TODO: Stripe or App Store / Play billing.",
    todo: "Connect Stripe Billing or Apple In-App Purchase / Google Play Billing before launch.",
    plans: {
      plus: { weekly: 12.99, monthly: 24.99, six: 89.99, features: ["Unlimited likes", "See who likes you", "Advanced filters", "5 rewinds / day"] },
      vip: { weekly: 19.99, monthly: 39.99, six: 149.99, features: ["Everything in Kandi+", "Unlimited rewinds", "Priority at events and live mode", "VIP badge"] },
    },
  });
});

app.post("/api/subscribe", auth, async (req, res) => {
  const plan = req.body.plan === "vip" ? "vip" : req.body.plan === "plus" ? "plus" : null;
  if (!plan) return res.status(400).json({ error: "Pick Kandi+ or Kandi VIP." });
  // TODO: create a Stripe Checkout Session (or IAP) and only set subscription after a verified webhook.
  await db.prepare(`UPDATE users SET subscription=? WHERE id=?`).run(plan, req.user.id);
  const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  res.json({
    user: publicUser(user),
    stub: true,
    warning: "No payment was taken. This is a development stub. TODO: Stripe or Apple/Google in-app purchase.",
  });
});

app.post("/api/subscribe/cancel", auth, async (req, res) => {
  // TODO: cancel the real Stripe/IAP subscription when payments are connected.
  await db.prepare(`UPDATE users SET subscription=NULL WHERE id=?`).run(req.user.id);
  const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  res.json({ user: publicUser(user), stub: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "kandi" }));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads") || req.path.startsWith("/ws")) return next();
  res.sendFile(path.join(root, "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const sockets = new Map(); // userId -> Set of ws

function broadcastToUser(userId, payload) {
  const set = sockets.get(Number(userId));
  if (!set) return;
  const raw = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

wss.on("connection", (ws, req) => {
  Promise.resolve().then(async () => {
    const user = await getUserFromReq(req);
    if (!user) {
      ws.close(4001, "auth");
      return;
    }
    if (!sockets.has(user.id)) sockets.set(user.id, new Set());
    sockets.get(user.id).add(ws);
    ws.send(JSON.stringify({ type: "hello", userId: user.id }));
    const ping = setInterval(() => {
      if (ws.readyState === 1) ws.ping();
      else clearInterval(ping);
    }, 30000);
    ws.on("close", () => {
      clearInterval(ping);
      const set = sockets.get(user.id);
      if (set) {
        set.delete(ws);
        if (!set.size) sockets.delete(user.id);
      }
    });
  }).catch((err) => {
    console.error(err);
    try { ws.close(1011, "error"); } catch (_) {}
  });
});

async function boot() {
  db = await open();
  if (process.env.SEED_ON_BOOT !== "0") {
    const row = await db.prepare(`SELECT COUNT(*) AS c FROM users`).get();
    if (!row || Number(row.c) === 0) {
      const { seed } = require("./seed");
      await seed(db);
      console.log("Seeded demo data on boot (empty database).");
    }
  }
  server.listen(PORT, HOST, () => {
    console.log(`Kandi v1 listening on http://${HOST}:${PORT}`);
  });
}

boot().catch((err) => {
  console.error("Failed to start Kandi:", err);
  process.exit(1);
});
