#!/usr/bin/env node
"use strict";

/**
 * Fetch upcoming Salt Lake City / Utah raves and concerts from no-browser
 * sources, normalize, dedupe, upsert into the Kandi database, and optionally
 * write data/slc-events-2026.json.
 *
 * Ticketmaster Discovery is used only when TICKETMASTER_API_KEY or TM_API_KEY
 * is set. Eventbrite is skipped without a key. Neither key is required.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const ROOT = path.join(__dirname, "..");
const { eventKey } = require("../src/event-key");
const { lineupFromSource, syncImportedSets } = require("../src/sets");
const JSON_PATH = path.join(ROOT, "data", "slc-events-2026.json");
const USER_AGENT = "KandiEventBot/1.0 (+https://github.com/Bmatts1998/kandi)";
const FETCH_TIMEOUT_MS = 20000;
const WINDOW_DAYS = 183;
const CITY_DEFAULT = "Salt Lake City";
const TZ = "America/Denver";

const SKIP_VENUE_RE = /\b(tba|tbd|secret\s+(location|warehouse|venue)|unannounced|to be announced)\b/i;
const SKIP_TYPE_RE = /\b(comedy|comedian|stand-?up|comic|nba|nhl|nfl|mlb|hockey|basketball|soccer|football game|wrestling|wwe|disney on ice|dancing with the stars|movie|film screening|circus)\b/i;
const SKIP_ARTIST_RE = /\b(jimmy failla)\b/i;
const RAVE_RE = /\b(rave|edm|dj\b|deejay|techno|tech[\s-]?house|deep house|house music|\bhouse\b|trance|dubstep|drum(?:\s*and|&|\s*n)\s*bass|dnb|d&b|bass music|riddim|hardstyle|hard techno|ukg|jungle|breakbeat|complextro|electro|progressive house|future bass|melodic bass|midtempo|psydub|drumcode|garage)\b/i;
const RAVE_FORMATS = new Set(["club night", "dj showcase", "festival"]);
const RAVE_GENRES = new Set(["bass", "house", "techno", "trance", "edm", "drum & bass", "drum and bass", "dubstep", "dance"]);
const RAVE_TITLE_RE = /\b(calvin harris|alesso|lsdream|virtual riot|blanke|sullivan king|biscits|sippy|will sparks|paul van dyk|krewella|dillon francis|midnight tyrannosaurus|yheti|toadface|genix|rinzen|josh fawaz|layton giordani|valentino khan|hol!?|bunt\.?|fkj|shygirl|eptic|jstjr|byorn|isoxo|kettama|klangkuenstler|josh baker|knock2|subtronics|excision|zeds dead|rezz|illenium|pretty lights|tipper|daily bread|clozee|liquid stranger|tape b|john summit|fisher|dom dolla|chris lake|sara landry)\b/i;

function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, m[1])) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

function fetchBuffer(url, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (err) { reject(err); return; }
    const lib = parsed.protocol === "http:" ? http : https;
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/html;q=0.9, */*;q=0.8", ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          fetchBuffer(next, { method, headers, body }).then(resolve, reject);
          return;
        }
        resolve({ status, headers: res.headers, body: buf });
      });
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error("timeout " + url));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchText(url, opts) {
  const r = await fetchBuffer(url, opts);
  return { status: r.status, text: r.body.toString("utf8") };
}

async function fetchJson(url, opts) {
  const r = await fetchText(url, opts);
  if (r.status < 200 || r.status >= 300) throw new Error("HTTP " + r.status + " " + url);
  return JSON.parse(r.text);
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function nthWeekday(year, month, weekday, n) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  const first = d.getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return day;
}

function denverOffsetForDate(year, month, day, hour) {
  const dstStart = nthWeekday(year, 3, 0, 2);
  const dstEnd = nthWeekday(year, 11, 0, 1);
  const mins = month * 10000 + day * 100 + hour;
  const start = 3 * 10000 + dstStart * 100 + 2;
  const end = 11 * 10000 + dstEnd * 100 + 2;
  return mins >= start && mins < end ? "-06:00" : "-07:00";
}

function parseYmd(s) {
  const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function parseTime12(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
  if (!m) {
    const m24 = String(raw).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (!m24) return null;
    return { h: Number(m24[1]), min: Number(m24[2]) };
  }
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3].toLowerCase().startsWith("p");
  if (ap && h < 12) h += 12;
  if (!ap && h === 12) h = 0;
  return { h, min };
}

function toStartsAt(dateStr, timeHint) {
  const ymd = parseYmd(dateStr);
  if (!ymd) return "";
  let t = parseTime12(timeHint);
  let dateOnly = false;
  if (!t) {
    t = { h: 23, min: 59 };
    dateOnly = true;
  }
  const off = denverOffsetForDate(ymd.y, ymd.mo, ymd.d, t.h);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    startsAt: `${ymd.y}-${pad(ymd.mo)}-${pad(ymd.d)}T${pad(t.h)}:${pad(t.min)}:00${off}`,
    dateOnly,
    ymd,
  };
}

function formatDateLabel(startsAt, dateOnly) {
  try {
    const d = new Date(startsAt);
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: TZ }).format(d);
    const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: TZ }).format(d);
    const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: TZ }).format(d);
    const year = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: TZ }).format(d);
    const thisYear = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: TZ }).format(new Date());
    const yearBit = year === thisYear ? "" : `, ${year}`;
    if (dateOnly) return `${weekday}, ${month} ${day}${yearBit} · Time TBA`;
    const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(d);
    return `${weekday}, ${month} ${day}${yearBit} · ${time}`;
  } catch {
    return startsAt.slice(0, 10);
  }
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "event";
}

function normalizeKeyPart(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(the|at|and|tour|presents|live|north america|usa|world)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesOverlap(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 8 && b.includes(a)) return true;
  if (b.length >= 8 && a.includes(b)) return true;
  const words = (s) => s.split(" ").filter((w) => w.length >= 5);
  return words(a).some((w) => words(b).includes(w));
}

