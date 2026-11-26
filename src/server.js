"use strict";

require("./load-env");
const socials = require("./socials");

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
const { installShowInvites } = require("./show-invites");
const { installVerification, isAdminUser, maybeStaleVerification, publicStatus } = require("./verification");
const referrals = require("./referrals");
const { normalizeMeetIntent, canConnect, visibleInMode, resolveMode, allowedModes, matchKindFromMode, backfillMatchKinds } = require("./meet-intent");
const { installGroups } = require("./group-routes");
const { installSocialExtras } = require("./social-extras");
const { savePhotoFile, sendUploadedMedia, startPhotoBackfill, removePhotoFile, removePhotoFilesForUser, registerStoredPhotoFile, MAX_UPLOAD_BYTES } = require("./photo");
const objectStore = require("./object-store");
const { installObjectStoreRoutes } = require("./object-store-routes");
const { eventKey, chipLabel } = require("./event-key");
const {
  isAdult, loadGoingRows, shapeGoers, resolveEvent, setRsvp,
  listUpcomingForProfile, sharedShows, upcomingByUser, seedDemoMeetups, compactShow, truthy,
} = require("./meetup");
const { parseTunes, MAX_TUNES } = require("./tunes");
const { installStories } = require("./stories");
const { contentRejected, rejectedFromAll } = require("./content-filter");

