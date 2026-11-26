"use strict";

const crypto = require("crypto");
const founding = require("./founding");
const { isAdminUser } = require("./verification");

const QUALIFY_GOAL = 10;
const REWARD_MONTHS = 12;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const BLOCKED_CODES = new Set([
  "ADMIN", "VERIFY", "INVITE", "JOIN", "KANDI", "PLUS", "AMBASS", "SIGNUP",
  "LOGIN", "SUPPORT", "PRIVACY", "TERMS", "CLAIM", "DELETE", "BANNED",
]);
const DEVICE_COOKIE = "kandi_did";
const REF_COOKIE = "kandi_ref";
const IP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function parseList(raw, fallback) {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

function hasFilePhoto(user) {
  return parseList(user && user.photos, []).some((ph) => ph && ph.type === "file" && ph.url);
}

function isAdult(user) {
  return Number(user && user.age) >= 18;
}

function profileComplete(user) {
  if (!user) return false;
  if (!isAdult(user)) return false;
  if (Number(user.needs_profile)) return false;
  if (!hasFilePhoto(user)) return false;
  if (!String(user.name || "").trim()) return false;
  if (!parseList(user.vibes, []).length) return false;
  if (!parseList(user.looking, []).length) return false;
  return true;
}

function clientIp(req) {
  const xf = String((req && req.headers && req.headers["x-forwarded-for"]) || "").split(",")[0].trim();
  const raw = xf || String((req && req.ip) || (req && req.socket && req.socket.remoteAddress) || "");
  return raw.replace(/^::ffff:/, "").slice(0, 80);
}

function isHttps(req) {
  const proto = String((req && req.headers && req.headers["x-forwarded-proto"]) || "").split(",")[0].trim();
  return process.env.KANDI_SECURE_COOKIE === "1" || proto === "https";
}

function appendSetCookie(res, cookie) {
  const prev = res.getHeader("Set-Cookie");
  if (!prev) res.setHeader("Set-Cookie", cookie);
  else if (Array.isArray(prev)) res.setHeader("Set-Cookie", prev.concat(cookie));
  else res.setHeader("Set-Cookie", [prev, cookie]);
}

function cookieHeader(name, value, req, maxAge) {
  const secure = isHttps(req) ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function parseCookies(req) {
  const out = {};
  const raw = (req && req.headers && req.headers.cookie) || "";
  raw.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

async function ensureTables(db) {
  if (!db || db.__referralsReady) return;
  const isPg = db.driver === "postgres";
  const add = async (sql, sqliteSql) => {
    try { await db.exec(isPg ? sql : (sqliteSql || sql)); } catch (_) { /* already exists */ }
  };
  if (isPg) {
    await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`);
    await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ambassador_at TEXT`);
    await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ambassador_notice_at TEXT`);
    await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ambassador_notice_seen_at TEXT`);
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_uk ON users (referral_code) WHERE referral_code IS NOT NULL AND referral_code <> ''`);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        inviter_id INTEGER NOT NULL,
        invitee_id INTEGER NOT NULL UNIQUE,
        code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        created_at TEXT NOT NULL,
        qualified_at TEXT,
        signup_ip TEXT,
        device_id TEXT
      )
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS referrals_inviter_status ON referrals (inviter_id, status)`);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_devices (
        user_id INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        ip TEXT,
        last_seen TEXT NOT NULL,
        PRIMARY KEY (user_id, device_id)
      )
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS user_devices_device ON user_devices (device_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS user_devices_ip ON user_devices (ip)`);
  } else {
    await add(`ALTER TABLE users ADD COLUMN referral_code TEXT`);
    await add(`ALTER TABLE users ADD COLUMN ambassador_at TEXT`);
    await add(`ALTER TABLE users ADD COLUMN ambassador_notice_at TEXT`);
    await add(`ALTER TABLE users ADD COLUMN ambassador_notice_seen_at TEXT`);
    try { await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_uk ON users (referral_code) WHERE referral_code IS NOT NULL AND referral_code <> ''`); } catch (_) {}
    await db.exec(`
      CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inviter_id INTEGER NOT NULL,
        invitee_id INTEGER NOT NULL UNIQUE,
        code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        created_at TEXT NOT NULL,
        qualified_at TEXT,
        signup_ip TEXT,
        device_id TEXT
      )
    `);
    try { await db.exec(`CREATE INDEX IF NOT EXISTS referrals_inviter_status ON referrals (inviter_id, status)`); } catch (_) {}
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_devices (
        user_id INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        ip TEXT,
        last_seen TEXT NOT NULL,
        PRIMARY KEY (user_id, device_id)
      )
    `);
    try { await db.exec(`CREATE INDEX IF NOT EXISTS user_devices_device ON user_devices (device_id)`); } catch (_) {}
    try { await db.exec(`CREATE INDEX IF NOT EXISTS user_devices_ip ON user_devices (ip)`); } catch (_) {}
  }
  db.__referralsReady = true;
}

async function migrateReferrals(db) {
  await ensureTables(db);
}

function deviceIdFrom(req, res) {
  const existing = normalizeCode(parseCookies(req)[DEVICE_COOKIE]) || String(parseCookies(req)[DEVICE_COOKIE] || "").replace(/[^a-zA-Z0-9]/g, "");
  if (existing && existing.length >= 16) return existing.slice(0, 64);
  const id = crypto.randomBytes(16).toString("hex");
  if (res) appendSetCookie(res, cookieHeader(DEVICE_COOKIE, id, req, 60 * 60 * 24 * 400));
  return id;
}

function stamp(req, res) {
  deviceIdFrom(req, res);
  const path = String((req && req.path) || (req && req.url) || "").split("?")[0];
  const m = path.match(/^\/join\/([^/]+)\/?$/i);
  if (m && req && String(req.method || "GET").toUpperCase() === "GET") {
    const code = normalizeCode(m[1]);
    if (code) appendSetCookie(res, cookieHeader(REF_COOKIE, code, req, 60 * 60 * 24 * 30));
  }
}

async function touchUser(db, req, res, user) {
  if (!db || !user) return;
  await ensureTables(db);
  const deviceId = deviceIdFrom(req, res);
  const ip = clientIp(req);
  const now = new Date().toISOString();
  try {
    await db.prepare(`
      INSERT INTO user_devices (user_id, device_id, ip, last_seen) VALUES (?,?,?,?)
      ON CONFLICT (user_id, device_id) DO UPDATE SET ip=excluded.ip, last_seen=excluded.last_seen
    `).run(user.id, deviceId, ip || null, now);
  } catch (err) {
    // SQLite older: try update-then-insert
    try {
      const row = await db.prepare(`SELECT user_id FROM user_devices WHERE user_id=? AND device_id=?`).get(user.id, deviceId);
      if (row) await db.prepare(`UPDATE user_devices SET ip=?, last_seen=? WHERE user_id=? AND device_id=?`).run(ip || null, now, user.id, deviceId);
      else await db.prepare(`INSERT INTO user_devices (user_id, device_id, ip, last_seen) VALUES (?,?,?,?)`).run(user.id, deviceId, ip || null, now);
    } catch (_) { /* non-fatal */ }
  }
}

async function ensureReferralCode(db, user) {
  await ensureTables(db);
  if (user && user.referral_code) return String(user.referral_code);
  if (!user) return "";
  for (let len = 7; len <= 10; len++) {
    for (let i = 0; i < 8; i++) {
      const code = randomCode(len);
      if (BLOCKED_CODES.has(code)) continue;
      try {
        const r = await db.prepare(`UPDATE users SET referral_code=? WHERE id=? AND (referral_code IS NULL OR referral_code='')`).run(code, user.id);
        if (r && r.changes === 0) {
          const fresh = await db.prepare(`SELECT referral_code FROM users WHERE id=?`).get(user.id);
          if (fresh && fresh.referral_code) return String(fresh.referral_code);
        } else {
          user.referral_code = code;
          return code;
        }
      } catch (err) {
        if (!/unique|duplicate/i.test(String(err && err.message))) throw err;
      }
    }
  }
  throw new Error("Could not assign an invite code.");
}

async function findInviterByCode(db, code) {
  const normalized = normalizeCode(code);
  if (!normalized || normalized.length < 4) return null;
  return db.prepare(`SELECT * FROM users WHERE referral_code=?`).get(normalized);
}

async function isSelfReferral(db, inviter, { deviceId, ip, inviteeId }) {
  if (!inviter) return "invalid";
  if (inviteeId && Number(inviteeId) === Number(inviter.id)) return "self";
  if (deviceId) {
    const row = await db.prepare(`SELECT user_id FROM user_devices WHERE device_id=? AND user_id=?`).get(deviceId, inviter.id);
    if (row) return "same_device";
  }
  if (ip) {
    const since = new Date(Date.now() - IP_WINDOW_MS).toISOString();
    const hit = await db.prepare(`SELECT user_id FROM user_devices WHERE ip=? AND user_id=? AND last_seen>=? LIMIT 1`).get(ip, inviter.id, since);
    if (hit) return "same_ip";
  }
  return null;
}

async function attributeSignup(db, { user, code, req, res }) {
  await ensureTables(db);
  const fromBody = normalizeCode(code);
  const fromCookie = normalizeCode(parseCookies(req)[REF_COOKIE]);
  const used = fromBody || fromCookie;
  if (!used || !user) return { attributed: false };
  const inviter = await findInviterByCode(db, used);
  if (!inviter) return { attributed: false, error: "We couldn't apply that invite code." };
  const deviceId = deviceIdFrom(req, res);
  const ip = clientIp(req);
  const reason = await isSelfReferral(db, inviter, { deviceId, ip, inviteeId: user.id });
  const now = new Date().toISOString();
  const status = reason ? "rejected" : "pending";
  try {
    await db.prepare(`
      INSERT INTO referrals (inviter_id, invitee_id, code, status, reason, created_at, signup_ip, device_id)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(inviter.id, user.id, used, status, reason || null, now, ip || null, deviceId || null);
  } catch (err) {
    if (/unique|duplicate/i.test(String(err && err.message))) return { attributed: false };
    throw err;
  }
  return { attributed: status === "pending", rejected: Boolean(reason) };
}

