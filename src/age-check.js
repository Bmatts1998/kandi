"use strict";

// Apple Declared Age Range (iOS 26+) results, stored on the user.
//
// Status values:
//   over18      Apple shared a range whose lower bound is 18 or higher
//   under18     Apple shared a range that does not confirm 18+
//   declined    The person (or their guardian) declined to share
//   unavailable The API is missing: older iOS, no Apple ID, no native plugin, or a system error
//
// Handling:
//   under18     — the account is blocked (Kandi is 18+). They can still
//                 load /api/me, log out, delete the account, or submit a
//                 new age check (for example after turning 18).
//   declined    — allowed to use the app, marked unverified. We do not
//                 re-prompt automatically; they already said no.
//   unavailable — allowed to use the app, marked unverified. We retry on
//                 the next iOS launch (no system dialog on older iOS).
//   Web and non-iOS clients never send a result and are unchanged: they
//   still type their age at sign-up. Apple's result is a declared range,
//   not an ID check, and is only available inside the official iOS app.

const STATUSES = new Set(["over18", "under18", "declined", "unavailable"]);

function normalizeStatus(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/[\s-]/g, "_");
  if (s === "declined_sharing" || s === "declinedsharing") return "declined";
  if (s === "not_available" || s === "error") return "unavailable";
  return STATUSES.has(s) ? s : null;
}

function parseBound(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 130) return null;
  return n;
}

function clipReason(raw) {
  return String(raw || "").trim().slice(0, 80);
}

function clipDeclaration(raw) {
  return String(raw || "").trim().slice(0, 80);
}

function publicAgeCheck(user) {
  const status = normalizeStatus(user && user.age_check_status);
  return {
    status,
    at: (user && user.age_check_at) || null,
    declaration: (user && user.age_check_declaration) || "",
    // Prompt again when never checked, or when the last result was
    // "unavailable" (older iOS, signed out of iCloud, or a build without
    // the native plugin). Do not auto-reprompt after a decline.
    needsCheck: !status || status === "unavailable",
  };
}

function isUnder18(user) {
  return normalizeStatus(user && user.age_check_status) === "under18";
}

function resolveSubmission(body) {
  const raw = String((body && body.status) || "").trim().toLowerCase().replace(/[\s-]/g, "_");
  const declaration = clipDeclaration(body && (body.declaration || body.declarationSource || body.ageRangeDeclaration));
  const reason = clipReason(body && body.reason);
  const lower = parseBound(body && (body.lowerBound != null ? body.lowerBound : (body.ageLower != null ? body.ageLower : body.lower)));
  const upper = parseBound(body && (body.upperBound != null ? body.upperBound : (body.ageUpper != null ? body.ageUpper : body.upper)));

  if (raw === "declined" || raw === "declined_sharing" || raw === "declinedsharing") {
    return { status: "declined", lower: null, upper: null, declaration: "", reason: reason || "" };
  }
  if (raw === "unavailable" || raw === "not_available" || raw === "error") {
    return { status: "unavailable", lower: null, upper: null, declaration: "", reason: reason || "unavailable" };
  }
  if (raw === "sharing" || raw === "over18" || raw === "under18") {
    if (lower != null && lower >= 18) {
      return { status: "over18", lower, upper, declaration, reason: "" };
    }
    if (raw === "over18") {
      return { error: "An 18+ result must include the age range Apple returned." };
    }
    return { status: "under18", lower, upper, declaration, reason: "" };
  }
  return { error: "Send a valid age check status." };
}

async function saveAgeCheck(db, userId, result) {
  const at = new Date().toISOString();
  await db.prepare(
    `UPDATE users SET age_check_status=?, age_check_at=?, age_check_lower=?, age_check_upper=?, age_check_declaration=?, age_check_reason=? WHERE id=?`
  ).run(result.status, at, result.lower, result.upper, result.declaration || "", result.reason || "", userId);
  return db.prepare(`SELECT * FROM users WHERE id=?`).get(userId);
}

async function migrateAgeCheck(db) {
  const cols = [
    ["age_check_status", "TEXT"],
    ["age_check_at", "TEXT"],
    ["age_check_lower", "INTEGER"],
    ["age_check_upper", "INTEGER"],
    ["age_check_declaration", "TEXT"],
    ["age_check_reason", "TEXT"],
  ];
  if (db.driver === "postgres") {
    for (const [col, typ] of cols) {
      await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} ${typ}`);
    }
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_users_age_check_status ON users(age_check_status)"); } catch (err) { console.error("idx_users_age_check_status:", err.message || err); }
  } else {
    for (const [col, typ] of cols) {
      try { await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${typ}`); } catch (_) { /* already exists */ }
    }
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_users_age_check_status ON users(age_check_status)"); } catch (_) {}
  }
}

module.exports = {
  STATUSES,
  normalizeStatus,
  publicAgeCheck,
  isUnder18,
  resolveSubmission,
  saveAgeCheck,
  migrateAgeCheck,
};
