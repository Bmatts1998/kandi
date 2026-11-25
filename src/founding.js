"use strict";

const { foundingCap, FOUNDING_FREE_MONTHS } = require("./plus-plans");

// Salt Lake County + Utah County metro (cities, counties, and ZIP prefixes/codes).
const SLC_CITIES = [
  "salt lake city", "salt lake", "slc", "s.l.c", "s.l.c.",
  "west valley", "west valley city", "wvc",
  "west jordan", "south jordan", "south salt lake", "ssl",
  "sandy", "taylorsville", "murray", "millcreek",
  "cottonwood heights", "cottonwood", "holladay", "midvale",
  "draper", "riverton", "herriman", "kearns", "magna",
  "copperton", "bluffdale", "white city", "emigration canyon",
  "canyon rim", "east millcreek", "millcreek canyon",
  "provo", "orem", "lehi", "american fork", "pleasant grove",
  "spanish fork", "springville", "payson", "saratoga springs",
  "eagle mountain", "highland", "alpine", "lindon", "mapleton",
  "salem", "santaquin", "vineyard", "cedar hills", "elk ridge",
  "genola", "goshen", "woodland hills", "fairfield", "cedar fort",
  "benjamin", "lake shore", "palmyra", "west mountain",
  "sundance", "utah valley",
];
const SLC_REGIONS = [
  "salt lake county", "salt lake co", "sl county", "sl co",
  "utah county", "utah co", "utah co.",
  "salt lake valley", "silicon slopes",
];
const SLC_ZIPS = new Set([
  // Salt Lake County
  "84006", "84009", "84020", "84044", "84047", "84065", "84070", "84081", "84084",
  "84088", "84092", "84093", "84094", "84095", "84096",
  // Utah County
  "84003", "84004", "84005", "84042", "84043", "84045", "84057", "84058", "84062",
  "84097", "84601", "84602", "84603", "84604", "84605", "84606", "84626", "84633",
  "84651", "84653", "84655", "84660", "84663", "84664",
]);