async function qualifiedCount(db, inviterId) {
  const row = await db.prepare(`SELECT COUNT(*) AS c FROM referrals WHERE inviter_id=? AND status='qualified'`).get(inviterId);
  return row ? Number(row.c) || 0 : 0;
}

async function grantAmbassador(db, inviter) {
  if (!inviter || inviter.ambassador_at) return false;
  if (Number(inviter.is_demo)) return false;
  const now = new Date();
  const current = Date.parse(inviter.plus_until);
  const startMs = Number.isFinite(current) && current > now.getTime() ? current : now.getTime();
  const until = founding.plusUntilFrom(new Date(startMs), REWARD_MONTHS);
  const at = now.toISOString();
  const r = await db.prepare(`
    UPDATE users
    SET plus_until=?,
        subscription=CASE WHEN subscription='vip' THEN subscription ELSE 'plus' END,
        ambassador_at=?,
        ambassador_notice_at=?
    WHERE id=? AND ambassador_at IS NULL
  `).run(until, at, at, inviter.id);
  return Boolean(r && r.changes);
}

async function maybeQualifyReferral(db, invitee) {
  try {
    if (!db || !invitee) return;
    await ensureTables(db);
    const row = await db.prepare(`SELECT * FROM referrals WHERE invitee_id=?`).get(invitee.id);
    if (!row || row.status !== "pending") {
      if (row && row.status === "qualified") {
        // If they later fail the rules (deleted is handled separately), leave as-is.
      }
      return;
    }
    const fresh = await db.prepare(`SELECT * FROM users WHERE id=?`).get(invitee.id);
    if (!fresh) return;
    if (!profileComplete(fresh)) return;
    const now = new Date().toISOString();
    const upd = await db.prepare(`
      UPDATE referrals SET status='qualified', qualified_at=?, reason=NULL
      WHERE id=? AND status='pending'
    `).run(now, row.id);
    if (!upd || !upd.changes) return;
    const inviter = await db.prepare(`SELECT * FROM users WHERE id=?`).get(row.inviter_id);
    if (!inviter) return;
    const count = await qualifiedCount(db, inviter.id);
    if (count >= QUALIFY_GOAL && !inviter.ambassador_at) {
      await grantAmbassador(db, inviter);
    }
  } catch (err) {
    console.error("Referral qualify failed:", err && err.message);
  }
}

