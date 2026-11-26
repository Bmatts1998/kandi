"use strict";

const INTENTS = ["friends", "dating", "both"];
const MODES = ["friends", "dating"];

function normalizeMeetIntent(val, fallback) {
  const v = String(val == null ? "" : val).trim().toLowerCase();
  if (v === "friends" || v === "friend") return "friends";
  if (v === "dating" || v === "date" || v === "dates") return "dating";
  if (v === "both") return "both";
  return fallback === undefined ? "both" : fallback;
}

function intentOf(user) {
  if (!user) return "both";
  return normalizeMeetIntent(user.meet_intent != null ? user.meet_intent : user.meetIntent);
}

function parseList(val) {
  if (Array.isArray(val)) return val;
  try {
    const v = JSON.parse(val || "[]");
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

function genderKey(user) {
  const g = String((user && (user.gender || "")) || "").trim().toLowerCase();
  if (g === "man" || g === "m") return "male";
  if (g === "woman" || g === "w") return "female";
  return g;
}

function interestedAllows(viewer, subject) {
  const raw = viewer && (viewer.interested_in != null ? viewer.interested_in : viewer.interestedIn);
  const wants = parseList(raw).map((w) => String(w || "").trim().toLowerCase()).filter(Boolean);
  if (!wants.length || wants.includes("everyone")) return true;
  const g = genderKey(subject);
  if (!g) return true;
  const aliases = {
    women: ["female", "woman", "w"],
    men: ["male", "man", "m"],
    woman: ["female", "woman", "w"],
    man: ["male", "man", "m"],
    female: ["female", "woman", "w"],
    male: ["male", "man", "m"],
    nonbinary: ["nonbinary", "trans", "agender", "intersex", "other"],
  };
  return wants.some((w) => (aliases[w] || [w]).includes(g));
}

function genderPrefsOk(a, b) {
  return interestedAllows(a, b) && interestedAllows(b, a);
}

function allowedModes(user) {
  const i = intentOf(user);
  if (i === "friends") return ["friends"];
  if (i === "dating") return ["dating"];
  return ["friends", "dating"];
}

function resolveMode(user, requested) {
  const allowed = allowedModes(user);
  const want = String(requested || "").trim().toLowerCase();
  if (allowed.includes(want)) return want;
  return allowed[0];
}

function visibleInMode(viewer, other, mode) {
  if (!viewer || !other) return false;
  const m = resolveMode(viewer, mode);
  const otherIntent = intentOf(other);
  if (m === "friends") return otherIntent === "friends" || otherIntent === "both";
  if (otherIntent !== "dating" && otherIntent !== "both") return false;
  return genderPrefsOk(viewer, other);
}

function canConnect(a, b) {
  return allowedModes(a).some((mode) => visibleInMode(a, b, mode));
}

function matchKindFromMode(mode) {
  return String(mode) === "dating" ? "date" : "friend";
}

function inferMatchKind(a, b) {
  const A = intentOf(a);
  const B = intentOf(b);
  if (A === "friends" || B === "friends") return "friend";
  if ((A === "dating" || A === "both") && (B === "dating" || B === "both")) return "date";
  return "friend";
}

function matchesMeetFilter(intent, filter) {
  const f = String(filter || "all").trim().toLowerCase();
  if (!f || f === "all") return true;
  const v = normalizeMeetIntent(intent);
  if (f === "friends") return v === "friends" || v === "both";
  if (f === "dating") return v === "dating" || v === "both";
  if (f === "both") return v === "both";
  return true;
}

async function migrateMeetIntent(db) {
  if (db.driver === "postgres") {
    await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS meet_intent TEXT DEFAULT 'both'");
    await db.exec("ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_kind TEXT DEFAULT ''");
  } else {
    try { await db.exec("ALTER TABLE users ADD COLUMN meet_intent TEXT DEFAULT 'both'"); } catch (_) { /* exists */ }
    try { await db.exec("ALTER TABLE matches ADD COLUMN match_kind TEXT DEFAULT ''"); } catch (_) { /* exists */ }
  }
  try {
    const r = await db.prepare(`UPDATE users SET meet_intent='both' WHERE meet_intent IS NULL OR meet_intent=''`).run();
    if (r && r.changes) console.log("Meet intent: defaulted " + r.changes + " account(s) to both.");
  } catch (err) {
    console.error("meet_intent backfill:", err.message || err);
  }
}

async function backfillMatchKinds(db) {
  const rows = await db.prepare(
    `SELECT m.id, a.meet_intent AS a_intent, b.meet_intent AS b_intent
     FROM matches m JOIN users a ON a.id=m.a_id JOIN users b ON b.id=m.b_id
     WHERE m.match_kind IS NULL OR m.match_kind=''`
  ).all();
  let n = 0;
  for (const r of rows || []) {
    const kind = inferMatchKind({ meet_intent: r.a_intent }, { meet_intent: r.b_intent });
    await db.prepare(`UPDATE matches SET match_kind=? WHERE id=?`).run(kind, r.id);
    n += 1;
  }
  return n;
}

module.exports = {
  INTENTS,
  MODES,
  normalizeMeetIntent,
  intentOf,
  allowedModes,
  resolveMode,
  visibleInMode,
  canConnect,
  genderPrefsOk,
  matchKindFromMode,
  inferMatchKind,
  matchesMeetFilter,
  migrateMeetIntent,
  backfillMatchKinds,
};
