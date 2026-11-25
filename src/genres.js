"use strict";

const MAX_GENRES = 5;

const GENRES = Object.freeze([
  { id: "dubstep", name: "Dubstep", short: "Dubstep", color: "#b44aff", icon: "diamond" },
  { id: "riddim", name: "Riddim", short: "Riddim", color: "#ff3d9a", icon: "bars" },
  { id: "bass-music", name: "Bass Music", short: "Bass Music", color: "#ff5c00", icon: "bars" },
  { id: "house", name: "House", short: "House", color: "#2ef0ff", icon: "ring" },
  { id: "tech-house", name: "Tech House", short: "Tech Hse", color: "#1ad4c8", icon: "ring" },
  { id: "deep-house", name: "Deep House", short: "Deep", color: "#4d7cff", icon: "ring" },
  { id: "techno", name: "Techno", short: "Techno", color: "#e8e8e8", icon: "ring" },
  { id: "trance", name: "Trance", short: "Trance", color: "#7ad0ff", icon: "spark" },
  { id: "dnb", name: "Drum & Bass", short: "DnB", color: "#b6ff3f", icon: "bars" },
  { id: "hardstyle", name: "Hardstyle", short: "Hardstyle", color: "#ff3b3b", icon: "slash" },
  { id: "trap", name: "Trap", short: "Trap", color: "#ffc14d", icon: "diamond" },
  { id: "future-bass", name: "Future Bass", short: "Future", color: "#ff7ad9", icon: "spark" },
  { id: "melodic-bass", name: "Melodic Bass", short: "Melodic", color: "#ff8aa8", icon: "spark" },
  { id: "big-room", name: "Big Room", short: "Big Room", color: "#ffe14d", icon: "diamond" },
  { id: "progressive-house", name: "Progressive House", short: "Progressive", color: "#3dffd0", icon: "ring" },
  { id: "psytrance", name: "Psytrance", short: "Psytrance", color: "#c8ff3f", icon: "spark" },
  { id: "jungle", name: "Jungle", short: "Jungle", color: "#6dff6a", icon: "bars" },
  { id: "ukg", name: "UKG/Garage", short: "UKG", color: "#ffd56a", icon: "diamond" },
  { id: "hardcore", name: "Hardcore", short: "Hardcore", color: "#ff4d6d", icon: "slash" },
  { id: "lofi", name: "Lo-fi/Downtempo", short: "Lo-fi", color: "#e0b08a", icon: "circle" },
  { id: "disco-funk", name: "Disco/Funk", short: "Disco", color: "#ff7a4a", icon: "circle" },
  { id: "experimental", name: "Experimental", short: "Experimental", color: "#d0b0ff", icon: "slash" },
  { id: "afro-house", name: "Afro House", short: "Afro", color: "#ffb020", icon: "ring" },
  { id: "breaks", name: "Breaks", short: "Breaks", color: "#7affc8", icon: "bars" },
  { id: "midtempo", name: "Midtempo", short: "Midtempo", color: "#6aa8ff", icon: "circle" },
  { id: "color-bass", name: "Color Bass", short: "Color Bass", color: "#ff5cff", icon: "spark" },
  { id: "edm", name: "EDM", short: "EDM", color: "#ff8a1a", icon: "circle" },
  { id: "hip-hop", name: "Hip-Hop", short: "Hip-Hop", color: "#d4924a", icon: "diamond" },
]);

const BY_ID = Object.freeze(Object.fromEntries(GENRES.map((g) => [g.id, g])));

const LEGACY = Object.freeze({
  bass: "bass-music",
  "bass music": "bass-music",
  "drum & bass": "dnb",
  "drum and bass": "dnb",
  "d&b": "dnb",
  dnb: "dnb",
  garage: "ukg",
  "ukg/garage": "ukg",
  "uk garage": "ukg",
  ukg: "ukg",
  disco: "disco-funk",
  funk: "disco-funk",
  "disco/funk": "disco-funk",
  "lo-fi": "lofi",
  "lo-fi/downtempo": "lofi",
  lofi: "lofi",
  downtempo: "lofi",
  edm: "edm",
  "hip hop": "hip-hop",
  "hip-hop": "hip-hop",
  "tech house": "tech-house",
  "deep house": "deep-house",
  "progressive house": "progressive-house",
  "future bass": "future-bass",
  "melodic bass": "melodic-bass",
  "big room": "big-room",
  "afro house": "afro-house",
  "color bass": "color-bass",
  psy: "psytrance",
  "riddim": "riddim",
  rhythm: "riddim",
});