async function voidInvitee(db, userId) {
  try {
    await ensureTables(db);
    const row = await db.prepare(`SELECT * FROM referrals WHERE invitee_id=?`).get(userId);
    if (!row) {
      try { await db.prepare(`DELETE FROM user_devices WHERE user_id=?`).run(userId); } catch (_) {}
      return;
    }
    if (row.status === "pending" || row.status === "qualified") {
      const inviter = await db.prepare(`SELECT * FROM users WHERE id=?`).get(row.inviter_id);
      // If the inviter has not been granted yet, dropping this signup should un-count it.
      // If they already received the one-time reward, keep the grant and just mark voided.
      await db.prepare(`UPDATE referrals SET status='voided', reason='deleted' WHERE id=?`).run(row.id);
    }
    try { await db.prepare(`DELETE FROM user_devices WHERE user_id=?`).run(userId); } catch (_) {}
  } catch (err) {
    console.error("Referral void on delete failed:", err && err.message);
  }
}

function publicSelf(user) {
  return {
    ambassador: Boolean(user && user.ambassador_at),
    ambassadorNotice: Boolean(user && user.ambassador_at && user.ambassador_notice_at && !user.ambassador_notice_seen_at),
  };
}

async function statsFor(db, user) {
  const code = await ensureReferralCode(db, user);
  const fresh = await db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id);
  const qualified = await qualifiedCount(db, user.id);
  const pendingRow = await db.prepare(`SELECT COUNT(*) AS c FROM referrals WHERE inviter_id=? AND status='pending'`).get(user.id);
  return {
    code,
    path: "/join/" + code,
    qualified,
    pending: pendingRow ? Number(pendingRow.c) || 0 : 0,
    goal: QUALIFY_GOAL,
    rewardMonths: REWARD_MONTHS,
    ambassador: Boolean(fresh && fresh.ambassador_at),
    ambassadorAt: (fresh && fresh.ambassador_at) || null,
    plusUntil: (fresh && fresh.plus_until) || null,
    ambassadorNotice: Boolean(fresh && fresh.ambassador_at && fresh.ambassador_notice_at && !fresh.ambassador_notice_seen_at),
  };
}

