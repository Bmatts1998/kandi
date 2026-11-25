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
const { installFeed } = require("./feed-routes");
const { installChat, startDisappearSweeper, previewText } = require("./chat-routes");
const { installGroups } = require("./group-routes");
const { installSocialExtras } = require("./social-extras");
const { sniffImageMime, normalizePhoto, servePhoto, MAX_UPLOAD_BYTES } = require("./photo");
const { eventKey, chipLabel } = require("./event-key");
const {
  isAdult, loadGoingRows, shapeGoers, resolveEvent, setRsvp,
  listUpcomingForProfile, sharedShows, upcomingByUser, seedDemoMeetups, compactShow, truthy,
} = require("./meetup");
const { parseTunes, MAX_TUNES } = require("./tunes");
const { installStories } = require("./stories");
const { contentRejected, rejectedFromAll } = require("./content-filter");

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;

function sniffVideoMime(buf, name, typ) {
  typ = String(typ || "").toLowerCase();
  name = String(name || "").toLowerCase();
  if (typ.startsWith("video/")) return typ === "video/quicktime" ? "video/quicktime" : typ;
  if (buf && buf.length >= 12 && buf.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.slice(8, 12).toString("ascii");
    if (brand.startsWith("qt") || brand === "moov") return "video/quicktime";
    return "video/mp4";
  }
  if (name.endsWith(".mov") || name.endsWith(".qt")) return "video/quicktime";
  if (name.endsWith(".mp4") || name.endsWith(".m4v") || name.endsWith(".webm")) {
    return name.endsWith(".webm") ? "video/webm" : "video/mp4";
  }
  return null;
}

function sendBuffer(req, res, buffer, mime) {
  res.setHeader("Content-Type", mime || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=604800");
  res.setHeader("Accept-Ranges", "bytes");
  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  }
  const m = String(range).match(/bytes=(\d*)-(\d*)/);
  if (!m) return res.status(416).end();
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : buffer.length - 1;
  if (start >= buffer.length || end >= buffer.length || start > end) {
    res.setHeader("Content-Range", "bytes */" + buffer.length);
    return res.status(416).end();
  }
  res.status(206);
  res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + buffer.length);
  res.setHeader("Content-Length", end - start + 1);
  return res.send(buffer.subarray(start, end + 1));
}
const { buildIcs, googleCalendarUrl, icsFilename } = require("./event-calendar");
const { createEngagement, compareDiscover, compareGoers } = require("./engagement");
const { createDemoChat } = require("./demo-chat");
const { catalog: genreCatalog, normalizeGenreIds, publicGenres, sharedGenreIds, sharedGenreChip, eventMatchesGenre, getGenre, MAX_GENRES } = require("./genres");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const SECRET = process.env.KANDI_SECRET || "dev-kandi-secret-change-before-launch";
const DAILY_LIKES = 8;
const PLUS_REWINDS = 5;
const root = path.join(__dirname, "..");
const uploadDir = path.join(root, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

let db;
const engagement = {
  recordActivity: async () => {},
  scheduleRefresh() {},
  refreshNow: async () => {},
  startPeriodicRefresh() {},
};
let demoChat = { maybeReply() {} };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const typ = String(file.mimetype || "").toLowerCase();
    if (!typ || typ === "application/octet-stream" || typ.startsWith("image/")) return cb(null, true);
    cb(new Error("Please choose a photo."));
  },
});

const uploadPost = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 8 },
  fileFilter: (_req, file, cb) => {
    const typ = String(file.mimetype || "").toLowerCase();
    const name = String(file.originalname || "").toLowerCase();
    if (!typ || typ === "application/octet-stream" || typ.startsWith("image/") || typ.startsWith("video/")) return cb(null, true);
    if (/\.(mov|mp4|m4v|qt|webm|jpg|jpeg|png|webp|gif|heic|heif|avif)$/.test(name)) return cb(null, true);
    cb(new Error("Please choose a photo or a short video."));
  },
});