function venuesOverlap(a, b) {
  const ka = venueKey(a);
  const kb = venueKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length >= 8 && kb.length >= 8 && (ka.includes(kb) || kb.includes(ka))) return true;
  return false;
}

function eventDateKey(startsAt) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(startsAt));
  } catch {
    return String(startsAt || "").slice(0, 10);
  }
}

function venueKey(s) {
  return normalizeKeyPart(s);
}

function dedupeKey(ev) {
  return [normalizeKeyPart(ev.name), venueKey(ev.venue), eventDateKey(ev.startsAt)].join("|");
}

function classify(ev) {
  const format = String(ev.format || "").toLowerCase();
  const genres = (ev.genres || []).map((g) => String(g).toLowerCase());
  const name = String(ev.name || "");
  const venue = String(ev.venue || "");
  if (/new year.?s eve festival/i.test(name) && /delta center/i.test(venue)) return "concert";
  if (ev.source === "residentadvisor") return "rave";
  if (ev.source === "skyslc") return "rave";
  if (ev.source === "electronicslc") {
    if (RAVE_FORMATS.has(format)) return "rave";
    if (genres.some((g) => RAVE_GENRES.has(g))) return "rave";
    if (RAVE_RE.test([ev.name, ...(ev.artists || []), ev.venue].join(" "))) return "rave";
    if (RAVE_TITLE_RE.test(ev.name)) return "rave";
    if (format === "concert") return "concert";
    return "rave";
  }
  const blob = [ev.name, ...(ev.artists || []), ...(ev.genres || []), ev.venue, ev.format].join(" ");
  if (RAVE_TITLE_RE.test(ev.name) || RAVE_RE.test(blob) || genres.some((g) => RAVE_GENRES.has(g))) return "rave";
  return "concert";
}

function styleFor(category) {
  if (category === "rave") {
    return { emoji: "🎧", color: "linear-gradient(160deg,#1a0a00,#ff5c00 55%,#ffc14d)" };
  }
  return { emoji: "🎤", color: "linear-gradient(160deg,#140c08,#3a2a20 55%,#ff8a1a)" };
}

function cityFor(venue, fallback) {
  const v = String(venue || "").toLowerCase();
  if (/saltair|magna/.test(v)) return "Magna";
  if (/maverik|usana|west valley/.test(v)) return "West Valley City";
  if (/park city|marquis|downstairs park/.test(v)) return "Park City";
  if (/ogden/.test(v)) return "Ogden";
  if (/provo/.test(v)) return "Provo";
  return fallback || CITY_DEFAULT;
}

function inWindow(startsAt, title) {
  const t = Date.parse(startsAt);
  if (Number.isNaN(t)) return false;
  if (t < Date.now()) return false;
  const end = Date.now() + WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (t <= end) return true;
  return /das energi/i.test(title || "");
}

function skipReason(ev) {
  if (!ev.name || !ev.venue || !ev.startsAt) return "missing title, venue, or date";
  if (SKIP_VENUE_RE.test(ev.venue) || ev.venue.toLowerCase() === "tba") return "venue unannounced";
  if (SKIP_TYPE_RE.test(ev.name) || SKIP_TYPE_RE.test((ev.genres || []).join(" ")) || SKIP_TYPE_RE.test((ev.artists || []).join(" "))) return "non-music";
  if (typeof SKIP_ARTIST_RE !== "undefined" && (SKIP_ARTIST_RE.test(ev.name) || SKIP_ARTIST_RE.test((ev.artists || []).join(" ")))) return "non-music";
  if (!inWindow(ev.startsAt, ev.name)) return "outside window";
  return null;
}

function ticketSellerFromUrl(url) {
  if (!url) return "";
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
  const map = [
    ["ticketmaster.com", "Ticketmaster"],
    ["livenation.com", "Live Nation"],
    ["axs.com", "AXS"],
    ["tixr.com", "Tixr"],
    ["eventbrite.com", "Eventbrite"],
    ["ticketsauce.com", "Ticket Sauce"],
    ["24tix.com", "24tix"],
    ["dice.fm", "Dice"],
    ["seatgeek.com", "SeatGeek"],
    ["eventliveus.com", "EventLive"],
    ["skyslc.com", "Sky SLC"],
    ["soundwellslc.com", "Soundwell"],
    ["thecomplexslc.com", "The Complex"],
    ["deltacenter.com", "Delta Center"],
    ["ra.co", "Resident Advisor"],
    ["v2presents.com", "V2 Presents"],
    ["instagram.com", "Instagram"],
    ["tickettailor.com", "Ticket Tailor"],
    ["seetickets.com", "See Tickets"],
    ["seetickets.us", "See Tickets"],
  ];
  for (const [h, name] of map) {
    if (host === h || host.endsWith("." + h)) return name;
  }
  return host;
}

function formatStreetAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") {
    const s = decodeEntities(addr).replace(/\s+/g, " ").trim();
    return /\d/.test(s) && !/^[^\d]+,\s*(Utah|UT)\s*$/i.test(s) ? s : "";
  }
  const street = addr.streetAddress || addr.address_line || addr.street || addr.address || "";
  const city = addr.addressLocality || addr.city || "";
  const region = addr.addressRegion || addr.state || "";
  const postal = addr.postalCode || "";
  const regionPostal = [region, postal].filter(Boolean).join(" ");
  const line = [stripHtml(street), stripHtml(city), regionPostal].filter(Boolean).join(", ");
  return /\d/.test(line) && street ? line : "";
}

function addressFromVenue(venue, fallback) {
  if (!venue) return fallback || "";
  const map = globalThis.__venueAddresses;
  if (!map) return fallback || "";
  const key = normalizeKeyPart(venue);
  if (map.has(key)) return map.get(key);
  for (const [k, addr] of map) {
    if (k.length >= 8 && key.length >= 8 && (key.includes(k) || k.includes(key))) return addr;
  }
  return fallback || "";
}