const EVENT_ALIASES = Object.freeze({
  electronic: "edm",
  dance: "edm",
  "dance/electronic": "edm",
  "electronic/dance": "edm",
  club: "house",
  "drum and bass": "dnb",
  "drum & bass": "dnb",
  bass: "bass-music",
  "bass music": "bass-music",
  garage: "ukg",
  "uk garage": "ukg",
  disco: "disco-funk",
  funk: "disco-funk",
  "lo-fi": "lofi",
  downtempo: "lofi",
  psy: "psytrance",
  psychedelic: "psytrance",
  "tech house": "tech-house",
  "deep house": "deep-house",
  "progressive house": "progressive-house",
  "future bass": "future-bass",
  "melodic bass": "melodic-bass",
  "big room": "big-room",
  "afro house": "afro-house",
  "color bass": "color-bass",
  "hip hop": "hip-hop",
  "hip-hop": "hip-hop",
  rap: "hip-hop",
  house: "house",
  techno: "techno",
  trance: "trance",
  dubstep: "dubstep",
  riddim: "riddim",
  hardstyle: "hardstyle",
  trap: "trap",
  hardcore: "hardcore",
  jungle: "jungle",
  midtempo: "midtempo",
  breaks: "breaks",
  "breakbeat": "breaks",
  experimental: "experimental",
});

function parseList(val) {
  if (Array.isArray(val)) return val;
  try {
    const v = JSON.parse(val || "[]");
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

function slugify(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonId(raw) {
  if (raw && typeof raw === "object") raw = raw.id || raw.name || raw.label || "";
  const s = slugify(raw);
  if (!s) return null;
  if (BY_ID[s]) return s;
  const compact = s.replace(/\s+/g, "-");
  if (BY_ID[compact]) return compact;
  if (LEGACY[s]) return LEGACY[s];
  if (LEGACY[compact]) return LEGACY[compact];
  return null;
}

function normalizeGenreIds(list, max) {
  const cap = Number.isFinite(max) ? max : MAX_GENRES;
  const out = [];
  const seen = new Set();
  for (const item of parseList(list)) {
    const id = canonId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

function getGenre(id) {
  return BY_ID[canonId(id)] || null;
}

function publicGenre(g) {
  if (!g) return null;
  const row = typeof g === "string" ? getGenre(g) : g;
  if (!row) return null;
  return { id: row.id, name: row.name, short: row.short, color: row.color, icon: row.icon };
}

function publicGenres(list) {
  return normalizeGenreIds(list).map((id) => publicGenre(id)).filter(Boolean);
}

function catalog() {
  return GENRES.map((g) => publicGenre(g));
}

function sharedGenreIds(a, b) {
  const set = new Set(normalizeGenreIds(a));
  return normalizeGenreIds(b).filter((id) => set.has(id));
}

function sharedGenreChip(mine, theirs) {
  const shared = sharedGenreIds(mine, theirs);
  if (!shared.length) return "";
  const first = getGenre(shared[0]);
  if (!first) return "";
  if (shared.length === 1) return "You both like " + first.name;
  return "You both like " + first.name + " + " + (shared.length - 1) + " more";
}

function eventGenreIds(event) {
  const raw = parseList(event && (event.genres || event.genre));
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const s = slugify(item);
    let id = canonId(s) || EVENT_ALIASES[s] || null;
    if (!id) {
      const compact = s.replace(/\s+/g, "-");
      id = BY_ID[compact] ? compact : EVENT_ALIASES[compact] || null;
    }
    if (!id) {
      for (const g of GENRES) {
        if (s.includes(g.id.replace(/-/g, " ")) || s.includes(g.name.toLowerCase()) || s.includes(g.short.toLowerCase())) {
          id = g.id;
          break;
        }
      }
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function eventMatchesGenre(event, genreId) {
  const want = canonId(genreId);
  if (!want) return false;
  return eventGenreIds(event).includes(want);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function migrateUserVibes(db) {
  const rows = await db.prepare(`SELECT id, vibes FROM users`).all();
  let changed = 0;
  for (const row of rows) {
    const prev = parseList(row.vibes);
    const next = normalizeGenreIds(prev);
    const prevCanon = [];
    const seen = new Set();
    for (const item of prev) {
      const id = canonId(item);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      prevCanon.push(id);
    }
    // Rewrite if legacy ids were used, or if we dropped invalid leftovers / capped the list.
    if (sameJson(prev, next) && sameJson(prevCanon, next)) continue;
    await db.prepare(`UPDATE users SET vibes=? WHERE id=?`).run(JSON.stringify(next), row.id);
    changed += 1;
  }
  return changed;
}

module.exports = {
  MAX_GENRES,
  GENRES,
  catalog,
  getGenre,
  canonId,
  normalizeGenreIds,
  publicGenre,
  publicGenres,
  sharedGenreIds,
  sharedGenreChip,
  eventGenreIds,
  eventMatchesGenre,
  migrateUserVibes,
  parseList,
};