const app = express();
// Constrain iframes to official music players used by My Tunes (and this origin).
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "frame-src 'self' https://open.spotify.com https://w.soundcloud.com https://embed.music.apple.com"
  );
  next();
});
// Express 4 doesn't catch errors thrown by async handlers: a DB hiccup would leave the request hanging
// forever and the app looking frozen. Wrap every handler so failures become a JSON error instead.
for (const method of ["get", "post", "put", "delete", "patch"]) {
  const orig = app[method].bind(app);
  app[method] = (...args) => {
    if (method === "get" && args.length === 1) return orig(...args); // app.get(setting)
    return orig(...args.map((fn) => (typeof fn === "function" && fn.length < 4
      ? function wrapped(req, res, next) {
          try {
            const out = fn(req, res, next);
            if (out && typeof out.catch === "function") out.catch(next);
          } catch (err) { next(err); }
        }
      : fn)));
  };
}
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.get("/uploads/:id", async (req, res, next) => {
  try {
    const row = await db.prepare(`SELECT mime, data FROM photo_files WHERE id=?`).get(req.params.id);
    if (row) {
      const raw = Buffer.from(row.data, "base64");
      const mime = String(row.mime || "");
      if (mime.startsWith("video/")) return sendBuffer(req, res, raw, mime);
      const served = await servePhoto(raw, row.mime);
      return sendBuffer(req, res, served.buffer, served.mime);
    }
    next();
  } catch (err) { next(err); }
});
app.use("/uploads", express.static(uploadDir, { maxAge: "7d" }));
const BUILD = String(process.env.RENDER_GIT_COMMIT || Date.now().toString(36)).slice(0, 12);
function noStore(res) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}
let indexHtmlCache = null;
function sendIndex(res) {
  if (!indexHtmlCache) {
    indexHtmlCache = fs.readFileSync(path.join(root, "public", "index.html"), "utf8")
      .replace(/(href|src)="\/(styles\.css|app\.js)"/g, `$1="/$2?v=${BUILD}"`);
  }
  noStore(res);
  res.type("html").send(indexHtmlCache);
}
app.get(["/", "/index.html"], (_req, res) => sendIndex(res));
app.get("/api/version", (_req, res) => { noStore(res); res.json({ build: BUILD }); });
app.get("/api/badges", (_req, res) => { noStore(res); res.json({ genres: genreCatalog() }); });
app.get("/api/genres", (_req, res) => { noStore(res); res.json({ genres: genreCatalog(), max: MAX_GENRES }); });
app.get("/api/genres/:id", auth, async (req, res) => {
  const genre = getGenre(req.params.id);
  if (!genre) return res.status(404).json({ error: "Unknown genre." });
  const blocked = await blockedSet(req.user.id);
  const mine = normalizeGenreIds(parseJsonList(req.user.vibes, []));
  const rows = await db.prepare(`SELECT * FROM users WHERE id != ?`).all(req.user.id);
  const people = [];
  for (const u of rows) {
    if (!isAdult(u) || blocked.has(Number(u.id))) continue;
    const vibes = normalizeGenreIds(parseJsonList(u.vibes, []));
    if (!vibes.includes(genre.id)) continue;
    people.push(publicUser(u, {
      sharedGenres: sharedGenreIds(mine, vibes),
      sharedGenreChip: sharedGenreChip(mine, vibes),
    }));
    if (people.length >= 40) break;
  }
  const now = Date.now();
  const evRows = await db.prepare(`SELECT * FROM events`).all();
  const events = [];
  for (const e of evRows) {
    if (String(e.status || "active") === "removed" || e.is_example) continue;
    const starts = e.starts_at ? Date.parse(e.starts_at) : NaN;
    if (!Number.isNaN(starts) && starts < now) continue;
    const ev = publicEventFields(e);
    if (!eventMatchesGenre(ev, genre.id)) continue;
    events.push(ev);
    if (events.length >= 20) break;
  }
  res.json({ genre: { id: genre.id, name: genre.name, short: genre.short, color: genre.color, icon: genre.icon }, people, events });
});
app.use(express.static(path.join(root, "public"), {
  index: false,
  setHeaders(res, filePath) {
    const base = path.basename(filePath);
    if (/\.(js|css|html|webmanifest)$/.test(base)) {
      // JS/CSS are requested with ?v=<build>; still revalidate so an old WebView cache can't pin a broken build.
      res.setHeader("Cache-Control", "no-cache");
    } else {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
    if (base === "sw.js") { noStore(res); res.setHeader("Service-Worker-Allowed", "/"); }
  },
}));
app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

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
    engagement.recordActivity(user.id).catch(() => {});
    next();
  } catch (err) { next(err); }
}

const MAX_PROFILE_PHOTOS = 6;