function rememberAddress(venue, address) {
  const addr = formatStreetAddress(address);
  if (!venue || !addr) return addr;
  globalThis.__venueAddresses = globalThis.__venueAddresses || new Map();
  const key = normalizeKeyPart(venue);
  if (key && !globalThis.__venueAddresses.has(key)) globalThis.__venueAddresses.set(key, addr);
  return addr;
}

function looksLikeStreetAddress(line) {
  return /^\d{1,5}\s+.+,\s*.*\b(UT|Utah)\b/i.test(String(line || "").trim());
}

async function fetchElectronicSlcVenues() {
  const { status, text } = await fetchText("https://electronicslc.com/");
  if (status !== 200) throw new Error("HTTP " + status);
  const paths = Array.from(new Set((text.match(/href="(\/venues\/[^"]+\/)"/g) || []).map((h) => h.slice(6, -1))));
  let loaded = 0;
  for (const path of paths) {
    try {
      const page = await fetchText("https://electronicslc.com" + path);
      if (page.status !== 200) continue;
      const stripped = page.text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n");
      const lines = stripped.split(/\n+/).map((l) => decodeEntities(l).replace(/\s+/g, " ").trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        if (!looksLikeStreetAddress(lines[i])) continue;
        let name = "";
        for (let j = i - 1; j >= 0; j--) {
          if (!/^(Newsletter|Submit|Artists|Venues|Events|Electronic|SLC|Skip to main content)$/i.test(lines[j]) && !/Electronic SLC/i.test(lines[j])) {
            name = lines[j];
            break;
          }
        }
        if (name) {
          rememberAddress(name, lines[i]);
          loaded += 1;
        }
        break;
      }
    } catch {
      /* skip one venue page */
    }
  }
  return loaded;
}

function finalize(partial) {
  const category = partial.category || classify(partial);
  const style = styleFor(category);
  const dateOnly = !!partial.dateOnly;
  const ev = {
    id: partial.id || `${eventDateKey(partial.startsAt)}-${slugify(partial.name)}-${slugify(partial.venue)}`,
    name: stripHtml(partial.name),
    artists: (partial.artists || []).map(stripHtml).filter(Boolean),
    venue: stripHtml(partial.venue),
    city: partial.city || cityFor(partial.venue),
    startsAt: partial.startsAt,
    dateLabel: partial.dateLabel || formatDateLabel(partial.startsAt, dateOnly),
    category,
    genres: (partial.genres || []).map(stripHtml).filter(Boolean),
    ageLimit: stripHtml(partial.ageLimit || ""),
    ticketUrl: partial.ticketUrl || "",
    ticketSeller: partial.ticketSeller || ticketSellerFromUrl(partial.ticketUrl || ""),
    sourceUrl: partial.sourceUrl || "",
    imageUrl: partial.imageUrl || "",
    source: partial.source,
    emoji: partial.emoji || style.emoji,
    color: partial.color || style.color,
    dateOnly: !!partial.dateOnly,
    timeTba: !!dateOnly,
    address: rememberAddress(partial.venue, partial.address) || addressFromVenue(partial.venue, ""),
    endsAt: partial.endsAt || "",
    lineup: Array.isArray(partial.lineup) ? partial.lineup : [],
    raw: partial.raw || null,
  };
  if (!ev.lineup.length) ev.lineup = lineupFromSource(ev, ev.raw);
  const reason = skipReason(ev);
  if (reason) return null;
  return ev;
}

function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim());
      const stack = Array.isArray(data) ? data.slice() : [data];
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== "object") continue;
        if (node["@graph"]) {
          const g = node["@graph"];
          stack.push(...(Array.isArray(g) ? g : [g]));
          continue;
        }
        const types = [].concat(node["@type"] || []);
        if (types.some((t) => t === "Event" || t === "MusicEvent" || t === "Festival")) out.push(node);
      }
    } catch {
      /* ignore bad blocks */
    }
  }
  return out;
}

function eventFromJsonLd(node, source, fallbackVenue) {
  let loc = node.location || {};
  if (Array.isArray(loc)) loc = loc[0] || {};
  const venue = (loc && loc.name) || fallbackVenue || "";
  const start = node.startDate || node.startTime || "";
  const ymd = parseYmd(start);
  if (!ymd) return null;
  const hasTime = /T\d{2}:\d{2}/.test(String(start));
  let startsAt;
  let dateOnly = false;
  if (hasTime) {
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(String(start))) startsAt = new Date(start).toISOString() ? start : start;
    else {
      const tm = String(start).match(/T(\d{2}):(\d{2})/);
      const built = toStartsAt(`${ymd.y}-${String(ymd.mo).padStart(2, "0")}-${String(ymd.d).padStart(2, "0")}`, tm ? `${tm[1]}:${tm[2]}` : null);
      startsAt = built.startsAt;
      dateOnly = built.dateOnly;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(start)) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(String(start))) {
      const built = toStartsAt(start.slice(0, 10), start.slice(11, 16));
      startsAt = built.startsAt;
      dateOnly = built.dateOnly;
    }
  } else {
    const built = toStartsAt(String(start).slice(0, 10), null);
    startsAt = built.startsAt;
    dateOnly = true;
  }
  let artists = [];
  const perf = node.performer || node.performers;
  if (Array.isArray(perf)) artists = perf.map((p) => (typeof p === "string" ? p : p && p.name)).filter(Boolean);
  else if (perf && typeof perf === "object") artists = [perf.name].filter(Boolean);
  let image = node.image;
  if (Array.isArray(image)) image = image[0];
  if (image && typeof image === "object") image = image.url || image.contentUrl || "";
  const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  const ticketUrl = (offers && (offers.url || offers.availability)) && typeof offers === "object" ? (offers.url || "") : "";
  return finalize({
    name: stripHtml(node.name || ""),
    artists,
    venue,
    city: (loc && loc.address && (loc.address.addressLocality || loc.address.city)) || cityFor(venue),
    address: formatStreetAddress(loc && loc.address),
    startsAt,
    dateOnly,
    ticketUrl: ticketUrl || node.url || "",
    sourceUrl: node.url || "",
    imageUrl: image || "",
    ageLimit: node.typicalAgeRange || node.maximumAttendeeCapacity && "" || "",
    source,
  });
}

