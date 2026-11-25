"use strict";

// "Favorite song" for profiles: Apple iTunes Search API (free, no key) behind a
// cached, rate-limited proxy, plus strict validation of what gets stored.

const SEARCH_URL = "https://itunes.apple.com/search";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 600;
// Apple allows roughly 20 calls/minute per IP; stay under it across all users.
const UPSTREAM_PER_MIN = 18;
const USER_PER_MIN = 20;

const cache = new Map(); // key -> { at, results }
const userHits = new Map();
let upstreamHits = [];

function clip(s, n) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
}

function httpsUrl(raw, hostRe) {
  const s = String(raw || "").trim();
  if (!s || s.length > 600) return "";
  let u;
  try { u = new URL(s); } catch (_) { return ""; }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:" || !hostRe.test(u.hostname)) return "";
  return u.toString();
}

const ART_HOST = /^is\d*-ssl\.mzstatic\.com$/i;
const PREVIEW_HOST = /^(audio-ssl\.itunes\.apple\.com|[a-z0-9-]+\.itunes\.apple\.com|[a-z0-9.-]+\.mzstatic\.com)$/i;
const STORE_HOST = /^(music\.apple\.com|itunes\.apple\.com|geo\.music\.apple\.com)$/i;

function bigArtwork(url, size) {
  const px = size || 600;
  return String(url || "").replace(/\/\d+x\d+(bb|cc)?(-\d+)?\.(jpg|png|webp)$/i, `/${px}x${px}bb.jpg`);
}

// Accepts an iTunes result or our stored shape. Returns a clean object or null.
function normalizeSong(raw) {
  if (!raw || typeof raw !== "object") return null;
  const trackId = Number(raw.trackId);
  if (!Number.isSafeInteger(trackId) || trackId <= 0) return null;
  const title = clip(raw.title != null ? raw.title : raw.trackName, 160);
  const artist = clip(raw.artist != null ? raw.artist : raw.artistName, 160);
  if (!title || !artist) return null;
  const artRaw = raw.artworkUrl || raw.artworkUrl100 || raw.artworkUrl60 || "";
  const artworkUrl = httpsUrl(bigArtwork(artRaw, 600), ART_HOST);
  const previewUrl = httpsUrl(raw.previewUrl, PREVIEW_HOST);
  const trackViewUrl = httpsUrl(raw.trackViewUrl, STORE_HOST);
  const album = clip(raw.album != null ? raw.album : raw.collectionName, 160);
  return { trackId, title, artist, album, artworkUrl, previewUrl, trackViewUrl };
}

function parseStoredSong(val) {
  if (!val) return null;
  try {
    return normalizeSong(typeof val === "string" ? JSON.parse(val) : val);
  } catch (_) {
    return null;
  }
}

function allow(map, key, max) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((t) => now - t < 60000);
  if (list.length >= max) { map.set(key, list); return false; }
  list.push(now);
  map.set(key, list);
  if (map.size > 5000) for (const [k, v] of map) if (!v.some((t) => now - t < 60000)) map.delete(k);
  return true;
}

async function searchSongs(term, { userId, fetchImpl } = {}) {
  const q = clip(term, 80).toLowerCase();
  if (q.length < 2) return { results: [] };
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    cache.delete(q); cache.set(q, hit); // LRU touch
    return { results: hit.results, cached: true };
  }
  if (!allow(userHits, String(userId || "anon"), USER_PER_MIN)) {
    const err = new Error("Slow down a sec — too many searches. Try again in a minute.");
    err.status = 429;
    throw err;
  }
  const now = Date.now();
  upstreamHits = upstreamHits.filter((t) => now - t < 60000);
  if (upstreamHits.length >= UPSTREAM_PER_MIN) {
    const err = new Error("Song search is busy right now. Try again in a few seconds.");
    err.status = 429;
    throw err;
  }
  upstreamHits.push(now);
  const params = new URLSearchParams({ term: q, media: "music", entity: "song", limit: "15", country: "US" });
  const f = fetchImpl || fetch;
  let data;
  try {
    const res = await f(SEARCH_URL + "?" + params.toString(), {
      headers: { Accept: "application/json", "User-Agent": "Kandi/1.0 (+https://kandi-6rih.onrender.com)" },
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    });
    if (res.status === 403 || res.status === 429) {
      const err = new Error("Song search is busy right now. Try again in a few seconds.");
      err.status = 429;
      throw err;
    }
    if (!res.ok) throw new Error("iTunes search failed: " + res.status);
    data = await res.json();
  } catch (err) {
    if (err.status) throw err;
    const e = new Error("Couldn't reach song search. Try again.");
    e.status = 502;
    throw e;
  }
  const seen = new Set();
  const results = [];
  for (const r of (data && data.results) || []) {
    if (r.kind && r.kind !== "song") continue;
    const s = normalizeSong(r);
    if (!s || seen.has(s.trackId)) continue;
    seen.add(s.trackId);
    results.push(s);
  }
  cache.set(q, { at: Date.now(), results });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return { results };
}

module.exports = { normalizeSong, parseStoredSong, searchSongs, bigArtwork };
