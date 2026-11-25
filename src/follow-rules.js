"use strict";

// Who may follow whom (Boston's rule): only after a mutual match, or via a share link
// the person sent themselves. Blocks always win. No people search anywhere.

const crypto = require("crypto");
const mailer = require("./email");

function newShareToken() {
  return crypto.randomBytes(12).toString("base64url"); // 16 chars, 96 bits
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function ensureShareToken(db, user) {
  if (user.share_token) return user.share_token;
  const token = newShareToken();
  await db.prepare(`UPDATE users SET share_token=? WHERE id=? AND (share_token IS NULL OR share_token='')`).run(token, user.id);
  const row = await db.prepare(`SELECT share_token FROM users WHERE id=?`).get(user.id);
  return row.share_token;
}

async function resetShareToken(db, userId) {
  const token = newShareToken();
  await db.prepare(`UPDATE users SET share_token=? WHERE id=?`).run(token, userId);
  return token;
}

function shareFollowEnabled(user) {
  return user.share_follow == null || Number(user.share_follow) !== 0;
}

function shareUrl(user, token, req) {
  return mailer.publicBase(req) + "/u/" + encodeURIComponent(user.username) + "?k=" + encodeURIComponent(token);
}

// Valid only if the token matches and the owner still allows link follows.
function linkTokenValid(target, token) {
  return Boolean(target && token && target.share_token && shareFollowEnabled(target) && safeEqual(target.share_token, token));
}

async function isBlockedEitherWay(db, a, b) {
  return Boolean(await db.prepare(`SELECT 1 AS x FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)`).get(a, b, b, a));
}

async function isMutualMatch(db, a, b) {
  const [x, y] = Number(a) < Number(b) ? [a, b] : [b, a];
  return Boolean(await db.prepare(`SELECT id FROM matches WHERE a_id=? AND b_id=?`).get(x, y));
}

// Returns { ok, via } or { ok:false, status, error }.
async function checkFollow(db, me, target, token) {
  if (!target) return { ok: false, status: 404, error: "User not found." };
  if (Number(target.id) === Number(me.id)) return { ok: false, status: 400, error: "You can't follow yourself." };
  if (await isBlockedEitherWay(db, me.id, target.id)) return { ok: false, status: 403, error: "You can't follow this person." };
  if (await isMutualMatch(db, me.id, target.id)) return { ok: true, via: "match" };
  if (linkTokenValid(target, token)) return { ok: true, via: "link" };
  return { ok: false, status: 403, code: "follow_not_allowed", error: "You can follow someone after you match, or from a profile link they share with you." };
}

async function canFollowSimple(db, meId, targetId) {
  if (Number(meId) === Number(targetId)) return false;
  if (await isBlockedEitherWay(db, meId, targetId)) return false;
  return isMutualMatch(db, meId, targetId);
}

async function removeFollowsBetween(db, a, b) {
  await db.prepare(`DELETE FROM follows WHERE (follower_id=? AND following_id=?) OR (follower_id=? AND following_id=?)`).run(a, b, b, a);
}

async function migrateFollowRules(db) {
  const userCols = [["share_token", "TEXT"], ["share_follow", "INTEGER DEFAULT 1"]];
  if (db.driver === "postgres") {
    for (const [c, t] of userCols) await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c} ${t}`);
    await db.exec("ALTER TABLE follows ADD COLUMN IF NOT EXISTS via TEXT DEFAULT ''");
  } else {
    for (const [c, t] of userCols) { try { await db.exec(`ALTER TABLE users ADD COLUMN ${c} ${t}`); } catch (_) {} }
    try { await db.exec("ALTER TABLE follows ADD COLUMN via TEXT DEFAULT ''"); } catch (_) {}
  }
  // Follows made before the rule existed are kept and labeled "legacy" (grandfathered).
  try {
    const r = await db.prepare(`UPDATE follows SET via='legacy' WHERE via IS NULL OR via=''`).run();
    if (r && r.changes) console.log("Follow rules: kept " + r.changes + " earlier follows as legacy.");
  } catch (err) { console.error("follow via backfill:", err.message || err); }
  // Blocks win: clean up any follow that crosses an existing block.
  try {
    await db.exec(`DELETE FROM follows WHERE EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=follows.follower_id AND b.blocked_id=follows.following_id) OR (b.user_id=follows.following_id AND b.blocked_id=follows.follower_id))`);
  } catch (err) { console.error("follow/block cleanup:", err.message || err); }
}

module.exports = {
  ensureShareToken, resetShareToken, shareFollowEnabled, shareUrl, linkTokenValid,
  isMutualMatch, isBlockedEitherWay, checkFollow, canFollowSimple, removeFollowsBetween, migrateFollowRules, newShareToken,
};