function parsePhotos(raw) {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw || "[]") : (raw || []);
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function fileIdFromPhoto(ph) {
  if (!ph || ph.type !== "file" || !ph.url) return null;
  const m = String(ph.url).match(/^\/uploads\/([^/?#]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function saveUserPhotos(userId, photos) {
  await db.prepare(`UPDATE users SET photos=? WHERE id=?`).run(JSON.stringify(photos), userId);
  return publicUser(await db.prepare(`SELECT * FROM users WHERE id=?`).get(userId));
}

async function deletePhotoFileIfOwned(fileId, userId) {
  if (!fileId) return;
  const used = await db.prepare(
    `SELECT id FROM posts WHERE photo_id=? OR video_id=? OR poster_id=? OR (photo_ids IS NOT NULL AND photo_ids LIKE ?) LIMIT 1`
  ).get(fileId, fileId, fileId, "%" + fileId + "%");
  if (used) return;
  try {
    const usedStory = await db.prepare(`SELECT id FROM stories WHERE media_id=? OR poster_id=? LIMIT 1`).get(fileId, fileId);
    if (usedStory) return;
  } catch (_) { /* stories table may not exist during a partial migrate */ }
  const row = await db.prepare(`SELECT user_id FROM photo_files WHERE id=?`).get(fileId);
  if (!row || Number(row.user_id) !== Number(userId)) return;
  await db.prepare(`DELETE FROM photo_files WHERE id=? AND user_id=?`).run(fileId, userId);
  try { fs.unlinkSync(path.join(uploadDir, fileId)); } catch (_) { /* ephemeral disk is ok */ }
}

function parseJsonList(val, fallback) {
  if (Array.isArray(val)) return val;
  try { const v = JSON.parse(val || "[]"); return Array.isArray(v) ? v : fallback; } catch (_) { return fallback; }
}

function publicUser(u, extra) {
  if (!u) return null;
  return {
    id: Number(u.id),
    username: u.username,
    name: u.name,
    age: u.age == null || u.age === "" ? null : Number(u.age),
    bio: u.bio || "",
    vibes: parseJsonList(u.vibes, []),
    looking: parseJsonList(u.looking, []),
    prompts: parseJsonList(u.prompts, []),
    photos: parseJsonList(u.photos, []),
    events: parseJsonList(u.events, []),
    gender: u.gender || "",
    pronouns: u.pronouns || "",
    interestedIn: parseJsonList(u.interested_in, []),
    favoriteArtists: u.favorite_artists || "",
    favoriteFestival: u.favorite_festival || "",
    favoriteVenue: u.favorite_venue || "",
    favoriteHangout: u.favorite_hangout || "",
    kandiTrades: u.kandi_trades || "",
    raveTotem: u.rave_totem || "",
    yearsRaving: u.years_raving || "",
    sex: u.sex || "",
    heightIn: u.height_in == null || u.height_in === "" ? null : Number(u.height_in),
    hobbies: parseJsonList(u.hobbies, []),
    favoriteTunes: parseTunes(parseJsonList(u.favorite_tunes, [])).tunes,
    isDemo: Boolean(u.is_demo),
    needsProfile: Boolean(Number(u.needs_profile)),
    showUpcoming: u.show_upcoming == null ? true : Boolean(Number(u.show_upcoming)),
    subscription: u.subscription || null,
    createdAt: u.created_at,
    vibes: normalizeGenreIds(parseJsonList(u.vibes, [])),
    genres: publicGenres(u.vibes),
    ...(extra || {}),
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function acceptedTerms(body) {
  const v = body && body.acceptedTerms;
  return v === true || v === "true" || v === 1 || v === "1";
}

function isNativeIosClient(req) {
  const h = String((req.get && req.get("x-kandi-client")) || req.headers["x-kandi-client"] || "").toLowerCase();
  if (h === "ios" || h === "capacitor-ios") return true;
  const ua = String((req.get && req.get("user-agent")) || req.headers["user-agent"] || "");
  return /Capacitor/i.test(ua) && /iPhone|iPad|iPod/i.test(ua);
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
  if (!acceptedTerms(req.body)) return res.status(400).json({ error: "Please agree to the Terms of Use and Privacy Policy to create an account." });
  const nameBad = contentRejected(name);
  if (nameBad) return res.status(400).json({ error: nameBad });
  const exists = await db.prepare(`SELECT id FROM users WHERE lower(username)=?`).get(username);
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
  const user = await db.prepare(`SELECT * FROM users WHERE lower(username)=?`).get(username);
  if (!user) return res.status(401).json({ error: "Wrong username or password." });
  if (!user.password_hash || String(user.password_hash).startsWith("!")) {
    return res.status(403).json({ error: "This account isn't ready yet. Open the setup link you were given to choose a password and enter your age." });
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
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

app.delete("/api/account", auth, async (req, res) => {
  if (req.user.is_demo) {
    return res.status(403).json({ error: "Demo profiles can't be deleted." });
  }
  const username = String(req.body.username || "").trim().toLowerCase();
  const confirm = String(req.body.confirm || "").trim();
  if (username !== String(req.user.username).toLowerCase() || confirm !== "DELETE") {
    return res.status(400).json({ error: "Type your username and DELETE (all caps) to confirm." });
  }
  const id = req.user.id;
  const matchIds = (await db.prepare(`SELECT id FROM matches WHERE a_id=? OR b_id=?`).all(id, id)).map((r) => r.id);
  for (const mid of matchIds) {
    await db.prepare(`DELETE FROM messages WHERE match_id=?`).run(mid);
  }
  await db.prepare(`DELETE FROM messages WHERE from_id=?`).run(id);
  await db.prepare(`DELETE FROM matches WHERE a_id=? OR b_id=?`).run(id, id);
  await db.prepare(`DELETE FROM likes WHERE from_id=? OR to_id=?`).run(id, id);
  await db.prepare(`DELETE FROM passes WHERE from_id=? OR to_id=?`).run(id, id);
  await db.prepare(`DELETE FROM blocks WHERE user_id=? OR blocked_id=?`).run(id, id);
  await db.prepare(`DELETE FROM reports WHERE reporter_id=? OR target_id=?`).run(id, id);
  await db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM live WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM event_going WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM like_days WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM rewind_days WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM user_activity_days WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM location_shares WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM comments WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM post_likes WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM posts WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM follows WHERE follower_id=? OR following_id=?`).run(id, id);
  for (const sql of [`DELETE FROM chat_reads WHERE user_id=?`, `DELETE FROM notif_seen WHERE user_id=?`, `DELETE FROM we_met WHERE user_id=? OR other_id=?`]) {
    try { await db.prepare(sql).run(...(sql.includes("other_id") ? [id, id] : [id])); } catch (_) { /* table not created yet */ }
  }
  await db.prepare(`DELETE FROM photo_files WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM chat_files WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM setup_tokens WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM users WHERE id=?`).run(id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", auth, async (req, res) => {
  const going = (await db.prepare(`SELECT event_id FROM event_going WHERE user_id=?`).all(req.user.id)).map((r) => r.event_id);
  const live = await db.prepare(`SELECT * FROM live WHERE user_id=?`).get(req.user.id);
  const share = await db.prepare(`SELECT * FROM location_shares WHERE user_id=? ORDER BY id DESC LIMIT 1`).get(req.user.id);
  const upcoming = await listUpcomingForProfile(db, req.user, req.user);
  res.json({
    user: publicUser(req.user, { events: going.length ? going : JSON.parse(req.user.events || "[]"), upcomingShows: upcoming.shows }),
    likesLeft: isPlus(req.user.subscription) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(req.user.id)),
    live: live ? { on: true, eventId: live.event_id, meetupSpot: live.meetup_spot } : { on: false },
    locationShare: share ? { with: share.share_with, event: share.event_label, at: share.created_at } : null,
    upcomingShows: upcoming.shows,
    genreCatalog: genreCatalog(),
  });
});

function clipText(val, max, fallback) {
  if (val == null) return fallback;
  return String(val).trim().slice(0, max);
}

app.put("/api/me", auth, async (req, res) => {
  const body = req.body || {};
  const name = body.name != null ? String(body.name).trim() : req.user.name;
  const bio = body.bio != null ? String(body.bio).slice(0, 500) : req.user.bio;
  const vibes = body.vibes != null ? JSON.stringify(normalizeGenreIds(body.vibes)) : req.user.vibes;
  const looking = body.looking != null ? JSON.stringify(body.looking) : req.user.looking;
  const prompts = body.prompts != null ? JSON.stringify(body.prompts) : req.user.prompts;
  if (!name || name.length < 2) return res.status(400).json({ error: "Name is required." });
  const profileBad = rejectedFromAll([name, bio, body.prompts, body.favoriteArtists, body.favoriteFestival, body.favoriteVenue, body.favoriteHangout, body.raveTotem, body.hobbies]);
  if (profileBad) return res.status(400).json({ error: profileBad });
  let showUpcoming = req.user.show_upcoming;
  if (body.showUpcoming != null || body.show_upcoming != null) {
    showUpcoming = (body.showUpcoming ?? body.show_upcoming) ? 1 : 0;
  }
  let age = req.user.age;
  if (body.age != null && body.age !== "") {
    age = Number(body.age);
    if (!Number.isInteger(age) || age < 18 || age > 99) {
      return res.status(400).json({ error: "Kandi is 18+. Enter an age between 18 and 99." });
    }
  }
  const gender = body.gender != null ? clipText(body.gender, 40, "") : (req.user.gender || "");
  const pronouns = body.pronouns != null ? clipText(body.pronouns, 40, "") : (req.user.pronouns || "");
  const interestedIn = body.interestedIn != null ? JSON.stringify(body.interestedIn) : (req.user.interested_in || "[]");
  const favoriteArtists = body.favoriteArtists != null ? clipText(body.favoriteArtists, 200, "") : (req.user.favorite_artists || "");
  const favoriteFestival = body.favoriteFestival != null ? clipText(body.favoriteFestival, 120, "") : (req.user.favorite_festival || "");
  const favoriteVenue = body.favoriteVenue != null ? clipText(body.favoriteVenue, 120, "") : (req.user.favorite_venue || "");
  const favoriteHangout = body.favoriteHangout != null ? clipText(body.favoriteHangout, 120, "") : (req.user.favorite_hangout || "");
  const kandiTrades = body.kandiTrades != null ? clipText(body.kandiTrades, 40, "") : (req.user.kandi_trades || "");
  const raveTotem = body.raveTotem != null ? clipText(body.raveTotem, 160, "") : (req.user.rave_totem || "");
  const yearsRaving = body.yearsRaving != null ? clipText(body.yearsRaving, 40, "") : (req.user.years_raving || "");
  const sex = body.sex != null ? clipText(body.sex, 40, "") : (req.user.sex || "");
  let heightIn = req.user.height_in == null || req.user.height_in === "" ? null : Number(req.user.height_in);
  if (body.heightIn !== undefined) {
    if (body.heightIn == null || body.heightIn === "") heightIn = null;
    else {
      heightIn = Number(body.heightIn);
      if (!Number.isInteger(heightIn) || heightIn < 48 || heightIn > 96) {
        return res.status(400).json({ error: "Height should be between 4 ft 0 in and 8 ft 0 in." });
      }
    }
  }
  const hobbies = body.hobbies != null ? JSON.stringify(
    (Array.isArray(body.hobbies) ? body.hobbies : []).map((h) => String(h).trim()).filter(Boolean).slice(0, 20)
  ) : (req.user.hobbies || "[]");
  let favoriteTunes = req.user.favorite_tunes || "[]";
  if (body.favoriteTunes != null || body.tunes != null) {
    const parsed = parseTunes(body.favoriteTunes != null ? body.favoriteTunes : body.tunes);
    if (parsed.error) {
      return res.status(400).json({ error: "Each My Tunes link needs to be a Spotify, SoundCloud, or Apple Music track, playlist, or album." });
    }
    favoriteTunes = JSON.stringify(parsed.tunes.slice(0, MAX_TUNES));
  }
  await db.prepare(`UPDATE users SET name=?, bio=?, vibes=?, looking=?, prompts=?, age=?, gender=?, pronouns=?, interested_in=?, favorite_artists=?, favorite_festival=?, favorite_venue=?, favorite_hangout=?, kandi_trades=?, rave_totem=?, years_raving=?, sex=?, height_in=?, hobbies=?, favorite_tunes=?, show_upcoming=? WHERE id=?`).run(
    name, bio, vibes, looking, prompts, age, gender, pronouns, interestedIn, favoriteArtists, favoriteFestival, favoriteVenue, favoriteHangout, kandiTrades, raveTotem, yearsRaving, sex, heightIn, hobbies, favoriteTunes, showUpcoming, req.user.id
  );
  const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  const upcoming = await listUpcomingForProfile(db, user, user);
  res.json({ user: publicUser(user, { upcomingShows: upcoming.shows }) });
});

app.post("/api/me/photo", auth, async (req, res) => {
  upload.single("photo")(req, res, async (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE"
        ? "That file is over 30 MB, which is too big to send. This is rare for a phone photo — try another one from your camera roll."
        : (err.message || "Upload failed");
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: "Choose a photo to upload." });
    const fresh = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
    const photos = parsePhotos(fresh && fresh.photos);
    if (photos.length >= MAX_PROFILE_PHOTOS) {
      return res.status(400).json({ error: "You can add up to 6 photos. Remove one to add another." });
    }
    let normalized;
    try {
      normalized = await normalizePhoto(req.file.buffer);
    } catch (normErr) {
      return res.status(normErr.status || 400).json({ error: normErr.message || "Couldn't process that photo." });
    }
    const fileId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${normalized.ext}`;
    const mime = normalized.mime;
    await db.prepare(`INSERT INTO photo_files (id, user_id, mime, data) VALUES (?,?,?,?)`).run(
      fileId, req.user.id, mime, normalized.buffer.toString("base64")
    );
    try { fs.writeFileSync(path.join(uploadDir, fileId), normalized.buffer); } catch (_) { /* ephemeral disk is ok */ }
    const entry = { type: "file", url: "/uploads/" + fileId, caption: String((req.body && req.body.caption) || "") };
    const asMain = req.body && (req.body.main === "1" || req.body.main === "true" || req.body.asMain === "1");
    if (asMain || photos.length === 0) photos.unshift(entry);
    else photos.push(entry);
    const user = await saveUserPhotos(req.user.id, photos);
    console.log("photo-upload ok", { userId: Number(req.user.id), bytesIn: req.file.size, bytesOut: normalized.buffer.length, main: Boolean(asMain) });
    res.json({ user });
  });
});

app.delete("/api/me/photo/:index", auth, async (req, res) => {
  const index = Number(req.params.index);
  const photos = parsePhotos(req.user.photos);
  if (!Number.isInteger(index) || index < 0 || index >= photos.length) {
    return res.status(404).json({ error: "Photo not found." });
  }
  const removed = photos.splice(index, 1)[0];
  await deletePhotoFileIfOwned(fileIdFromPhoto(removed), req.user.id);
  const user = await saveUserPhotos(req.user.id, photos);
  res.json({ user });
});

app.post("/api/me/photo/main", auth, async (req, res) => {
  const index = Number(req.body && req.body.index);
  const photos = parsePhotos(req.user.photos);
  if (!Number.isInteger(index) || index < 0 || index >= photos.length) {
    return res.status(400).json({ error: "Pick one of your photos to set as main." });
  }
  if (index !== 0) {
    const [picked] = photos.splice(index, 1);
    photos.unshift(picked);
  }
  const user = await saveUserPhotos(req.user.id, photos);
  res.json({ user });
});

app.put("/api/me/photos", auth, async (req, res) => {
  const photos = parsePhotos(req.user.photos);
  const order = (req.body && req.body.order) || [];
  if (!Array.isArray(order) || order.length !== photos.length) {
    return res.status(400).json({ error: "Send a new order for all of your photos." });
  }
  const idxs = order.map((n) => Number(n));
  if (idxs.some((n) => !Number.isInteger(n) || n < 0 || n >= photos.length)) {
    return res.status(400).json({ error: "That photo order isn't valid." });
  }
  if (new Set(idxs).size !== photos.length) {
    return res.status(400).json({ error: "That photo order isn't valid." });
  }
  const next = idxs.map((i) => photos[i]);
  const user = await saveUserPhotos(req.user.id, next);
  res.json({ user });
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
  const gender = String(req.query.gender || "all");
  const ageMin = Number(req.query.ageMin);
  const ageMax = Number(req.query.ageMax);
  // Genre badges are a core, free Discover filter. Event-specific filters stay Kandi+,
  // except "going to the same show," which is free.
  const genreId = genre !== "all" ? (getGenre(genre) && getGenre(genre).id) : null;
  if (genre !== "all" && !genreId) {
    return res.status(400).json({ error: "Unknown genre." });
  }
  const showsByUser = await upcomingByUser(db);
  const myShows = showsByUser.get(Number(req.user.id)) || [];
  const myIds = new Set(myShows.map((e) => e.id));
  const myKeys = new Set(myShows.map((e) => e.event_key || e.id));
  function sharedFor(uid) {
    const theirs = showsByUser.get(Number(uid)) || [];
    return theirs.filter((e) => myIds.has(e.id) || myKeys.has(e.event_key || e.id)).map((e) => compactShow(e));
  }
  let rows = (await db.prepare(`SELECT * FROM users WHERE id != ?`).all(req.user.id))
    .filter((u) => isAdult(u) && !blocked.has(Number(u.id)) && !liked.has(u.id) && !passed.has(u.id) && !matched.has(u.id));
  const myGenres = normalizeGenreIds(parseJsonList(req.user.vibes, []));
  const sharedMap = new Map();
  const genreMap = new Map();
  for (const u of rows) {
    sharedMap.set(Number(u.id), sharedFor(u.id).length);
    genreMap.set(Number(u.id), sharedGenreIds(myGenres, parseJsonList(u.vibes, [])).length);
  }
  rows.sort((a, b) => compareDiscover(a, b, sharedMap, genreMap));
  let people = rows.map((u) => {
    const shared = sharedFor(u.id);
    const theirVibes = normalizeGenreIds(parseJsonList(u.vibes, []));
    return publicUser(u, {
      sharedEvents: shared,
      sharedEventChip: shared[0] ? ("Also going to " + (shared[0].chip || shared[0].name)) : "",
      sharedGenres: sharedGenreIds(myGenres, theirVibes),
      sharedGenreChip: sharedGenreChip(myGenres, theirVibes),
    });
  });
  if (genreId) people = people.filter((p) => p.vibes.includes(genreId));
  if (event === "same") {
    people = people.filter((p) => (p.sharedEvents || []).length);
  } else if (event !== "all") {
    people = people.filter((p) => {
      const theirs = showsByUser.get(Number(p.id)) || [];
      return theirs.some((e) => e.id === event || e.event_key === event) || (p.events || []).includes(event);
    });
  }
  if (gender !== "all") people = people.filter((p) => p.gender === gender);
  const lo = Number.isFinite(ageMin) ? ageMin : 18;
  const hi = Number.isFinite(ageMax) ? ageMax : 99;
  if (lo > 18 || hi < 99) {
    people = people.filter((p) => p.age != null && p.age >= lo && p.age <= hi);
  }
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
  engagement.scheduleRefresh();
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
    const shared = other ? await sharedShows(db, req.user.id, otherId) : [];
    const item = {
      matchId: m.id,
      user: publicUser(other),
      lastMessage: last ? { text: previewText(last), preview: previewText(last), attachType: last.attach_type || null, fromId: last.from_id, at: last.created_at } : null,
      createdAt: m.created_at,
      sharedEvents: shared,
      meetPlan: (m.meet_spot || m.meet_time) ? {
        eventKey: m.meet_event_key || "",
        event: shared.find((s) => s.eventKey === m.meet_event_key || s.id === m.meet_event_key) || shared[0] || null,
        spot: m.meet_spot || "",
        time: m.meet_time || "",
      } : null,
    };
    if (item.user && !blocked.has(item.user.id)) out.push(item);
  }
  res.json({ matches: out });
});


app.post("/api/matches/:id/meet", auth, async (req, res) => {
  const match = await db.prepare(`SELECT * FROM matches WHERE id=?`).get(Number(req.params.id));
  if (!match || (Number(match.a_id) !== Number(req.user.id) && Number(match.b_id) !== Number(req.user.id))) {
    return res.status(404).json({ error: "Match not found." });
  }
  const otherId = Number(match.a_id) === Number(req.user.id) ? match.b_id : match.a_id;
  if ((await blockedSet(req.user.id)).has(Number(otherId))) {
    return res.status(403).json({ error: "You can't plan a meetup with this person." });
  }
  const shared = await sharedShows(db, req.user.id, otherId);
  if (!shared.length) return res.status(400).json({ error: "You two need to be going to the same show first." });
  const wanted = String(req.body.eventKey || req.body.eventId || "");
  const ev = shared.find((s) => s.eventKey === wanted || s.id === wanted) || shared[0];
  const spot = String(req.body.spot || "").trim().slice(0, 80);
  const time = String(req.body.time || "").trim().slice(0, 40);
  if (!spot && !time) return res.status(400).json({ error: "Add a meet spot or a time." });
  await db.prepare(`UPDATE matches SET meet_event_key=?, meet_spot=?, meet_time=? WHERE id=?`)
    .run(ev.eventKey || ev.id, spot, time, match.id);
  const plan = { eventKey: ev.eventKey || ev.id, event: ev, spot, time };
  broadcastToUser(otherId, { type: "meet-plan", matchId: match.id, meetPlan: plan, from: publicUser(req.user) });
  res.json({ ok: true, meetPlan: plan, sharedEvents: shared });
});



function parseJsonList(value) {
  try { const v = JSON.parse(value || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}

function publicEventFields(e) {
  const timeTba = Boolean(Number(e.time_tba));
  const ev = {
    id: e.id,
    name: e.name,
    city: e.city,
    date: e.date_label,
    venue: e.venue,
    address: e.address || "",
    genres: parseJsonList(e.genres),
    artists: parseJsonList(e.artists),
    emoji: e.emoji,
    color: e.color,
    category: e.category || "concert",
    ticketUrl: e.ticket_url || "",
    ticketSeller: e.ticket_seller || "",
    sourceUrl: e.source_url || "",
    imageUrl: e.image_url || "",
    startsAt: e.starts_at || "",
    endsAt: e.ends_at || "",
    timeTba,
    ageLimit: e.age_limit || "",
    icsUrl: "/api/events/" + encodeURIComponent(e.id) + ".ics",
    eventKey: e.event_key || eventKey(e),
  };
  ev.googleCalendarUrl = googleCalendarUrl(ev);
  ev.mapsUrl = ev.address
    ? "https://maps.apple.com/?q=" + encodeURIComponent((ev.venue ? ev.venue + ", " : "") + ev.address)
    : "";
  return ev;
}

// ---- events / live ----
app.get("/api/events", auth, async (req, res) => {
  const blocked = await blockedSet(req.user.id);
  const raw = await db.prepare(`SELECT * FROM events`).all();
  const meta = await db.prepare(`SELECT value FROM app_meta WHERE key=?`).get("events_updated_at");
  const now = Date.now();
  const events = [];
  // One query for everyone going to anything (was 2 queries per event: slow on Neon with 100+ shows).
  const goingRows = await loadGoingRows(db);
  for (const e of raw) {
    if (String(e.status || "active") === "removed") continue;
    const starts = e.starts_at ? Date.parse(e.starts_at) : NaN;
    if (!Number.isNaN(starts) && starts < now) continue;
    if (e.is_example) continue;
    const going = shapeGoers(goingRows, e, req.user, blocked, publicUser);
    const open = going.filter((u) => u.openToMeet);
    const mine = going.find((u) => Number(u.id) === Number(req.user.id));
    const scoreById = new Map(goingRows.map((u) => [Number(u.id), Number(u.engagement_score) || 0]));
    going.sort((x, y) => compareGoers(
      { ...x, engagement_score: scoreById.get(Number(x.id)) || 0 },
      { ...y, engagement_score: scoreById.get(Number(y.id)) || 0 },
      { vipFirst: req.user.subscription === "vip" }
    ));
    events.push({
      ...publicEventFields(e),
      isExample: false,
      imGoing: Boolean(mine),
      imOpenToMeet: Boolean(mine && mine.openToMeet),
      meetNote: mine && mine.openToMeet ? (mine.meetNote || "") : "",
      going,
      openToMeet: open,
      goingCount: going.length,
      openCount: open.length,
    });
  }
  events.sort((a, b) => String(a.startsAt || a.date).localeCompare(String(b.startsAt || b.date)));
  res.json({ events, updatedAt: meta ? meta.value : null });
});


app.get(/^\/api\/events\/(.+)\.ics$/, async (req, res) => {
  const id = decodeURIComponent(req.params[0] || "");
  const e = await db.prepare(`SELECT * FROM events WHERE id=?`).get(id);
  if (!e || e.is_example || String(e.status || "active") === "removed") {
    return res.status(404).type("text/plain").send("Event not found.");
  }
  const ev = publicEventFields(e);
  const body = buildIcs(ev);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${icsFilename(ev)}"`);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(body);
});

app.post("/api/events/:id/going", auth, async (req, res) => {
  if (!isAdult(req.user)) return res.status(403).json({ error: "Kandi is 18+ only." });
  const ev = await resolveEvent(db, req.params.id);
  if (!ev || ev.is_example || String(ev.status || "active") === "removed") {
    return res.status(404).json({ error: "Event not found." });
  }
  const going = Boolean(req.body.going);
  const result = await setRsvp(db, req.user, ev, { going, openToMeet: going ? undefined : false });
  engagement.scheduleRefresh();
  res.json({ ok: true, ...result });
});

app.post("/api/events/:id/meet", auth, async (req, res) => {
  if (!isAdult(req.user)) return res.status(403).json({ error: "Kandi is 18+ only." });
  const ev = await resolveEvent(db, req.params.id);
  if (!ev || ev.is_example || String(ev.status || "active") === "removed") {
    return res.status(404).json({ error: "Event not found." });
  }
  const open = Boolean(req.body.open ?? req.body.openToMeet);
  const note = req.body.note != null ? String(req.body.note).slice(0, 80) : undefined;
  const result = await setRsvp(db, req.user, ev, { going: true, openToMeet: open, meetNote: note });
  engagement.scheduleRefresh();
  res.json({ ok: true, ...result });
});

app.post("/api/live", auth, async (req, res) => {
  const on = Boolean(req.body.on);
  const eventId = String(req.body.eventId || "");
  const meetupSpot = req.body.meetupSpot ? String(req.body.meetupSpot).slice(0, 80) : null;
  if (!on) {
    await db.prepare(`DELETE FROM live WHERE user_id=?`).run(req.user.id);
    return res.json({ live: { on: false } });
  }
  const ev = await resolveEvent(db, eventId);
  if (!ev) return res.status(400).json({ error: "Pick an event first." });
  await setRsvp(db, req.user, ev, { going: true });
  engagement.scheduleRefresh();
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
    .sort((a, b) => compareGoers(a, b, { vipFirst: req.user.subscription === "vip" }))
    .map((u) => publicUser(u, { meetupSpot: u.meetup_spot || null, live: Boolean(u.live_uid) }));
  res.json({ live: mine ? { on: true, eventId: mine.event_id, meetupSpot: mine.meetup_spot } : { on: false }, nearby });
});

// ---- safety ----
app.post("/api/block", auth, async (req, res) => {
  const id = Number(req.body.userId);
  const reason = String(req.body.reason || "");
  if (!id || id === req.user.id) return res.status(400).json({ error: "Invalid user." });
  await db.prepare(`INSERT OR REPLACE INTO blocks (user_id, blocked_id, reason) VALUES (?,?,?)`).run(req.user.id, id, reason);
  const [a, b] = pairIds(req.user.id, id);
  const match = await db.prepare(`SELECT id FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
  if (match) await db.prepare(`DELETE FROM messages WHERE match_id=?`).run(match.id);
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
  const reportedMatch = await db.prepare(`SELECT id FROM matches WHERE a_id=? AND b_id=?`).get(ra, rb);
  if (reportedMatch) await db.prepare(`DELETE FROM messages WHERE match_id=?`).run(reportedMatch.id);
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
  if (isNativeIosClient(req)) {
    return res.status(403).json({ error: "Kandi+ is coming soon and will be sold only through Apple In-App Purchase.", code: "plus_coming_soon" });
  }
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

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

app.get("/api/claim/:token", async (req, res) => {
  const token = String(req.params.token || "");
  if (!token) return res.status(400).json({ error: "Missing setup token." });
  const row = await db.prepare(
    `SELECT t.expires_at, u.username, u.name FROM setup_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash=?`
  ).get(sha256(token));
  if (!row) return res.status(404).json({ error: "That setup link is invalid or has expired." });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(404).json({ error: "That setup link has expired. Ask for a new one." });
  }
  res.json({ ok: true, name: row.name, username: row.username });
});

app.post("/api/claim", async (req, res) => {
  const token = String(req.body.token || "");
  const password = String(req.body.password || "");
  const age = Number(req.body.age);
  if (!token) return res.status(400).json({ error: "Missing setup token." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (!Number.isInteger(age) || age < 18 || age > 99) {
    return res.status(400).json({ error: "Kandi is 18+. Enter your real age, between 18 and 99." });
  }
  if (!acceptedTerms(req.body)) return res.status(400).json({ error: "Please agree to the Terms of Use and Privacy Policy to continue." });
  const row = await db.prepare(`SELECT * FROM setup_tokens WHERE token_hash=?`).get(sha256(token));
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(404).json({ error: "That setup link is invalid or has expired." });
  }
  const hash = bcrypt.hashSync(password, 10);
  await db.prepare(`UPDATE users SET password_hash=?, age=?, needs_profile=0 WHERE id=?`).run(hash, age, row.user_id);
  await db.prepare(`DELETE FROM setup_tokens WHERE user_id=?`).run(row.user_id);
  const session = crypto.randomBytes(24).toString("hex");
  await db.prepare(`INSERT INTO sessions (token, user_id) VALUES (?,?)`).run(session, row.user_id);
  setSessionCookie(res, session, req);
  const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(row.user_id);
  res.json({
    user: publicUser(user),
    likesLeft: isPlus(user.subscription) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(user.id)),
  });
});

installFeed({
  app,
  getDb: () => db,
  auth,
  upload,
  uploadPost,
  publicUser,
  blockedSet,
  maxVideoBytes: MAX_VIDEO_BYTES,
  engagement,
});

const sockets = new Map(); // userId -> Set of ws
function broadcastToUser(userId, payload) {
  const set = sockets.get(Number(userId));
  if (!set) return;
  const raw = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

installStories({
  app,
  getDb: () => db,
  auth,
  publicUser,
  blockedSet,
  broadcastToUser,
  uploadDir,
});
installSocialExtras({
  app,
  getDb: () => db,
  auth,
  publicUser,
  blockedSet,
  broadcastToUser: (...args) => broadcastToUser(...args),
});

installChat({
  app,
  getDb: () => db,
  auth,
  publicUser,
  blockedSet,
  pairIds,
  broadcastToUser,
  sharedShows,
  getDemoChat: () => demoChat,
});


installGroups({
  app,
  getDb: () => db,
  auth,
  upload,
  publicUser,
  blockedSet,
  broadcastToUser: (userId, payload) => broadcastToUser(userId, payload),
});

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "kandi" }));

app.get(["/privacy", "/privacy.html"], (_req, res) => {
  res.sendFile(path.join(root, "public", "privacy.html"));
});
app.get(["/terms", "/terms.html"], (_req, res) => {
  res.sendFile(path.join(root, "public", "terms.html"));
});
app.get(["/support", "/support.html"], (_req, res) => {
  res.sendFile(path.join(root, "public", "support.html"));
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads") || req.path.startsWith("/ws")) return next();
  sendIndex(res);
});

app.use((err, req, res, _next) => {
  console.error(req.method, req.path, err);
  if (res.headersSent) return;
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status >= 500 ? "Something went wrong on our side. Try again." : (err.message || "Request failed") });
});
process.on("unhandledRejection", (err) => console.error("unhandledRejection", err));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

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
    const { seed, seedSocial, seedStories } = require("./seed");
    if (!row || Number(row.c) === 0) {
      await seed(db);
      console.log("Seeded demo data on boot (empty database).");
    } else {
      try {
        await seedSocial(db);
        console.log("Ensured social seed (follows/posts) on boot.");
      } catch (err) {
        console.error("Social seed on boot failed:", err.message || err);
      }
      try {
        await seedDemoMeetups(db);
      } catch (err) {
        console.error("Demo meetup seed on boot failed:", err.message || err);
      }
      try {
        await seedStories(db);
        console.log("Ensured demo stories on boot.");
      } catch (err) {
        console.error("Story seed on boot failed:", err.message || err);
      }
      try {
        const { ensureDemoGenres } = require("./seed");
        const n = await ensureDemoGenres(db);
        if (n) console.log("Updated genre badges on " + n + " demo profiles.");
      } catch (err) {
        console.error("Demo genre seed on boot failed:", err.message || err);
      }
    }
  }
  Object.assign(engagement, createEngagement(() => db));
  demoChat = createDemoChat({ getDb: () => db, publicUser, broadcastToUser });
  startDisappearSweeper(() => db, broadcastToUser);
  try {
    await engagement.refreshNow();
    console.log("Engagement scores refreshed.");
  } catch (err) {
    console.error("Engagement refresh on boot failed:", err.message || err);
  }
  engagement.startPeriodicRefresh();
  server.listen(PORT, HOST, () => {
    console.log(`Kandi v1 listening on http://${HOST}:${PORT}`);
  });
}

boot().catch((err) => {
  console.error("Failed to start Kandi:", err);
  process.exit(1);
});