const { sendBuffer, MAX_VIDEO_BYTES } = require("./media");
const videoTools = require("./video");
const storageGuard = require("./storage-guard");
const { buildIcs, googleCalendarUrl, icsFilename } = require("./event-calendar");
const { createEngagement, compareDiscover, compareGoers } = require("./engagement");
const { createDemoChat } = require("./demo-chat");
const { catalog: genreCatalog, normalizeGenreIds, publicGenres, sharedGenreIds, sharedGenreChip, eventMatchesGenre, getGenre, MAX_GENRES } = require("./genres");
const billing = require("./stripe-billing");
const founding = require("./founding");
const iap = require("./iap");
const mailer = require("./email");
const songs = require("./song");
const followRules = require("./follow-rules");

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
// Stripe webhooks need the raw body for signature verification. Mount before express.json.
billing.mountStripeWebhook(app, () => db);
app.use(express.json({ limit: "1mb" }));
app.get("/uploads/:id", async (req, res, next) => {
  try {
    // Videos are too big for the photo cache; keep a few in memory so iPhone range requests stay fast.
    // Object-stored files redirect to a signed or public URL and never load the blob through Render.
    const vid = String(req.params.id || "");
    if (await sendUploadedMedia(req, res, db)) return;
    const cached = videoTools.cacheGet(vid);
    if (cached) {
      res.setHeader("ETag", videoTools.etagFor(vid));
      return sendBuffer(req, res, cached.buffer, cached.mime);
    }
    if (/\.(mp4|mov|webm|m4v)$/i.test(vid)) {
      const row = await db.prepare(`SELECT mime, data, object_key FROM photo_files WHERE id=?`).get(vid);
      const mime = row ? String(row.mime || "") : "";
      if (row && mime.startsWith("video/") && row.data) {
        const raw = Buffer.isBuffer(row.data) ? row.data : Buffer.from(String(row.data), "base64");
        videoTools.cachePut(vid, { buffer: raw, mime });
        res.setHeader("ETag", videoTools.etagFor(vid));
        return sendBuffer(req, res, raw, mime);
      }
    }
    next();
  } catch (err) { next(err); }
});
app.use("/uploads", express.static(uploadDir, {
  maxAge: "365d",
  immutable: true,
  setHeaders(res) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  },
}));
const BUILD = String(process.env.RENDER_GIT_COMMIT || Date.now().toString(36)).slice(0, 12);
function noStore(res) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}
let indexHtmlCache = null;
function sendIndex(req, res) {
  if (!indexHtmlCache) {
    indexHtmlCache = fs.readFileSync(path.join(root, "public", "index.html"), "utf8")
      .replace(/(href|src)="\/(styles\.css|design\.css|app\.js|video-prep\.js)"/g, `$1="/$2?v=${BUILD}"`);
  }
  noStore(res);
  try { referrals.stamp(req, res); } catch (_) {}
  res.type("html").send(indexHtmlCache);
}
app.get(["/", "/index.html"], (req, res) => sendIndex(req, res));
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
    if (!isAdult(u) || mailer.isLocked(u) || blocked.has(Number(u.id))) continue;
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
  referrals.appendSetCookie(res, `kandi_sid=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`);
}
function clearSessionCookie(res) {
  referrals.appendSetCookie(res, "kandi_sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

async function getUserFromReq(req) {
  const token = parseCookies(req).kandi_sid;
  if (!token) return null;
  const row = await db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  return row || null;
}

// While an account is waiting on email confirmation, only these routes work.
function allowedWhileUnverified(req) {
  const p = String(req.originalUrl || req.url || "").split("?")[0];
  const m = req.method;
  if (m === "GET" && p === "/api/me") return true;
  if (m === "POST" && p === "/api/logout") return true;
  if (m === "DELETE" && p === "/api/account") return true;
  if (p.startsWith("/api/email/")) return true;
  if (m === "POST" && p === "/api/me/email") return true;
  return false;
}

async function auth(req, res, next) {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Sign in required" });
    if (mailer.isLocked(user) && !allowedWhileUnverified(req)) {
      return res.status(403).json({ error: "Confirm your email to start using Kandi.", code: "email_unverified" });
    }
    req.user = await expireComplimentaryIfNeeded(user);
    engagement.recordActivity(user.id).catch(() => {});
    referrals.touchUser(db, req, res, req.user).catch(() => {});
    next();
  } catch (err) { next(err); }
}

const MAX_PROFILE_PHOTOS = 6;
const MAX_PROFILE_VIDEOS = 3;
// Profile media is one ordered list (users.photos): photo entries and { type: "video" } entries.
// Slot 1 must always be a photo so Discover, avatars and share cards keep a face.
function isVideoEntry(ph) { return Boolean(ph && ph.type === "video"); }
function photosOnly(list) { return (list || []).filter((ph) => ph && !isVideoEntry(ph)); }
function videosOnly(list) { return (list || []).filter(isVideoEntry); }
function fileIdFromUrl(url) {
  const m = String(url || "").match(/^\/uploads\/([^/?#]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function parsePhotos(raw) {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw || "[]") : (raw || []);
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function fileIdFromPhoto(ph) {
  if (isVideoEntry(ph)) return fileIdFromUrl(ph.url);
  if (!ph || ph.type !== "file" || !ph.url) return null;
  const m = String(ph.url).match(/^\/uploads\/([^/?#]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function saveUserPhotos(userId, photos) {
  const current = await db.prepare(`SELECT * FROM users WHERE id=?`).get(userId);
  await maybeStaleVerification(db, current, photos);
  await db.prepare(`UPDATE users SET photos=? WHERE id=?`).run(JSON.stringify(photos), userId);
  const fresh = await db.prepare(`SELECT * FROM users WHERE id=?`).get(userId);
  await referrals.maybeQualifyReferral(db, fresh);
  return publicUser(fresh);
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
  await removePhotoFile(db, fileId);
  videoTools.cacheDelete(fileId);
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
    photos: photosOnly(parseJsonList(u.photos, [])),
    media: parseJsonList(u.photos, []).filter(Boolean),
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
    songs: songs.parseStoredSongs(u.songs, u.favorite_song),
    favoriteSong: songs.parseStoredSongs(u.songs, u.favorite_song)[0] || null,
    topArtists: songs.parseStoredArtists(u.top_artists),
    isDemo: Boolean(u.is_demo),
    needsProfile: Boolean(Number(u.needs_profile)),
    showUpcoming: u.show_upcoming == null ? true : Boolean(Number(u.show_upcoming)),
    ...socials.publicSocials(u),
    subscription: u.subscription || null,
    createdAt: u.created_at,
    vibes: normalizeGenreIds(parseJsonList(u.vibes, [])),
    genres: publicGenres(u.vibes),
    isFounder: Boolean(Number(u.is_founder)),
    foundingNumber: u.founding_number ? Number(u.founding_number) : null,
    homeLocation: u.home_location || "",
    verified: publicStatus(u) === "approved",
    ambassador: Boolean(u.ambassador_at),
    meetIntent: normalizeMeetIntent(u.meet_intent),
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

function paidStripeStatus(user) {
  const status = String((user && user.subscription_status) || "").toLowerCase();
  return status === "active" || status === "trialing" || status === "past_due" || status === "paused";
}

function isPlus(userOrSub) {
  if (userOrSub && typeof userOrSub === "object") {
    if (founding.hasActiveComp(userOrSub)) return true;
    if (userOrSub.subscription === "vip") return true;
    if (userOrSub.subscription === "plus") {
      if (Number(userOrSub.is_founder) && userOrSub.plus_until && !founding.hasActiveComp(userOrSub) && !paidStripeStatus(userOrSub)) {
        return false;
      }
      return true;
    }
    return false;
  }
  return userOrSub === "plus" || userOrSub === "vip";
}

async function expireComplimentaryIfNeeded(user) {
  if (!user || !Number(user.is_founder) || !user.plus_until) return user;
  if (founding.hasActiveComp(user) || paidStripeStatus(user)) return user;
  if (user.subscription === "plus") {
    await db.prepare(`UPDATE users SET subscription=NULL WHERE id=? AND is_founder=1`).run(user.id);
    user.subscription = null;
  }
  return user;
}

// Only ever sent to the account owner — never part of publicUser.
function selfEmailExtra(user) {
  return {
    email: user.email || "",
    emailVerified: Boolean(user.email_verified_at),
    emailLocked: mailer.isLocked(user),
    emailVerificationOn: mailer.verificationActive(),
    allowLinkFollows: followRules.shareFollowEnabled(user),
    isAdmin: isAdminUser(user),
    verificationStatus: publicStatus(user),
    verified: publicStatus(user) === "approved",
    ...referrals.publicSelf(user),
  };
}

function selfBillingExtra(user, req) {
  return {
    ...selfEmailExtra(user),
    dateOfBirth: user.date_of_birth || "",
    plusUntil: user.plus_until || null,
    complimentaryActive: founding.hasActiveComp(user),
    founding: founding.publicFounding(user),
    billing: billing.publicBillingForUser(user, billing.getConfig(), { ios: isNativeIosClient(req) }),
    objectStorage: objectStore.clientConfig(),
  };
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

function parseProfileDob(raw, { required = false } = {}) {
  if (raw == null || String(raw).trim() === "") {
    if (required) return { error: "Enter your date of birth." };
    return null;
  }
  const value = founding.parseDob(raw);
  if (!value) return { error: "Enter your birthday as YYYY-MM-DD." };
  if (!founding.isAdultDob(value)) return { error: "Kandi is 18+. Check the birthday you entered." };
  return { value, age: founding.ageFromDob(value) };
}

// ---- auth ----
app.post("/api/signup", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").trim().replace(/\s+/g, " ");
  const age = Number(req.body.age);
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username must be 3–20 letters, numbers, or underscores." });
  const emailCheck = mailer.validateEmail(req.body.email);
  if (emailCheck.error) return res.status(400).json({ error: emailCheck.error, field: "email" });
  const email = emailCheck.value;
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (name.length < 2) return res.status(400).json({ error: "Please enter your name." });
  if (name.length > 40) return res.status(400).json({ error: "Keep your name to 40 characters or fewer." });
  if (!Number.isInteger(age) || age < 18 || age > 99) return res.status(400).json({ error: "Kandi is 18+. Enter an age between 18 and 99." });
  if (!acceptedTerms(req.body)) return res.status(400).json({ error: "Please agree to the Terms of Use and Privacy Policy to create an account." });
  const nameBad = contentRejected(name);
  if (nameBad) return res.status(400).json({ error: nameBad });
  const dob = parseProfileDob(req.body.dateOfBirth || req.body.date_of_birth, { required: false });
  if (dob && dob.error) return res.status(400).json({ error: dob.error });
  if (dob && dob.age != null && dob.age !== age) {
    // Birthday is the source of truth for 18+.
  }
  const homeLocation = clipText(req.body.homeLocation || req.body.home_location || "", 80, "");
  const meetIntent = normalizeMeetIntent(req.body.meetIntent || req.body.meet_intent, "both");
  const gender = normalizeGender(req.body.gender);
  const exists = await db.prepare(`SELECT id FROM users WHERE lower(username)=?`).get(username);
  if (exists) return res.status(409).json({ error: "That username is taken." });
  if (await emailTaken(email)) return res.status(409).json({ error: "That email is already on a Kandi account. Log in instead, or use a different email.", field: "email" });
  const hash = bcrypt.hashSync(password, 10);
  const mustVerify = mailer.verificationActive() ? 1 : 0;
  let info;
  try {
    info = await db.prepare(`INSERT INTO users (username,password_hash,name,age,date_of_birth,home_location,email,email_verify_required,meet_intent,gender) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(username, hash, name, age, (dob && dob.value) || null, homeLocation || null, email, mustVerify, meetIntent, gender);
  } catch (err) {
    if (/unique|duplicate/i.test(String(err && err.message))) return res.status(409).json({ error: "That username or email is already taken." });
    throw err;
  }
  const token = crypto.randomBytes(24).toString("hex");
  await db.prepare(`INSERT INTO sessions (token, user_id) VALUES (?,?)`).run(token, Number(info.lastInsertRowid));
  setSessionCookie(res, token, req);
  let user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(Number(info.lastInsertRowid));
  try { await founding.claimFounding(db, user); } catch (err) { console.error("Founding claim on signup failed:", err && err.message); }
  try {
    await referrals.touchUser(db, req, res, user);
    await referrals.attributeSignup(db, { user, code: req.body.referralCode || req.body.referral_code, req, res });
  } catch (err) { console.error("Referral attribute on signup failed:", err && err.message); }
  let emailSent = false;
  if (mustVerify) {
    try { emailSent = (await sendVerification(user, req)).sent; } catch (err) { console.error("Verification email on signup failed:", err && err.message); }
  }
  user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
  const demos = await db.prepare(`SELECT id FROM users WHERE is_demo=1 AND id != ? LIMIT 2`).all(user.id);
  for (const d of demos) {
    try {
      await db.prepare(`INSERT INTO likes (from_id,to_id,target_type,target_id,comment) VALUES (?,?,?,?,?)`)
        .run(d.id, user.id, "photo", "0", "Welcome to the floor.");
    } catch (_) { /* already liked */ }
  }
  res.json({ user: publicUser(user, selfBillingExtra(user, req)), emailSent });
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
  try { await referrals.touchUser(db, req, res, user); } catch (_) {}
  res.json({ user: publicUser(user, selfBillingExtra(user, req)), likesLeft: isPlus(user) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(user.id)) });
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
  try {
    const selfies = await db.prepare(`SELECT selfie_key FROM verification_requests WHERE user_id=?`).all(id);
    await objectStore.deleteKeys((selfies || []).map((r) => r.selfie_key));
    await db.prepare(`DELETE FROM verification_requests WHERE user_id=?`).run(id);
  } catch (_) { /* table may not exist yet */ }
  try { await referrals.voidInvitee(db, id); } catch (_) { /* table may not exist yet */ }
  await removePhotoFilesForUser(db, id);
  try {
    const chats = await db.prepare(`SELECT object_key, thumb_key FROM chat_files WHERE user_id=?`).all(id);
    await objectStore.deleteKeys((chats || []).flatMap((r) => [r.object_key, r.thumb_key]));
  } catch (err) { console.error("object-store delete chat on account close:", err && err.message); }
  await db.prepare(`DELETE FROM chat_files WHERE user_id=?`).run(id);
  await db.prepare(`DELETE FROM setup_tokens WHERE user_id=?`).run(id);
  try { await billing.cancelStripeForUser(req.user, billing.getConfig()); } catch (err) {
    console.error("Stripe cancel on account delete failed:", err && err.message);
  }
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
    user: publicUser(req.user, {
      events: going.length ? going : JSON.parse(req.user.events || "[]"),
      upcomingShows: upcoming.shows,
      ...selfBillingExtra(req.user, req),
    }),
    likesLeft: isPlus(req.user) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(req.user.id)),
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

// Keep profile lists small and well-formed so one bad client can't store huge blobs.
function cleanLooking(list) {
  return (Array.isArray(list) ? list : []).map((v) => String(v || "").trim().slice(0, 40)).filter(Boolean).slice(0, 10);
}
function cleanPrompts(list) {
  return (Array.isArray(list) ? list : []).filter((p) => p && typeof p === "object").slice(0, 3).map((p) => ({
    id: String(p.id || "").slice(0, 40),
    q: String(p.q || "").trim().slice(0, 120),
    a: String(p.a || "").trim().slice(0, 300),
  })).filter((p) => p.q && p.a);
}
// Unify man/woman with male/female so Discover filters and profile labels stay in sync.
function normalizeGender(val) {
  const g = String(val == null ? "" : val).trim().toLowerCase();
  if (!g) return "";
  if (g === "man" || g === "m") return "male";
  if (g === "woman" || g === "w") return "female";
  return clipText(g, 40, "");
}
function genderMatches(value, wanted) {
  const w = String(wanted || "").trim().toLowerCase();
  if (!w || w === "all") return true;
  const v = String(value || "").trim().toLowerCase();
  const aliases = {
    male: ["male", "man", "m"],
    man: ["male", "man", "m"],
    female: ["female", "woman", "w"],
    woman: ["female", "woman", "w"],
  };
  return (aliases[w] || [w]).includes(v);
}

app.put("/api/me", auth, async (req, res) => {
  const body = req.body || {};
  const name = body.name != null ? String(body.name).trim().replace(/\s+/g, " ").slice(0, 40) : req.user.name;
  const bio = body.bio != null ? String(body.bio).slice(0, 500) : req.user.bio;
  const vibes = body.vibes != null ? JSON.stringify(normalizeGenreIds(body.vibes)) : req.user.vibes;
  const looking = body.looking != null ? JSON.stringify(cleanLooking(body.looking)) : req.user.looking;
  const meetIntent = body.meetIntent != null || body.meet_intent != null
    ? normalizeMeetIntent(body.meetIntent || body.meet_intent, "both")
    : normalizeMeetIntent(req.user.meet_intent, "both");
  if (body.prompts != null) body.prompts = cleanPrompts(body.prompts);
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
  const gender = body.gender != null ? normalizeGender(body.gender) : normalizeGender(req.user.gender);
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
  let dateOfBirth = req.user.date_of_birth || null;
  if (body.dateOfBirth !== undefined || body.date_of_birth !== undefined) {
    const dob = parseProfileDob(body.dateOfBirth != null ? body.dateOfBirth : body.date_of_birth, { required: false });
    if (dob && dob.error) return res.status(400).json({ error: dob.error });
    dateOfBirth = dob ? dob.value : null;
    if (dob && dob.age != null) age = dob.age;
  }
  let homeLocation = req.user.home_location || "";
  if (body.homeLocation !== undefined || body.home_location !== undefined) {
    homeLocation = clipText(body.homeLocation != null ? body.homeLocation : body.home_location, 80, "");
  }
  let instagram = req.user.instagram || "";
  if (body.instagram != null) {
    const r = socials.normalizeInstagram(body.instagram);
    if (r.error) return res.status(400).json({ error: r.error, field: "instagram" });
    instagram = r.value;
  }
  let facebook = req.user.facebook || "";
  if (body.facebook != null) {
    const r = socials.normalizeFacebook(body.facebook);
    if (r.error) return res.status(400).json({ error: r.error, field: "facebook" });
    facebook = r.value;
  }
  let spotify = req.user.spotify || "";
  if (body.spotify != null) {
    const r = socials.normalizeSpotify(body.spotify);
    if (r.error) return res.status(400).json({ error: r.error, field: "spotify" });
    spotify = r.value;
  }
  let artistList = songs.parseStoredArtists(req.user.top_artists);
  if (body.topArtists !== undefined) {
    if (body.topArtists !== null && !Array.isArray(body.topArtists)) return res.status(400).json({ error: "Pick your top artists from the search results.", field: "topArtists" });
    const raw = body.topArtists || [];
    if (raw.length > songs.MAX_ARTISTS) return res.status(400).json({ error: "You can add up to " + songs.MAX_ARTISTS + " top artists.", field: "topArtists" });
    const clean = songs.normalizeArtistList(raw);
    if (clean.length !== new Set(raw.map((x) => x && Number(x.artistId))).size) return res.status(400).json({ error: "Pick your top artists from the search results.", field: "topArtists" });
    artistList = clean;
  }
  // My songs: up to 5 picks from /api/music/search, in order. Omitted = unchanged.
  let songList = songs.parseStoredSongs(req.user.songs, req.user.favorite_song);
  let favoriteSong = req.user.favorite_song || "";
  if (body.songs !== undefined) {
    if (body.songs !== null && !Array.isArray(body.songs)) return res.status(400).json({ error: "Pick your songs from the search results.", field: "songs" });
    const raw = body.songs || [];
    if (raw.length > songs.MAX_SONGS) return res.status(400).json({ error: "You can add up to " + songs.MAX_SONGS + " songs.", field: "songs" });
    const clean = songs.normalizeSongList(raw);
    if (clean.length !== new Set(raw.map((x) => x && Number(x.trackId))).size) return res.status(400).json({ error: "Pick your songs from the search results.", field: "songs" });
    songList = clean;
    favoriteSong = songList[0] ? JSON.stringify(songList[0]) : "";
  } else if (body.favoriteSong !== undefined) {
    if (body.favoriteSong === null || body.favoriteSong === "" || body.favoriteSong === false) {
      favoriteSong = "";
    } else {
      const song = songs.normalizeSong(body.favoriteSong);
      if (!song) return res.status(400).json({ error: "Pick your favorite song from the search results.", field: "favoriteSong" });
      favoriteSong = JSON.stringify(song);
    }
    // Older clients edit only the first slot.
    const first = favoriteSong ? JSON.parse(favoriteSong) : null;
    songList = first ? [first, ...songList.slice(1).filter((x) => x.trackId !== first.trackId)].slice(0, songs.MAX_SONGS) : songList.slice(1);
    if (!first && songList[0]) favoriteSong = JSON.stringify(songList[0]);
  }
  await db.prepare(`UPDATE users SET name=?, bio=?, vibes=?, looking=?, prompts=?, age=?, gender=?, pronouns=?, interested_in=?, favorite_artists=?, favorite_festival=?, favorite_venue=?, favorite_hangout=?, kandi_trades=?, rave_totem=?, years_raving=?, sex=?, height_in=?, hobbies=?, favorite_tunes=?, show_upcoming=?, date_of_birth=?, home_location=?, instagram=?, facebook=?, spotify=?, top_artists=?, favorite_song=?, songs=?, meet_intent=? WHERE id=?`).run(
    name, bio, vibes, looking, prompts, age, gender, pronouns, interestedIn, favoriteArtists, favoriteFestival, favoriteVenue, favoriteHangout, kandiTrades, raveTotem, yearsRaving, sex, heightIn, hobbies, favoriteTunes, showUpcoming, dateOfBirth, homeLocation, instagram, facebook, spotify, JSON.stringify(artistList), favoriteSong, JSON.stringify(songList), meetIntent, req.user.id
  );
  let user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  try { await founding.claimFounding(db, user); } catch (err) { console.error("Founding claim on profile save failed:", err && err.message); }
  user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  await referrals.maybeQualifyReferral(db, user);
  user = await expireComplimentaryIfNeeded(await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id));
  const upcoming = await listUpcomingForProfile(db, user, user);
  res.json({ user: publicUser(user, { upcomingShows: upcoming.shows, ...selfBillingExtra(user, req) }), likesLeft: isPlus(user) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(user.id)) });
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
    if (photosOnly(photos).length >= MAX_PROFILE_PHOTOS) {
      return res.status(400).json({ error: "You can add up to 6 photos. Remove one to add another." });
    }
    let fileId;
    try {
      fileId = await savePhotoFile(db, { userId: req.user.id, buffer: req.file.buffer, mime: req.file.mimetype, uploadDir });
    } catch (normErr) {
      return res.status(normErr.status || 400).json({ error: normErr.message || "Couldn't process that photo." });
    }
    const entry = { type: "file", url: "/uploads/" + fileId, caption: String((req.body && req.body.caption) || "") };
    const asMain = req.body && (req.body.main === "1" || req.body.main === "true" || req.body.asMain === "1");
    if (asMain || photos.length === 0) photos.unshift(entry);
    else photos.push(entry);
    const user = await saveUserPhotos(req.user.id, photos);
    console.log("photo-upload ok", { userId: Number(req.user.id), bytesIn: req.file.size, fileId, main: Boolean(asMain) });
    res.json({ user });
  });
});

app.delete("/api/me/photo/:index", auth, async (req, res) => {
  const index = Number(req.params.index);
  const photos = parsePhotos(req.user.photos);
  if (!Number.isInteger(index) || index < 0 || index >= photos.length) {
    return res.status(404).json({ error: "Photo not found." });
  }
  if (!isVideoEntry(photos[index]) && photosOnly(photos).length === 1 && videosOnly(photos).length) {
    return res.status(400).json({ error: "Keep at least one photo so people can see your face. Add another photo first, or remove your videos." });
  }
  const removed = photos.splice(index, 1)[0];
  // Slot 1 stays a photo.
  if (photos.length && isVideoEntry(photos[0])) {
    const i = photos.findIndex((ph) => !isVideoEntry(ph));
    if (i > 0) photos.unshift(photos.splice(i, 1)[0]);
  }
  await deletePhotoFileIfOwned(fileIdFromPhoto(removed), req.user.id);
  if (isVideoEntry(removed) && removed.poster) await deletePhotoFileIfOwned(fileIdFromUrl(removed.poster), req.user.id);
  const user = await saveUserPhotos(req.user.id, photos);
  res.json({ user });
});

app.post("/api/me/photo/main", auth, async (req, res) => {
  const index = Number(req.body && req.body.index);
  const photos = parsePhotos(req.user.photos);
  if (!Number.isInteger(index) || index < 0 || index >= photos.length) {
    return res.status(400).json({ error: "Pick one of your photos to set as main." });
  }
  if (isVideoEntry(photos[index])) return res.status(400).json({ error: "Your main slot has to be a photo so people can see your face." });
  if (index !== 0) {
    const [picked] = photos.splice(index, 1);
    photos.unshift(picked);
  }
  const user = await saveUserPhotos(req.user.id, photos);
  res.json({ user });
});

async function completeDirectProfileVideo(req, res) {
  if (!objectStore.enabled()) return res.status(400).json({ error: "Direct uploads are not enabled yet." });
  const key = String((req.body && req.body.key) || "");
  const mimeIn = String((req.body && req.body.mime) || "video/mp4");
  const fileIdIn = String((req.body && req.body.fileId) || "");
  const posterKey = String((req.body && req.body.posterKey) || "");
  const posterFileId = String((req.body && req.body.posterFileId) || "");
  if (!key || !objectStore.keyOwnedBy(key, { userId: req.user.id, kind: "videos" })) {
    return res.status(400).json({ error: "That upload doesn't belong to this account." });
  }
  const head = await objectStore.headObject(key);
  if (!head) return res.status(400).json({ error: "We couldn't find that upload. Try again." });
  if (head.contentLength && head.contentLength > MAX_VIDEO_BYTES) return res.status(400).json({ error: "That video didn't get shrunk before sending. Close and reopen Kandi, then try again." });
  const fresh = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  const list = parsePhotos(fresh && fresh.photos);
  if (!photosOnly(list).length) return res.status(400).json({ error: "Add a photo first. Your first slot is always a photo so people can see your face." });
  if (videosOnly(list).length >= MAX_PROFILE_VIDEOS) return res.status(400).json({ error: "You can add up to " + MAX_PROFILE_VIDEOS + " videos. Remove one to add another." });
  const videoId = fileIdIn || key.split("/").pop();
  await registerStoredPhotoFile(db, { id: videoId, userId: req.user.id, mime: mimeIn, key, ready: 1 });
  let posterId = null;
  if (posterKey && objectStore.keyOwnedBy(posterKey, { userId: req.user.id, kind: "photos" })) {
    const phead = await objectStore.headObject(posterKey);
    if (phead) {
      posterId = posterFileId || posterKey.split("/").pop();
      try { await registerStoredPhotoFile(db, { id: posterId, userId: req.user.id, mime: phead.contentType || "image/jpeg", key: posterKey, ready: 1 }); }
      catch (_) { posterId = null; }
    }
  }
  const duration = Math.min(60, Math.max(0, Math.round(Number(req.body && req.body.duration) || 0)));
  list.push({ type: "video", url: "/uploads/" + videoId, poster: posterId ? "/uploads/" + posterId : null, duration, caption: "" });
  const user = await saveUserPhotos(req.user.id, list);
  console.log("profile-video direct ok", { userId: Number(req.user.id), bytes: head.contentLength || 0, videoId });
  res.json({ user });
}

// Profile videos: same browser shrink (public/video-prep.js), server finish and storage as posts/stories.
app.post("/api/me/video", auth, (req, res) => {
  if (String(req.headers["content-type"] || "").includes("application/json")) {
    return completeDirectProfileVideo(req, res).catch((e) => {
      console.error("profile video direct upload failed:", e && (e.message || e));
      res.status(500).json({ error: "Couldn't add that video. Try again." });
    });
  }
  uploadPost.fields([{ name: "video", maxCount: 1 }, { name: "poster", maxCount: 1 }])(req, res, async (err) => {
    try {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE"
          ? "That video didn't get shrunk before sending. Close and reopen Kandi, then try again."
          : (err.message || "Upload failed");
        return res.status(400).json({ error: msg });
      }
      const files = req.files || {};
      const videoFile = (files.video && files.video[0]) || null;
      const posterFile = (files.poster && files.poster[0]) || null;
      if (!videoFile) return res.status(400).json({ error: "Choose a video to add." });
      const fresh = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
      const list = parsePhotos(fresh && fresh.photos);
      if (!photosOnly(list).length) return res.status(400).json({ error: "Add a photo first. Your first slot is always a photo so people can see your face." });
      if (videosOnly(list).length >= MAX_PROFILE_VIDEOS) return res.status(400).json({ error: "You can add up to " + MAX_PROFILE_VIDEOS + " videos. Remove one to add another." });
      if (videoFile.size > MAX_VIDEO_BYTES) return res.status(400).json({ error: "That video didn't get shrunk before sending. Close and reopen Kandi, then try again." });
      const room = await storageGuard.videoUploadAllowed(db);
      if (!room.ok) return res.status(507).json({ error: room.error, code: "storage_full" });
      const { sniffVideoMime } = require("./media");
      const mime = sniffVideoMime(videoFile.buffer, videoFile.originalname, videoFile.mimetype);
      if (!mime || !String(mime).startsWith("video/")) return res.status(400).json({ error: "Please choose a short video (.mov or .mp4)." });
      const done = await videoTools.finishVideo(videoFile.buffer, mime, { maxSeconds: 60, wantPoster: true });
      if (done.tooLong) return res.status(400).json({ error: "Videos can be up to 60 seconds. Trim it in Photos and try again." });
      const videoId = await savePhotoFile(db, { userId: req.user.id, buffer: done.buffer, mime: done.mime, ext: done.ext });
      storageGuard.noteBytes(done.buffer.length);
      let posterId = null;
      try {
        const posterMime = posterFile ? require("./photo").sniffImageMime(posterFile.buffer) : null;
        if (posterFile && posterMime) posterId = await savePhotoFile(db, { userId: req.user.id, buffer: posterFile.buffer, mime: posterMime });
        if (!posterId && done.poster) posterId = await savePhotoFile(db, { userId: req.user.id, buffer: done.poster, mime: "image/jpeg", ext: ".jpg" });
      } catch (_) { posterId = null; /* poster is optional */ }
      const duration = Math.round(Number(done.duration) || Number(req.body && req.body.duration) || 0);
      list.push({ type: "video", url: "/uploads/" + videoId, poster: posterId ? "/uploads/" + posterId : null, duration: Math.min(60, Math.max(0, duration)), caption: "" });
      const user = await saveUserPhotos(req.user.id, list);
      console.log("profile-video ok", { userId: Number(req.user.id), bytes: done.buffer.length, videoId });
      res.json({ user });
    } catch (e) {
      console.error("profile video upload failed:", e && (e.message || e));
      res.status(500).json({ error: "Couldn't add that video. Try again." });
    }
  });
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
  if (next.length && isVideoEntry(next[0])) return res.status(400).json({ error: "Your first slot has to be a photo so people can see your face." });
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
  let event = String(req.query.event || "all");
  const gender = String(req.query.gender || "all");
  const mode = resolveMode(req.user, req.query.mode || req.query.meet);
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
    .filter((u) => isAdult(u) && !mailer.isLocked(u) && !blocked.has(Number(u.id)) && !liked.has(u.id) && !passed.has(u.id) && !matched.has(u.id));
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
    const showUpcoming = u.show_upcoming == null || Number(u.show_upcoming) !== 0;
    return publicUser(u, {
      sharedEvents: shared,
      sharedEventChip: shared[0] ? ("Also going to " + (shared[0].chip || shared[0].name)) : "",
      sharedGenres: sharedGenreIds(myGenres, theirVibes),
      sharedGenreChip: sharedGenreChip(myGenres, theirVibes),
      upcomingShows: showUpcoming ? (showsByUser.get(Number(u.id)) || []).map((e) => compactShow(e)) : [],
      upcomingHidden: !showUpcoming,
      showUpcoming,
    });
  });
  if (genreId) people = people.filter((p) => p.vibes.includes(genreId));
  // Event-specific filters stay Kandi+, except "same show," which is free.
  if (event !== "all" && event !== "same" && !isPlus(req.user)) event = "all";
  if (event === "same") {
    people = people.filter((p) => (p.sharedEvents || []).length);
  } else if (event !== "all") {
    const ids = event.split(",").map((s) => s.trim()).filter(Boolean);
    people = people.filter((p) => {
      const theirs = showsByUser.get(Number(p.id)) || [];
      return theirs.some((e) => ids.includes(String(e.id)) || ids.includes(String(e.event_key)))
        || ids.some((id) => (p.events || []).map(String).includes(id));
    });
  }
  people = people.filter((p) => visibleInMode(req.user, { ...p, meet_intent: p.meetIntent, interested_in: p.interestedIn }, mode));
  if (gender !== "all") people = people.filter((p) => genderMatches(p.gender, gender));
  const lo = Number.isFinite(ageMin) ? ageMin : 18;
  const hi = Number.isFinite(ageMax) ? ageMax : 99;
  if (lo > 18 || hi < 99) {
    people = people.filter((p) => p.age != null && p.age >= lo && p.age <= hi);
  }
  res.json({
    people,
    mode,
    allowedModes: allowedModes(req.user),
    likesLeft: isPlus(req.user) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(req.user.id)),
  });
});

async function maybeMatch(fromId, toId, kind) {
  const back = await db.prepare(`SELECT id FROM likes WHERE from_id=? AND to_id=?`).get(toId, fromId);
  if (!back) return null;
  const [a, b] = pairIds(fromId, toId);
  const existing = await db.prepare(`SELECT * FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
  if (existing) return existing;
  const matchKind = kind === "date" ? "date" : "friend";
  const info = await db.prepare(`INSERT INTO matches (a_id, b_id, match_kind) VALUES (?,?,?)`).run(a, b, matchKind);
  try { await followRules.clearUnmatched(db, a, b); } catch (_) {}
  return await db.prepare(`SELECT * FROM matches WHERE id=?`).get(Number(info.lastInsertRowid));
}

app.post("/api/like", auth, async (req, res) => {
  const toId = Number(req.body.userId);
  const targetType = req.body.type === "prompt" ? "prompt" : "photo";
  const targetId = String(req.body.targetId || "0");
  const comment = String(req.body.comment || "").slice(0, 280);
  if (!toId || toId === req.user.id) return res.status(400).json({ error: "Invalid like." });
  if ((await blockedSet(req.user.id)).has(toId)) return res.status(400).json({ error: "You can't like this person." });
  const targetUser = await db.prepare(`SELECT * FROM users WHERE id=?`).get(toId);
  if (!targetUser) return res.status(404).json({ error: "That profile isn't available." });
  const mode = resolveMode(req.user, req.body.mode || req.body.meetMode);
  if (!visibleInMode(req.user, targetUser, mode)) {
    return res.status(400).json({ error: "They're not in this Discover mode, or you're looking for different things." });
  }
  if (!isPlus(req.user) && await likesUsedToday(req.user.id) >= DAILY_LIKES) {
    return res.status(402).json({ error: "You're out of free likes today.", code: "plus_required", reason: "likes" });
  }
  try {
    await db.prepare(`INSERT INTO likes (from_id,to_id,target_type,target_id,comment) VALUES (?,?,?,?,?)`).run(req.user.id, toId, targetType, targetId, comment);
  } catch (e) {
    return res.status(409).json({ error: "You already liked this person." });
  }
  await db.prepare(`DELETE FROM passes WHERE from_id=? AND to_id=?`).run(req.user.id, toId);
  if (!isPlus(req.user)) await bumpLike(req.user.id);
  const match = await maybeMatch(req.user.id, toId, matchKindFromMode(mode));
  if (match) broadcastToUser(toId, { type: "match", user: publicUser(req.user), matchId: match.id, matchKind: match.match_kind || matchKindFromMode(mode) });
  else broadcastToUser(toId, { type: "like", from: publicUser(req.user), targetType, targetId, comment });
  engagement.scheduleRefresh();
  res.json({
    ok: true,
    matched: Boolean(match),
    matchId: match ? match.id : null,
    matchKind: match ? (match.match_kind || "") : "",
    likesLeft: isPlus(req.user) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(req.user.id)),
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
  if (!isPlus(req.user)) return res.status(402).json({ error: "Rewind is a Kandi+ feature.", code: "plus_required", reason: "rewind" });
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
  const visible = rows.filter((r) => canConnect(req.user, r));
  const count = visible.length;
  if (!isPlus(req.user)) {
    return res.json({ locked: true, count, people: visible.slice(0, 4).map((r) => ({ blurred: true, photos: publicUser(r).photos })) });
  }
  res.json({
    locked: false,
    count,
    people: visible.map((r) => ({
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
      matchKind: m.match_kind || "",
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
  await followRules.removeFollowsBetween(db, req.user.id, id);
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
  await followRules.removeFollowsBetween(db, req.user.id, id);
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

// ---- billing (Stripe on the web; never exposed inside the iOS app) ----
billing.installStripeBilling({
  app,
  getDb: () => db,
  auth,
  isNativeIosClient,
  publicUser,
});
iap.installIapRoutes({ app, auth, isNativeIosClient });

app.get("/api/plus/founding", async (_req, res) => {
  const status = await founding.spots(db);
  res.json(status);
});

app.post("/api/plus/claim-founding", auth, async (req, res) => {
  if (isNativeIosClient(req)) {
    return res.status(403).json({
      error: "Founding membership isn't available in the iOS app.",
      code: "plus_coming_soon",
    });
  }
  const body = req.body || {};
  const updates = [];
  const vals = [];
  if (body.dateOfBirth != null || body.date_of_birth != null) {
    const dob = parseProfileDob(body.dateOfBirth != null ? body.dateOfBirth : body.date_of_birth, { required: true });
    if (dob.error) return res.status(400).json({ error: dob.error });
    updates.push("date_of_birth=?", "age=?");
    vals.push(dob.value, dob.age);
  }
  if (body.homeLocation != null || body.home_location != null) {
    updates.push("home_location=?");
    vals.push(clipText(body.homeLocation != null ? body.homeLocation : body.home_location, 80, ""));
  }
  if (updates.length) {
    vals.push(req.user.id);
    await db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id=?`).run(...vals);
  }
  let user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  const result = await founding.claimFounding(db, user);
  user = await expireComplimentaryIfNeeded(await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id));
  const status = await founding.spots(db);
  res.status(result.ok || result.already ? 200 : (result.reason === "full" ? 409 : 400)).json({
    ok: Boolean(result.ok),
    reason: result.reason || null,
    granted: Boolean(result.granted),
    already: Boolean(result.already),
    founding: status,
    user: publicUser(user, selfBillingExtra(user, req)),
    likesLeft: isPlus(user) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(user.id)),
    message: result.granted
      ? (result.leftPaid
        ? "You're a founding member. Your existing paid plan was left as-is."
        : "You're a founding member. Kandi+ is on for a year.")
      : result.already
        ? "You're already a founding member."
        : result.reason === "full"
          ? "Founding spots are all claimed."
          : result.reason === "demo" || result.reason === "review"
            ? "This account isn't eligible for founding membership."
            : result.reason === "unverified"
              ? "Confirm your email and founding membership will be applied automatically."
              : "We couldn't apply founding membership just now.",
  });
});

app.post("/api/subscribe", auth, async (req, res) => {
  if (isNativeIosClient(req)) {
    return res.status(403).json({ error: "Kandi+ is coming soon and will be sold only through Apple In-App Purchase.", code: "plus_coming_soon" });
  }
  const config = billing.getConfig();
  if (config.enabled) {
    return res.status(400).json({ error: "Start a membership from checkout.", code: "use_checkout" });
  }
  return res.status(503).json({ error: "Kandi+ payments are not available yet.", code: "billing_disabled" });
});

app.post("/api/subscribe/cancel", auth, async (req, res) => {
  if (isNativeIosClient(req)) {
    return res.status(403).json({ error: "Kandi+ is coming soon and will be sold only through Apple In-App Purchase.", code: "plus_coming_soon" });
  }
  const config = billing.getConfig();
  if (config.enabled && req.user.stripe_customer_id) {
    return res.status(400).json({ error: "Manage or cancel your membership in the billing portal.", code: "use_portal" });
  }
  if (founding.hasActiveComp(req.user)) {
    return res.status(400).json({ error: "Your complimentary founding year is still active.", code: "founding_comp_active" });
  }
  await db.prepare(`UPDATE users SET subscription=NULL, subscription_status=NULL WHERE id=?`).run(req.user.id);
  const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  res.json({
    user: publicUser(user, { billing: billing.publicBillingForUser(user, config, { ios: false }) }),
  });
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
    likesLeft: isPlus(user) ? null : Math.max(0, DAILY_LIKES - await likesUsedToday(user.id)),
  });
});

// ---- email verification + password reset ----
async function emailTaken(email, exceptUserId) {
  const row = await db.prepare(`SELECT id FROM users WHERE lower(email)=?`).get(mailer.normalizeEmail(email));
  return Boolean(row && Number(row.id) !== Number(exceptUserId || 0));
}

async function sendVerification(user, req) {
  if (!user || !user.email) return { sent: false };
  const { token, hash } = mailer.newToken();
  const expires = new Date(Date.now() + mailer.VERIFY_TTL_MS).toISOString();
  await db.prepare(`UPDATE users SET email_verify_token_hash=?, email_verify_expires_at=?, email_verify_sent_at=? WHERE id=?`)
    .run(hash, expires, new Date().toISOString(), user.id);
  const url = mailer.publicBase(req) + "/verify-email?token=" + token;
  const msg = mailer.verifyMessage({ name: user.name, url });
  return mailer.sendMail({ to: user.email, ...msg, tag: "verify-email" });
}

function sendLimit(user) {
  const last = user.email_verify_sent_at ? Date.parse(user.email_verify_sent_at) : 0;
  if (last && Date.now() - last < mailer.RESEND_COOLDOWN_MS) {
    return { ok: false, retryInMs: mailer.RESEND_COOLDOWN_MS - (Date.now() - last) };
  }
  return mailer.rateLimit("verify:" + user.id, mailer.MAX_SENDS_PER_HOUR, 3600000);
}

function waitMsg(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s >= 90 ? `Too many emails. Try again in about ${Math.ceil(s / 60)} minutes.` : `Hang on ${s} seconds before sending another email.`;
}

// ---- share-my-profile links (the only way to follow someone you haven't matched) ----
app.get("/api/me/share-link", auth, async (req, res) => {
  const token = await followRules.ensureShareToken(db, req.user);
  res.json({ url: followRules.shareUrl(req.user, token, req), allowLinkFollows: followRules.shareFollowEnabled(req.user) });
});
app.post("/api/me/share-link/reset", auth, async (req, res) => {
  const token = await followRules.resetShareToken(db, req.user.id);
  res.json({ ok: true, url: followRules.shareUrl(req.user, token, req), allowLinkFollows: followRules.shareFollowEnabled(req.user) });
});
app.put("/api/me/share-settings", auth, async (req, res) => {
  const on = !(req.body && (req.body.allowLinkFollows === false || req.body.allowLinkFollows === 0 || req.body.allowLinkFollows === "0"));
  await db.prepare(`UPDATE users SET share_follow=? WHERE id=?`).run(on ? 1 : 0, req.user.id);
  res.json({ ok: true, allowLinkFollows: on });
});
// Limited card for someone who opened a share link. Works logged out; needs the right token.
const shareHits = new Map();
app.get("/api/share/:username", async (req, res) => {
  const ip = String(req.ip || "");
  const now = Date.now();
  const list = (shareHits.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= 30) return res.status(429).json({ error: "Too many tries. Try again in a minute." });
  list.push(now); shareHits.set(ip, list);
  if (shareHits.size > 5000) shareHits.clear();
  const username = String(req.params.username || "").trim().toLowerCase();
  const token = String(req.query.k || "");
  const target = /^[a-z0-9_]{3,20}$/.test(username) ? await db.prepare(`SELECT * FROM users WHERE lower(username)=?`).get(username) : null;
  const invalid = { error: "This profile link isn't working anymore. Ask them for a new one." };
  if (!target || !followRules.linkTokenValid(target, token) || mailer.isLocked(target)) return res.status(404).json(invalid);
  const me = await getUserFromReq(req);
  if (me && Number(me.id) !== Number(target.id) && await followRules.isBlockedEitherWay(db, me.id, target.id)) return res.status(404).json(invalid);
  if (me && Number(me.id) !== Number(target.id) && await followRules.isUnmatchedPair(db, me.id, target.id) && !(await followRules.isMutualMatch(db, me.id, target.id))) return res.status(404).json(invalid);
  const full = publicUser(target);
  const following = me ? Boolean(await db.prepare(`SELECT 1 AS x FROM follows WHERE follower_id=? AND following_id=?`).get(me.id, target.id)) : false;
  res.json({
    profile: {
      id: full.id, username: full.username, name: full.name, age: full.age,
      photos: (full.photos || []).slice(0, 1), genres: full.genres, vibes: full.vibes,
      favoriteSong: full.favoriteSong, songs: full.songs, homeLocation: full.homeLocation, isDemo: full.isDemo,
    },
    signedIn: Boolean(me), isMe: Boolean(me && Number(me.id) === Number(target.id)), following,
  });
});

// Song search for the "Favorite song" picker (Apple iTunes Search API, cached + rate-limited).
app.get("/api/music/search", auth, async (req, res) => {
  try {
    const kind = String(req.query.type || req.query.entity || "song").toLowerCase();
    const q = req.query.q || req.query.term || "";
    const out = (kind === "artist" || kind === "musicartist")
      ? await songs.searchArtists(q, { userId: req.user.id })
      : await songs.searchSongs(q, { userId: req.user.id });
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json({ results: out.results });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Search failed." });
  }
});

app.get("/api/auth/config", (_req, res) => {
  const st = mailer.status();
  res.json({ emailRequired: true, emailVerification: st.verificationActive, passwordReset: st.canSend });
});

// Resend the confirmation email, optionally fixing a typo in the address first.
app.post("/api/email/resend", auth, async (req, res) => {
  let user = req.user;
  if (!mailer.canSend()) return res.status(503).json({ error: "Email isn't set up yet. Try again later." });
  if (user.email_verified_at) return res.json({ ok: true, alreadyVerified: true, user: publicUser(user, selfEmailExtra(user)) });
  if (req.body && req.body.email != null && mailer.normalizeEmail(req.body.email) !== mailer.normalizeEmail(user.email)) {
    const check = mailer.validateEmail(req.body.email);
    if (check.error) return res.status(400).json({ error: check.error, field: "email" });
    if (await emailTaken(check.value, user.id)) return res.status(409).json({ error: "That email is already on another Kandi account.", field: "email" });
    await db.prepare(`UPDATE users SET email=?, email_verified_at=NULL WHERE id=?`).run(check.value, user.id);
    user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
  }
  if (!user.email) return res.status(400).json({ error: "Add your email address first.", field: "email" });
  const lim = sendLimit(user);
  if (!lim.ok) return res.status(429).json({ error: waitMsg(lim.retryInMs), retryInMs: lim.retryInMs });
  try {
    await sendVerification(user, req);
  } catch (err) {
    console.error("Verification resend failed:", err && err.message);
    return res.status(502).json({ error: "We couldn't send the email right now. Try again in a minute." });
  }
  user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
  res.json({ ok: true, sentTo: user.email, user: publicUser(user, selfEmailExtra(user)) });
});

// Existing accounts can add or change their email from Settings.
app.post("/api/me/email", auth, async (req, res) => {
  const check = mailer.validateEmail(req.body && req.body.email);
  if (check.error) return res.status(400).json({ error: check.error, field: "email" });
  let user = req.user;
  const same = mailer.normalizeEmail(user.email) === check.value;
  if (same && user.email_verified_at) return res.json({ ok: true, user: publicUser(user, selfEmailExtra(user)) });
  if (!same) {
    if (await emailTaken(check.value, user.id)) return res.status(409).json({ error: "That email is already on another Kandi account.", field: "email" });
    await db.prepare(`UPDATE users SET email=?, email_verified_at=NULL, email_verify_token_hash=NULL, email_verify_expires_at=NULL WHERE id=?`).run(check.value, user.id);
    user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
  }
  let sent = false;
  if (mailer.canSend()) {
    const lim = sendLimit(user);
    if (lim.ok) {
      try { sent = (await sendVerification(user, req)).sent; } catch (err) { console.error("Verification email failed:", err && err.message); }
    } else if (same) {
      return res.status(429).json({ error: waitMsg(lim.retryInMs), retryInMs: lim.retryInMs });
    }
  }
  user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
  res.json({ ok: true, sent, user: publicUser(user, selfEmailExtra(user)) });
});

// The link in the email lands on /verify-email, which POSTs the token here.
// No session needed: Mail usually opens Safari, which has its own cookies.
app.post("/api/email/verify", async (req, res) => {
  const token = String((req.body && req.body.token) || "").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: "That confirmation link isn't valid." });
  const ip = String(req.ip || "");
  if (!mailer.rateLimit("verify-ip:" + ip, 30, 3600000).ok) return res.status(429).json({ error: "Too many tries. Try again later." });
  const user = await db.prepare(`SELECT * FROM users WHERE email_verify_token_hash=?`).get(mailer.hashToken(token));
  if (!user) return res.status(404).json({ error: "That confirmation link was already used or has been replaced by a newer one. If you're not confirmed yet, open Kandi and tap Resend." });
  if (!user.email_verify_expires_at || Date.parse(user.email_verify_expires_at) < Date.now()) {
    return res.status(410).json({ error: "That confirmation link expired. Open Kandi and tap Resend to get a new one." });
  }
  await db.prepare(`UPDATE users SET email_verified_at=?, email_verify_token_hash=NULL, email_verify_expires_at=NULL WHERE id=?`)
    .run(new Date().toISOString(), user.id);
  let fresh = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
  try { await founding.claimFounding(db, fresh); } catch (err) { console.error("Founding claim on verify failed:", err && err.message); }
  res.json({ ok: true, username: fresh.username, name: fresh.name });
});

app.post("/api/password/forgot", async (req, res) => {
  const generic = { ok: true, message: "If that matches a Kandi account with an email, a reset link is on its way." };
  if (!mailer.canSend()) return res.status(503).json({ error: "Password reset by email isn't available yet. Contact support from the Support page." });
  const raw = String((req.body && (req.body.email || req.body.username || req.body.login)) || "").trim().toLowerCase();
  if (!raw) return res.status(400).json({ error: "Enter your email or username." });
  const ip = String(req.ip || "");
  if (!mailer.rateLimit("forgot-ip:" + ip, 10, 3600000).ok) return res.status(429).json({ error: "Too many requests. Try again later." });
  if (!mailer.rateLimit("forgot:" + raw, 3, 3600000).ok) return res.json(generic);
  const user = raw.includes("@")
    ? await db.prepare(`SELECT * FROM users WHERE lower(email)=?`).get(raw)
    : await db.prepare(`SELECT * FROM users WHERE lower(username)=?`).get(raw);
  if (!user || !user.email || Number(user.is_demo)) return res.json(generic);
  const { token, hash } = mailer.newToken();
  const expires = new Date(Date.now() + mailer.RESET_TTL_MS).toISOString();
  await db.prepare(`UPDATE users SET password_reset_token_hash=?, password_reset_expires_at=? WHERE id=?`).run(hash, expires, user.id);
  const url = mailer.publicBase(req) + "/reset-password?token=" + token;
  try {
    await mailer.sendMail({ to: user.email, ...mailer.resetMessage({ name: user.name, username: user.username, url }), tag: "password-reset" });
  } catch (err) {
    console.error("Password reset email failed:", err && err.message);
  }
  res.json(generic);
});

app.post("/api/password/reset", async (req, res) => {
  const token = String((req.body && req.body.token) || "").trim();
  const password = String((req.body && req.body.password) || "");
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: "That reset link isn't valid." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const ip = String(req.ip || "");
  if (!mailer.rateLimit("reset-ip:" + ip, 20, 3600000).ok) return res.status(429).json({ error: "Too many tries. Try again later." });
  const user = await db.prepare(`SELECT * FROM users WHERE password_reset_token_hash=?`).get(mailer.hashToken(token));
  if (!user || !user.password_reset_expires_at || Date.parse(user.password_reset_expires_at) < Date.now()) {
    return res.status(410).json({ error: "That reset link expired or was already used. Ask for a new one from the login screen." });
  }
  const hash = bcrypt.hashSync(password, 10);
  // Clicking the emailed link proves they own the address, so it also counts as confirming it.
  await db.prepare(`UPDATE users SET password_hash=?, password_reset_token_hash=NULL, password_reset_expires_at=NULL, email_verified_at=COALESCE(email_verified_at, ?), email_verify_token_hash=NULL WHERE id=?`)
    .run(hash, new Date().toISOString(), user.id);
  await db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(user.id);
  res.json({ ok: true, username: user.username });
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

installObjectStoreRoutes({ app, auth });
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

installShowInvites({
  app,
  getDb: () => db,
  auth,
  publicUser,
  blockedSet,
  broadcastToUser,
  getUserFromReq,
});

installVerification({
  app,
  getDb: () => db,
  auth,
  upload,
});

referrals.installReferrals({
  app,
  getDb: () => db,
  auth,
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
app.get("/healthz", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("text").send("ok");
});

app.get(["/privacy", "/privacy.html"], (_req, res) => {
  res.sendFile(path.join(root, "public", "privacy.html"));
});
app.get(["/terms", "/terms.html"], (_req, res) => {
  res.sendFile(path.join(root, "public", "terms.html"));
});
app.get(["/support", "/support.html"], (_req, res) => {
  res.sendFile(path.join(root, "public", "support.html"));
});
app.get(["/verify-email", "/verify-email.html"], (_req, res) => {
  noStore(res);
  res.sendFile(path.join(root, "public", "verify-email.html"));
});
app.get(["/reset-password", "/reset-password.html"], (_req, res) => {
  noStore(res);
  res.sendFile(path.join(root, "public", "reset-password.html"));
});

app.get(["/offline", "/offline.html"], (_req, res) => {
  noStore(res);
  res.sendFile(path.join(root, "public", "offline.html"));
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads") || req.path.startsWith("/ws")) return next();
  sendIndex(req, res);
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
    if (mailer.isLocked(user)) {
      ws.close(4003, "email_unverified");
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
  try {
    const n = await require("./seed").ensureDemoMeetIntent(db);
    if (n) console.log("Set looking-for (friends/dating/both) on " + n + " demo profiles.");
  } catch (err) {
    console.error("Demo meet intent seed failed:", err.message || err);
  }
  try {
    const n = await require("./seed").ensureDemoDetails(db);
    if (n) console.log("Updated gender preferences on " + n + " demo profiles.");
  } catch (err) {
    console.error("Demo details seed failed:", err.message || err);
  }
  try {
    const n = await backfillMatchKinds(db);
    if (n) console.log("Labeled " + n + " existing match(es) as friend or date.");
  } catch (err) {
    console.error("match kind backfill failed:", err.message || err);
  }
  try {
    const n = await require("./seed").ensureDemoSongs(db);
    if (n) console.log("Updated demo songs (" + n + " changes).");
  } catch (err) {
    console.error("Demo song seed failed:", err.message || err);
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
  try {
    const filled = await founding.backfillFounders(db);
    if (filled) {
      const paid = (filled.leftPaid || []).map((u) => u.username || ("id:" + u.id)).join(", ");
      console.log(
        "Founding backfill granted " + filled.granted + " members (" + filled.claimed + "/" + filled.cap +
        ", already " + (filled.already || 0) + ")." +
        (paid ? " Left paid Stripe subscribers alone (no refund): " + paid + "." : "")
      );
    }
  } catch (err) {
    console.error("Founding backfill failed:", err && err.message);
  }
  server.listen(PORT, HOST, () => {
    console.log(`Kandi v1 listening on http://${HOST}:${PORT}`);
    if (objectStore.enabled()) {
      console.log("object-store: enabled (uploads go to the configured bucket)");
      objectStore.applyBucketCorsOnce();
    }
    startPhotoBackfill(db);
  });
}

boot().catch((err) => {
  console.error("Failed to start Kandi:", err);
  process.exit(1);
});