async function fetchElectronicSlc() {
  const { status, text } = await fetchText("https://electronicslc.com/");
  if (status !== 200) throw new Error("HTTP " + status);
  const events = [];
  const sectionRe = /<section class="date-section" data-day="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/section>/g;
  let sec;
  while ((sec = sectionRe.exec(text))) {
    const day = sec[1];
    const cardRe = /<article class="event-card" data-event-id="([^"]+)">([\s\S]*?)<\/article>/g;
    let card;
    while ((card = cardRe.exec(sec[2]))) {
      const body = card[2];
      const titleM = body.match(/class="event-title"><a[^>]*>([\s\S]*?)<\/a>/);
      const venueM = body.match(/class="venue-credit"[^>]*>([\s\S]*?)<\/a>/);
      const artists = [];
      const artRe = /class="artist-credit">([\s\S]*?)<\/span>/g;
      let am;
      while ((am = artRe.exec(body))) artists.push(stripHtml(am[1]));
      const times = [];
      const tmRe = />(Doors [^<]+|Start [^<]+)</g;
      let tm;
      while ((tm = tmRe.exec(body))) times.push(tm[1]);
      const startHint = (times.find((t) => /^Start /i.test(t)) || times[0] || "").replace(/^Start\s+/i, "").replace(/^Doors\s+/i, "");
      const ageM = body.match(/>(\d+\+|All ages|AA)</i);
      const genres = [];
      const gRe = /class="tag tag-genre">([\s\S]*?)<\/span>/g;
      let gm;
      while ((gm = gRe.exec(body))) genres.push(stripHtml(gm[1]));
      const fmtM = body.match(/class="event-format">([\s\S]*?)<\/span>/);
      const tickM = body.match(/class="btn btn-small" href="([^"]+)"/);
      const imgM = body.match(/<img src="([^"]+)"/);
      let imageUrl = imgM ? imgM[1] : "";
      if (imageUrl.startsWith("/")) imageUrl = "https://electronicslc.com" + imageUrl;
      const built = toStartsAt(day, startHint);
      const ev = finalize({
        id: card[1],
        name: stripHtml(titleM ? titleM[1] : ""),
        artists,
        venue: stripHtml(venueM ? venueM[1] : ""),
        city: cityFor(venueM ? venueM[1] : ""),
        startsAt: built.startsAt,
        dateOnly: built.dateOnly && !startHint,
        genres,
        format: stripHtml(fmtM ? fmtM[1] : ""),
        ageLimit: ageM ? ageM[1] : "",
        ticketUrl: tickM ? tickM[1] : "",
        sourceUrl: "https://electronicslc.com/events/" + card[1] + "/",
        imageUrl,
        source: "electronicslc",
      });
      if (ev) events.push(ev);
    }
  }
  return events;
}

async function fetchResidentAdvisor() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const queryCore = `id title date startTime contentUrl flyerFront minimumAge
          venue { name area { name } }
          artists { name }
          genres { name }`;
  const queryWithLineup = `query ($f: FilterInputDtoInput, $s: SortInputDtoInput) {
    eventListings(filters: $f, pageSize: 80, page: 1, sort: $s) {
      data {
        event {
          ${queryCore}
          timetable { start end startTime endTime area { name } artists { name } }
        }
      }
      totalResults
    }
  }`;
  const query = `query ($f: FilterInputDtoInput, $s: SortInputDtoInput) {
    eventListings(filters: $f, pageSize: 80, page: 1, sort: $s) {
      data {
        event {
          ${queryCore}
        }
      }
      totalResults
    }
  }`;
  async function raQuery(q) {
    const body = JSON.stringify({
      query: q,
      variables: {
        f: { areas: { eq: 592 }, listingDate: { gte: today } },
        s: { listingDate: { order: "ASCENDING" } },
      },
    });
    const { status, text } = await fetchText("https://ra.co/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://ra.co/events/us/saltlakecity",
        Origin: "https://ra.co",
      },
      body,
    });
    if (status !== 200) throw new Error("HTTP " + status);
    return JSON.parse(text);
  }
  let data;
  try {
    data = await raQuery(queryWithLineup);
    if (data.errors && data.errors.length) data = await raQuery(query);
  } catch {
    data = await raQuery(query);
  }
  if (data.errors && data.errors.length) throw new Error(data.errors[0].message);
  const rows = (((data.data || {}).eventListings || {}).data) || [];
  const events = [];
  for (const row of rows) {
    const e = row.event || {};
    const day = String(e.date || "").slice(0, 10);
    const timeHint = e.startTime && String(e.startTime).includes("T") ? String(e.startTime).slice(11, 16) : e.startTime;
    const built = toStartsAt(day, timeHint);
    const venue = (e.venue && e.venue.name) || "";
    const ev = finalize({
      id: "ra-" + e.id,
      name: e.title,
      artists: (e.artists || []).map((a) => a.name).filter(Boolean),
      venue,
      city: cityFor(venue, (e.venue && e.venue.area && e.venue.area.name) || CITY_DEFAULT),
      startsAt: built.startsAt,
      dateOnly: built.dateOnly,
      genres: (e.genres || []).map((g) => g.name).filter(Boolean),
      ageLimit: e.minimumAge ? String(e.minimumAge) + "+" : "",
      ticketUrl: e.contentUrl ? "https://ra.co" + e.contentUrl : "",
      sourceUrl: e.contentUrl ? "https://ra.co" + e.contentUrl : "https://ra.co/events/us/saltlakecity",
      imageUrl: e.flyerFront || "",
      source: "residentadvisor",
      raw: e,
    });
    if (ev) events.push(ev);
  }
  return events;
}

function looksDateOnly(ev) {
  return !!(ev.timeTba || ev.dateOnly);
}