function installReferrals({ app, getDb, auth }) {
  app.get("/api/referral/preview/:code", async (req, res) => {
    const db = getDb();
    await ensureTables(db);
    const code = normalizeCode(req.params.code);
    const inviter = await findInviterByCode(db, code);
    if (!inviter) return res.status(404).json({ error: "That invite code isn't valid." });
    const first = String(inviter.name || inviter.username || "A friend").trim().split(/\s+/)[0];
    res.json({ code: inviter.referral_code, name: first });
  });

  app.get("/api/referral", auth, async (req, res) => {
    const db = getDb();
    await ensureTables(db);
    await touchUser(db, req, res, req.user);
    const stats = await statsFor(db, req.user);
    res.json(stats);
  });

  app.post("/api/referral/notice-seen", auth, async (req, res) => {
    const db = getDb();
    await ensureTables(db);
    const now = new Date().toISOString();
    await db.prepare(`UPDATE users SET ambassador_notice_seen_at=? WHERE id=? AND ambassador_at IS NOT NULL`).run(now, req.user.id);
    const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
    res.json({ ok: true, ...publicSelf(user) });
  });

  app.get("/api/admin/referrals", auth, async (req, res) => {
    if (!isAdminUser(req.user)) return res.status(404).json({ error: "Not found." });
    const db = getDb();
    await ensureTables(db);
    const rows = await db.prepare(`
      SELECT u.id, u.name, u.username, u.referral_code, u.ambassador_at, u.plus_until,
        (SELECT COUNT(*) FROM referrals r WHERE r.inviter_id=u.id AND r.status='qualified') AS qualified,
        (SELECT COUNT(*) FROM referrals r WHERE r.inviter_id=u.id AND r.status='pending') AS pending
      FROM users u
      WHERE u.referral_code IS NOT NULL
        AND (
          EXISTS (SELECT 1 FROM referrals r WHERE r.inviter_id=u.id)
          OR u.ambassador_at IS NOT NULL
        )
      ORDER BY qualified DESC, pending DESC, u.username ASC
      LIMIT 200
    `).all();
    res.json({
      goal: QUALIFY_GOAL,
      referrers: (rows || []).map((r) => ({
        id: Number(r.id),
        name: r.name || "",
        username: r.username || "",
        code: r.referral_code || "",
        qualified: Number(r.qualified) || 0,
        pending: Number(r.pending) || 0,
        ambassador: Boolean(r.ambassador_at),
        ambassadorAt: r.ambassador_at || null,
        plusUntil: r.plus_until || null,
      })),
    });
  });
}

module.exports = {
  QUALIFY_GOAL,
  REWARD_MONTHS,
  normalizeCode,
  appendSetCookie,
  stamp,
  touchUser,
  ensureTables,
  migrateReferrals,
  ensureReferralCode,
  attributeSignup,
  maybeQualifyReferral,
  voidInvitee,
  publicSelf,
  installReferrals,
  clientIp,
};