function normalizeLocation(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[#.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractZips(text) {
  return String(text || "").match(/\b(84\d{3})\b/g) || [];
}

function isSlcMetro(location) {
  const text = normalizeLocation(location);
  if (!text) return false;
  for (const zip of extractZips(text)) {
    if (SLC_ZIPS.has(zip) || /^841\d{2}$/.test(zip)) return true;
  }
  for (const region of SLC_REGIONS) {
    if (text.includes(region)) return true;
  }
  // "Utah" alone is too broad (the whole state). Require county/city/metro cues.
  for (const city of SLC_CITIES) {
    const re = new RegExp(`(?:^|\\s)${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|,|$)`);
    if (re.test(text)) return true;
  }
  return false;
}

function parseDob(raw) {
  const text = String(raw || "").trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  if (year < 1900 || year > new Date().getUTCFullYear()) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function ageFromDob(dob, now = new Date()) {
  const parsed = parseDob(dob);
  if (!parsed) return null;
  const [y, mo, da] = parsed.split("-").map(Number);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  let age = year - y;
  if (month < mo || (month === mo && day < da)) age -= 1;
  return age;
}

function isAdultDob(dob, now = new Date()) {
  const age = ageFromDob(dob, now);
  return age != null && age >= 18 && age <= 120;
}

function plusUntilFrom(now = new Date(), months = FOUNDING_FREE_MONTHS) {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

function hasActiveComp(user, now = new Date()) {
  if (!user || !user.plus_until) return false;
  const t = Date.parse(user.plus_until);
  return Number.isFinite(t) && t > now.getTime();
}

function isEligible(user, now = new Date()) {
  if (!user) return false;
  if (Number(user.is_demo)) return false;
  if (Number(user.is_founder) && user.founding_number) return false;
  if (!isAdultDob(user.date_of_birth || user.dateOfBirth, now)) return false;
  if (!isSlcMetro(user.home_location || user.homeLocation)) return false;
  return true;
}

async function spots(db, env = process.env) {
  const cap = foundingCap(env);
  await ensureMeta(db, cap);
  const row = await db.prepare(`SELECT claimed, cap FROM founding_meta WHERE id=1`).get();
  const claimed = row ? Number(row.claimed) || 0 : 0;
  const limit = row && row.cap != null ? Number(row.cap) : cap;
  const left = Math.max(0, limit - claimed);
  return { cap: limit, claimed, left, open: left > 0 };
}

async function ensureMeta(db, cap) {
  const row = await db.prepare(`SELECT id, cap FROM founding_meta WHERE id=1`).get();
  if (!row) {
    await db.prepare(`INSERT INTO founding_meta (id, claimed, cap) VALUES (1, 0, ?)`).run(cap);
    return;
  }
  if (cap && Number(row.cap) !== Number(cap)) {
    await db.prepare(`UPDATE founding_meta SET cap=? WHERE id=1`).run(cap);
  }
}

async function claimFounding(db, user, opts = {}) {
  const now = opts.now || new Date();
  const env = opts.env || process.env;
  if (!user || !user.id) return { ok: false, reason: "no_user" };
  if (Number(user.is_founder) && user.founding_number) {
    return { ok: true, already: true, foundingNumber: Number(user.founding_number), plusUntil: user.plus_until };
  }
  if (Number(user.is_demo)) return { ok: false, reason: "demo" };
  if (!isAdultDob(user.date_of_birth || user.dateOfBirth, now)) return { ok: false, reason: "dob" };
  if (!isSlcMetro(user.home_location || user.homeLocation)) return { ok: false, reason: "location" };

  const cap = foundingCap(env);
  const run = async (tx) => {
    await ensureMeta(tx, cap);
    const slot = await tx.prepare(
      `UPDATE founding_meta SET claimed = claimed + 1 WHERE id=1 AND claimed < cap RETURNING claimed`
    ).get();
    if (!slot || slot.claimed == null) return { ok: false, reason: "full" };
    const foundingNumber = Number(slot.claimed);
    const plusUntil = plusUntilFrom(now);
    const existing = await tx.prepare(`SELECT is_founder, founding_number, subscription FROM users WHERE id=?`).get(user.id);
    if (existing && Number(existing.is_founder) && existing.founding_number) {
      // Lost a slot to a race with ourselves; put it back.
      await tx.prepare(`UPDATE founding_meta SET claimed = claimed - 1 WHERE id=1 AND claimed > 0`).run();
      return { ok: true, already: true, foundingNumber: Number(existing.founding_number), plusUntil: user.plus_until };
    }
    await tx.prepare(
      `UPDATE users SET is_founder=1, founding_number=?, plus_until=?, subscription=CASE WHEN subscription='vip' THEN subscription ELSE 'plus' END WHERE id=?`
    ).run(foundingNumber, plusUntil, user.id);
    return { ok: true, foundingNumber, plusUntil, granted: true };
  };

  if (typeof db.transaction === "function") {
    return db.transaction(run);
  }
  return run(db);
}

async function backfillFounders(db, opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now || new Date();
  const cap = foundingCap(env);
  await ensureMeta(db, cap);
  const status = await spots(db, env);
  if (!status.open) return { granted: 0, left: 0, cap: status.cap };
  const rows = await db.prepare(
    `SELECT * FROM users WHERE (is_demo IS NULL OR is_demo=0) AND (is_founder IS NULL OR is_founder=0) AND date_of_birth IS NOT NULL AND date_of_birth != '' AND home_location IS NOT NULL AND home_location != '' ORDER BY created_at ASC, id ASC`
  ).all();
  let granted = 0;
  for (const user of rows) {
    if (!isEligible({ ...user, is_founder: 0 }, now)) continue;
    const result = await claimFounding(db, user, { now, env });
    if (result && result.granted) granted += 1;
    else if (result && result.reason === "full") break;
  }
  const after = await spots(db, env);
  return { granted, left: after.left, cap: after.cap, claimed: after.claimed };
}

function publicFounding(user) {
  if (!user) return null;
  const founder = Boolean(Number(user.is_founder));
  return {
    isFounder: founder,
    foundingNumber: founder && user.founding_number ? Number(user.founding_number) : null,
    plusUntil: user.plus_until || null,
    complimentaryActive: hasActiveComp(user),
  };
}

module.exports = {
  SLC_CITIES,
  SLC_ZIPS,
  isSlcMetro,
  parseDob,
  ageFromDob,
  isAdultDob,
  plusUntilFrom,
  hasActiveComp,
  isEligible,
  spots,
  ensureMeta,
  claimFounding,
  backfillFounders,
  publicFounding,
};