async function enrichDeltaTimes(ev, url) {
  if (!url || !looksDateOnly(ev)) return ev;
  try {
    const { status, text } = await fetchText(url);
    if (status !== 200) return ev;
    const nodes = extractJsonLd(text);
    for (const node of nodes) {
      const start = node.startDate || "";
      if (/T\d{2}:\d{2}/.test(String(start))) {
        const ymd = parseYmd(start);
        const tm = String(start).match(/T(\d{2}):(\d{2})/);
        if (!ymd || !tm) continue;
        const built = toStartsAt(`${ymd.y}-${String(ymd.mo).padStart(2, "0")}-${String(ymd.d).padStart(2, "0")}`, `${tm[1]}:${tm[2]}`);
        ev.startsAt = built.startsAt;
        ev.dateOnly = false;
        ev.dateLabel = formatDateLabel(ev.startsAt, false);
        return ev;
      }
    }
    const timeM = text.match(/(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?)/) || text.match(/(\d{1,2}\s*[AaPp]\.?[Mm]\.?)/);
    if (timeM) {
      const day = ev.startsAt.slice(0, 10);
      const built = toStartsAt(day, timeM[1]);
      ev.startsAt = built.startsAt;
      ev.dateOnly = built.dateOnly;
      ev.dateLabel = formatDateLabel(ev.startsAt, ev.dateOnly);
    }
  } catch {
    /* keep date-only */
  }
  return ev;
}

async function fetchDeltaCenter() {
  const { status, text } = await fetchText("https://www.deltacenter.com/event-type/concert/");
  if (status !== 200) throw new Error("HTTP " + status);
  const events = [];
  for (const node of extractJsonLd(text)) {
    let ev = eventFromJsonLd(node, "deltacenter", "Delta Center");
    if (!ev) continue;
    ev.venue = ev.venue || "Delta Center";
    ev.city = "Salt Lake City";
    ev.sourceUrl = ev.sourceUrl || node.url || "";
    ev.ticketUrl = ev.ticketUrl || ev.sourceUrl;
    if (ev.dateOnly && ev.sourceUrl) ev = await enrichDeltaTimes(ev, ev.sourceUrl);
    // Re-run window check after enrich
    if (!inWindow(ev.startsAt, ev.name)) continue;
    if (/calvin harris/i.test(ev.name)) {
      ev.category = "rave";
      const style = styleFor("rave");
      ev.emoji = style.emoji;
      ev.color = style.color;
    }
    events.push(ev);
  }
  return events;
}

function firstMediaUrl(media) {
  if (!media || typeof media !== "object") return "";
  const preferred = media["20"] || media["24"] || media["88"] || media["89"] || media["5"];
  if (preferred && preferred.file_name) return preferred.file_name;
  for (const v of Object.values(media)) {
    if (v && v.file_name && /https?:/.test(v.file_name) && !/defaults/.test(v.file_name)) return v.file_name;
  }
  return "";
}

async function fetchComplexAeg() {
  const data = await fetchJson("https://aegwebprod.blob.core.windows.net/json/events/376/events.json");
  const list = data.events || [];
  const events = [];
  for (const e of list) {
    if (e.active === false) continue;
    const title = e.title || {};
    const name = stripHtml(title.eventTitleText || title.headlinersText || "");
    const tour = stripHtml(title.tour || "");
    const display = tour && !name.toLowerCase().includes(tour.toLowerCase()) ? `${name}: ${tour}` : name;
    const venue = (e.venue && (e.venue.title || e.venue.name)) || "The Complex";
    const venueAddress = formatStreetAddress((e.venue && (e.venue.address_line || e.venue.address)) ? (e.venue.address_line || [e.venue.address, e.venue.city, [e.venue.state, e.venue.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")) : "");
    const iso = e.eventDateTimeISO || "";
    const day = String(e.eventDateTime || iso || "").slice(0, 10);
    const timeHint = iso && /T\d{2}:\d{2}/.test(iso) ? iso.slice(11, 16) : (e.eventDateTime || "").slice(11, 16);
    const built = iso && /[+-]\d{2}:\d{2}$/.test(iso)
      ? { startsAt: iso, dateOnly: false }
      : toStartsAt(day, timeHint);
    const artists = [];
    const heads = ((e.associations || {}).headliners) || [];
    const support = ((e.associations || {}).supportingActs) || [];
    for (const a of heads.concat(support)) {
      const n = a.name || a.title || (a.locale && a.locale.name);
      // headliners may only have performerId; title is in e.title
    }
    if (title.headlinersText) artists.push(stripHtml(title.headlinersText));
    const ticketUrl = (e.ticketing && (e.ticketing.url || e.ticketing.eventUrl)) || "";
    const blob = [display, e.bio, e.description].map((x) => stripHtml(x || "")).join(" ");
    if (SKIP_TYPE_RE.test(blob) || SKIP_ARTIST_RE.test(blob)) continue;
    const ev = finalize({
      id: "complex-" + e.eventId,
      name: display,
      artists: artists.filter(Boolean),
      venue,
      address: venueAddress,
      city: (e.venue && e.venue.city) || "Salt Lake City",
      startsAt: built.startsAt,
      dateOnly: built.dateOnly,
      ageLimit: e.age || "",
      ticketUrl,
      sourceUrl: ticketUrl || `https://www.thecomplexslc.com/events/detail/?event_id=${e.eventId}`,
      imageUrl: firstMediaUrl(e.media) || firstMediaUrl(e.relatedMedia),
      source: "complex-aeg",
    });
    if (ev) events.push(ev);
  }
  return events;
}

async function fetchTicketmaster() {
  const key = process.env.TICKETMASTER_API_KEY || process.env.TM_API_KEY;
  if (!key) {
    const err = new Error("skipped (no TICKETMASTER_API_KEY)");
    err.skipped = true;
    throw err;
  }
  const start = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const end = new Date(Date.now() + WINDOW_DAYS * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const url = "https://app.ticketmaster.com/discovery/v2/events.json"
    + "?apikey=" + encodeURIComponent(key)
    + "&stateCode=UT&city=Salt%20Lake%20City&classificationName=Music"
    + "&startDateTime=" + encodeURIComponent(start)
    + "&endDateTime=" + encodeURIComponent(end)
    + "&size=200&sort=date,asc";
  const data = await fetchJson(url);
  const list = (((data._embedded) || {}).events) || [];
  const events = [];
  for (const e of list) {
    const venue = ((((e._embedded) || {}).venues) || [])[0] || {};
    const startLocal = (e.dates && e.dates.start) || {};
    const day = startLocal.localDate || (startLocal.dateTime || "").slice(0, 10);
    const timeHint = startLocal.localTime || (startLocal.dateTime || "").slice(11, 16);
    const built = startLocal.dateTime && /Z|[+-]\d{2}:\d{2}$/.test(startLocal.dateTime) && startLocal.localTime
      ? toStartsAt(day, startLocal.localTime)
      : (startLocal.dateTime && /Z|[+-]\d{2}:\d{2}$/.test(startLocal.dateTime)
        ? { startsAt: startLocal.dateTime, dateOnly: !startLocal.localTime }
        : toStartsAt(day, timeHint));
    const artists = ((((e._embedded) || {}).attractions) || []).map((a) => a.name).filter(Boolean);
    const img = (e.images || []).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    const ev = finalize({
      id: "tm-" + e.id,
      name: e.name,
      artists,
      venue: venue.name || "",
      address: formatStreetAddress({
        streetAddress: venue.address && (venue.address.line1 || venue.address.line2),
        addressLocality: venue.city && venue.city.name,
        addressRegion: venue.state && venue.state.stateCode,
        postalCode: venue.postalCode,
      }),
      city: venue.city && venue.city.name || cityFor(venue.name),
      startsAt: built.startsAt,
      dateOnly: built.dateOnly || !startLocal.localTime,
      ticketUrl: e.url || "",
      sourceUrl: e.url || "",
      imageUrl: img ? img.url : "",
      source: "ticketmaster",
      genres: ((((e.classifications) || [])[0] || {}).genre || {}).name
        ? [e.classifications[0].genre.name]
        : [],
    });
    if (ev) events.push(ev);
  }
  return events;
}

function loadCurated() {
  if (!fs.existsSync(JSON_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
    const list = Array.isArray(data) ? data : data.events || [];
    return list.map((raw) => {
      const startsAt = raw.startsAt || raw.starts_at;
      if (!startsAt) return null;
      return finalize({
        id: raw.id,
        name: raw.name || raw.title,
        artists: raw.artists || [],
        venue: raw.venue,
        city: raw.city,
        startsAt,
        dateOnly: raw.timeTba === true || raw.time_tba === 1 || raw.time_tba === "1" || /Time TBA/i.test(raw.dateLabel || raw.date_label || ""),
        dateLabel: raw.dateLabel || raw.date_label,
        category: raw.category,
        genres: raw.genres || [],
        ageLimit: raw.ageLimit || raw.age_limit,
        ticketUrl: raw.ticketUrl || raw.ticket_url,
        ticketSeller: raw.ticketSeller || raw.ticket_seller,
        address: raw.address,
        endsAt: raw.endsAt || raw.ends_at,
        sourceUrl: raw.sourceUrl || raw.source_url,
        imageUrl: raw.imageUrl || raw.image_url,
        emoji: raw.emoji,
        color: raw.color,
        source: raw.source || "curated",
        lineup: raw.lineup || raw.sets || [],
      });
    }).filter(Boolean);
  } catch (err) {
    throw new Error("curated JSON: " + err.message);
  }
}

function mergeEvents(groups) {
  const byKey = new Map();
  for (const { source, events } of groups) {
    for (const ev of events) {
      let key = dedupeKey(ev);
      let prev = byKey.get(key);
      if (!prev) {
        const dateKey = eventDateKey(ev.startsAt);
        const venue = venueKey(ev.venue);
        const name = normalizeKeyPart(ev.name);
        for (const [k, existing] of byKey) {
          if (eventDateKey(existing.startsAt) !== dateKey) continue;
          if (!venuesOverlap(existing.venue, ev.venue)) continue;
          if (titlesOverlap(name, normalizeKeyPart(existing.name))) {
            key = k;
            prev = existing;
            break;
          }
        }
      }
      if (!prev) {
        ev.sources = Array.from(new Set([ev.source, source].filter(Boolean)));
        byKey.set(key, ev);
        continue;
      }
      const sources = new Set([...(prev.sources || [prev.source]), ev.source, source].filter(Boolean));
      const prefer = ev.source === "electronicslc" || ev.source === "complex-aeg" || ev.source === "deltacenter" ? ev : prev;
      const other = prefer === ev ? prev : ev;
      const merged = { ...other, ...prefer };
      if (!prefer.ticketUrl && other.ticketUrl) merged.ticketUrl = other.ticketUrl;
      if (!prefer.ticketSeller && other.ticketSeller) merged.ticketSeller = other.ticketSeller;
      if (!prefer.address && other.address) merged.address = other.address;
      if (!prefer.endsAt && other.endsAt) merged.endsAt = other.endsAt;
      if (!prefer.imageUrl && other.imageUrl) merged.imageUrl = other.imageUrl;
      if (!prefer.ageLimit && other.ageLimit) merged.ageLimit = other.ageLimit;
      if ((prefer.artists || []).length < (other.artists || []).length) merged.artists = other.artists;
      const preferLineup = prefer.lineup || [];
      const otherLineup = other.lineup || [];
      const timed = (list) => (list || []).filter((s) => s && (s.startsAt || s.starts_at)).length;
      if (timed(otherLineup) > timed(preferLineup) || (!preferLineup.length && otherLineup.length)) merged.lineup = otherLineup;
      else if (!merged.lineup || !merged.lineup.length) merged.lineup = preferLineup.length ? preferLineup : otherLineup;
      if (prefer.timeTba && !other.timeTba) {
        merged.startsAt = other.startsAt;
        merged.timeTba = false;
        merged.dateOnly = false;
        merged.dateLabel = other.dateLabel;
      } else if (prefer.dateLabel && !prefer.dateLabel.includes("·") && other.dateLabel && other.dateLabel.includes("·")) {
        merged.dateLabel = other.dateLabel;
        merged.startsAt = other.startsAt;
        merged.timeTba = other.timeTba;
      }
      // Prefer a nicer stable ESLC id when present
      if (/^\d{4}-\d{2}-\d{2}-/.test(prefer.id) === false && ev.source === "electronicslc") merged.id = ev.id;
      if (prev.source === "electronicslc") merged.id = prev.id;
      merged.sources = Array.from(sources);
      merged.source = merged.sources.includes("electronicslc")
        ? "electronicslc"
        : (merged.sources[0] || ev.source);
      byKey.set(key, merged);
    }
  }
  const merged = Array.from(byKey.values()).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  for (const ev of merged) {
    ev.category = classify(ev);
    const style = styleFor(ev.category);
    ev.emoji = style.emoji;
    ev.color = style.color;
    ev.timeTba = !!(ev.timeTba || ev.dateOnly);
    ev.address = ev.address || addressFromVenue(ev.venue, "");
    ev.ticketSeller = ev.ticketSeller || ticketSellerFromUrl(ev.ticketUrl);
    ev.dateLabel = formatDateLabel(ev.startsAt, ev.timeTba);
    delete ev.dateOnly;
  }
  return merged;
}

function toRow(ev) {
  return {
    id: ev.id,
    event_key: ev.eventKey || eventKey(ev),
    name: ev.name,
    city: ev.city,
    date_label: ev.dateLabel,
    venue: ev.venue,
    genres: JSON.stringify(ev.genres || []),
    artists: JSON.stringify(ev.artists || []),
    emoji: ev.emoji,
    color: ev.color,
    is_example: 0,
    category: ev.category,
    ticket_url: ev.ticketUrl || "",
    source_url: ev.sourceUrl || "",
    source: ev.source || "",
    sources: JSON.stringify(ev.sources || [ev.source].filter(Boolean)),
    image_url: ev.imageUrl || "",
    starts_at: ev.startsAt,
    age_limit: ev.ageLimit || "",
    status: "active",
    updated_at: new Date().toISOString(),
    address: ev.address || "",
    ticket_seller: ev.ticketSeller || ticketSellerFromUrl(ev.ticketUrl),
    time_tba: ev.timeTba ? 1 : 0,
    ends_at: ev.endsAt || "",
  };
}

async function upsertDatabase(events, sourceResults) {
  const { open } = require("../src/db");
  const db = await open();
  await db.prepare(`DELETE FROM events WHERE is_example=1`).run();

  // Upsert in place (never INSERT OR REPLACE): SQLite REPLACE deletes the row first
  // and would CASCADE-wipe event_going RSVPs. Reuse an existing id when the stable
  // event_key already exists so hourly source-id changes don't drop attendance.
  const upsertSql = `INSERT INTO events (
      id, event_key, name, city, date_label, venue, genres, emoji, color, is_example,
      category, ticket_url, source_url, source, sources, artists, image_url,
      starts_at, age_limit, status, updated_at, address, ticket_seller, time_tba, ends_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      event_key=excluded.event_key, name=excluded.name, city=excluded.city,
      date_label=excluded.date_label, venue=excluded.venue, genres=excluded.genres,
      emoji=excluded.emoji, color=excluded.color, is_example=excluded.is_example,
      category=excluded.category, ticket_url=excluded.ticket_url, source_url=excluded.source_url,
      source=excluded.source, sources=excluded.sources, artists=excluded.artists,
      image_url=excluded.image_url, starts_at=excluded.starts_at, age_limit=excluded.age_limit,
      status=excluded.status, updated_at=excluded.updated_at, address=excluded.address,
      ticket_seller=excluded.ticket_seller, time_tba=excluded.time_tba, ends_at=excluded.ends_at`;
  const stmt = await db.prepare(upsertSql);

  async function moveRsvps(fromId, toId, key) {
    if (!fromId || fromId === toId) return;
    const rows = await db.prepare(`SELECT * FROM event_going WHERE event_id=? OR event_key=?`).all(fromId, key);
    for (const row of rows) {
      const exists = await db.prepare(`SELECT user_id FROM event_going WHERE user_id=? AND (event_id=? OR event_key=?)`).get(row.user_id, toId, key);
      if (exists) {
        await db.prepare(`DELETE FROM event_going WHERE user_id=? AND event_id=?`).run(row.user_id, fromId);
      } else {
        await db.prepare(`UPDATE event_going SET event_id=?, event_key=? WHERE user_id=? AND event_id=?`).run(toId, key, row.user_id, fromId);
      }
    }
    await db.prepare(`UPDATE posts SET event_id=? WHERE event_id=?`).run(toId, fromId);
    await db.prepare(`UPDATE live SET event_id=? WHERE event_id=?`).run(toId, fromId);
  }

  for (const ev of events) {
    const r = toRow(ev);
    const byId = await db.prepare(`SELECT id, event_key FROM events WHERE id=?`).get(r.id);
    const byKey = r.event_key ? await db.prepare(`SELECT id, event_key FROM events WHERE event_key=?`).get(r.event_key) : null;
    if (byKey && byKey.id !== r.id) {
      // Keep the already-stored id so /api/events/:id and RSVPs stay stable.
      await moveRsvps(r.id, byKey.id, r.event_key);
      r.id = byKey.id;
    } else if (byId && r.event_key && byId.event_key && byId.event_key !== r.event_key) {
      const other = await db.prepare(`SELECT id FROM events WHERE event_key=?`).get(r.event_key);
      if (other && other.id !== byId.id) {
        await moveRsvps(other.id, byId.id, r.event_key);
      }
    }
    ev.id = r.id;
    ev.eventKey = r.event_key;
    await stmt.run(
      r.id, r.event_key, r.name, r.city, r.date_label, r.venue, r.genres, r.emoji, r.color, r.is_example,
      r.category, r.ticket_url, r.source_url, r.source, r.sources, r.artists, r.image_url,
      r.starts_at, r.age_limit, r.status, r.updated_at, r.address, r.ticket_seller, r.time_tba, r.ends_at
    );
  }

  const successfulLive = sourceResults.filter((s) => s.ok && !s.curated && !s.skipped).map((s) => s.id);
  const keptIds = new Set(events.map((e) => e.id));
  const existing = await db.prepare(`SELECT id, source, sources, starts_at, status FROM events WHERE is_example=0`).all();
  let removed = 0;
  for (const row of existing) {
    if (keptIds.has(row.id)) continue;
    if (String(row.status) === "removed") continue;
    const starts = Date.parse(row.starts_at || "");
    if (!Number.isNaN(starts) && starts < Date.now()) {
      await db.prepare(`UPDATE events SET status=?, updated_at=? WHERE id=?`).run("past", new Date().toISOString(), row.id);
      continue;
    }
    let sources = [];
    try { sources = JSON.parse(row.sources || "[]"); } catch { sources = []; }
    if (!sources.length && row.source) sources = [row.source];
    const liveSources = sources.filter((s) => successfulLive.includes(s));
    // Only mark removed when every live source it came from succeeded and dropped it,
    // and it was not kept via merge (including curated).
    if (liveSources.length && liveSources.every((s) => successfulLive.includes(s))) {
      await db.prepare(`UPDATE events SET status=?, updated_at=? WHERE id=?`).run("removed", new Date().toISOString(), row.id);
      removed += 1;
    }
  }

  await db.prepare(`INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES (?,?,?)`)
    .run("events_updated_at", new Date().toISOString(), new Date().toISOString());

  const active = events.length;
  let setsUpserted = 0;
  try {
    const synced = await syncImportedSets(db, events);
    setsUpserted = synced && synced.upserted || 0;
  } catch (err) {
    console.error("set-time import failed:", err && err.message ? err.message : err);
  }
  await db.close?.();
  return { upserted: active, removed, setsUpserted };
}

function writeSnapshot(events, sourceResults) {
  const payload = {
    generatedAt: new Date().toISOString(),
    timezone: TZ,
    sources: sourceResults.map((s) => ({
      id: s.id,
      ok: !!s.ok,
      skipped: !!s.skipped,
      count: s.count || 0,
      error: s.error || null,
    })),
    events: events.map((ev) => ({
      id: ev.id,
      name: ev.name,
      artists: ev.artists,
      venue: ev.venue,
      city: ev.city,
      startsAt: ev.startsAt,
      dateLabel: ev.dateLabel,
      category: ev.category,
      genres: ev.genres,
      ageLimit: ev.ageLimit,
      ticketUrl: ev.ticketUrl,
      ticketSeller: ev.ticketSeller,
      address: ev.address,
      timeTba: ev.timeTba,
      endsAt: ev.endsAt,
      lineup: ev.lineup || [],
      sourceUrl: ev.sourceUrl,
      imageUrl: ev.imageUrl,
      source: ev.source,
      sources: ev.sources,
      emoji: ev.emoji,
      color: ev.color,
    })),
  };
  fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true });
  fs.writeFileSync(JSON_PATH, JSON.stringify(payload, null, 2) + "\n");
  return JSON_PATH;
}

async function runSource(id, fn, { curated = false } = {}) {
  try {
    const events = await fn();
    return { id, ok: true, curated, count: events.length, events };
  } catch (err) {
    const skipped = !!err.skipped;
    return { id, ok: false, skipped, curated, count: 0, events: [], error: err.message || String(err) };
  }
}

async function main() {
  loadEnv();
  const args = new Set(process.argv.slice(2));
  const writeJson = !args.has("--no-json");
  const writeDb = !args.has("--no-db");
  const noLive = args.has("--no-live");

  const sourceResults = [];
  if (!noLive) {
    try {
      const n = await fetchElectronicSlcVenues();
      console.log("source electronicslc-venues: ok (" + n + " published addresses)");
    } catch (err) {
      console.log("source electronicslc-venues: FAIL — " + (err.message || err));
    }
    sourceResults.push(await runSource("electronicslc", fetchElectronicSlc));
    sourceResults.push(await runSource("residentadvisor", fetchResidentAdvisor));
    sourceResults.push(await runSource("deltacenter", fetchDeltaCenter));
    sourceResults.push(await runSource("complex-aeg", fetchComplexAeg));
    sourceResults.push(await runSource("ticketmaster", fetchTicketmaster));
  }
  const curated = await runSource("curated-json", loadCurated, { curated: true });
  sourceResults.push(curated);

  const events = mergeEvents(sourceResults.map((s) => ({ source: s.id, events: s.events || [] })));

  for (const s of sourceResults) {
    const flag = s.skipped ? "skipped" : (s.ok ? "ok" : "FAIL");
    console.log(`source ${s.id}: ${flag} (${s.count} events)${s.error ? " — " + s.error : ""}`);
  }
  console.log("eventbrite: skipped (no EVENTBRITE_API_KEY)");
  console.log("dice: skipped (no public API key)");
  const raves = events.filter((e) => e.category === "rave").length;
  const concerts = events.filter((e) => e.category === "concert").length;
  console.log(`merged ${events.length} upcoming events (${raves} raves, ${concerts} concerts)`);

  if (writeJson) {
    const p = writeSnapshot(events, sourceResults);
    console.log("wrote " + p);
  }
  if (writeDb) {
    if (!process.env.DATABASE_URL) {
      // Local sqlite via db.open() is fine when DATABASE_URL is unset.
      console.log("DATABASE_URL not set; using local SQLite from src/db.js");
    }
    const result = await upsertDatabase(events, sourceResults);
    console.log(`database upserted ${result.upserted}, marked removed ${result.removed}, sets ${result.setsUpserted || 0}`);
  }
}

main().catch((err) => {
  console.error("import-events failed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
