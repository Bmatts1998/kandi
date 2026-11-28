"use strict";

const { contentRejected } = require("./content-filter");
const { isAdminUser } = require("./verification");
const { isAdult, resolveEvent, truthy } = require("./meetup");
const { eventKey } = require("./event-key");
const { eventIsListed } = require("./event-end");

const TZ = "America/Denver";
const MAX_ARTIST = 80;
const MAX_STAGE = 60;

function hideSetsOf(user) {
  return user && Number(user.hide_sets) === 1;
}

function publicHideSets(user) {
  return hideSetsOf(user);
}

function clip(val, max) {
  return String(val == null ? "" : val).trim().slice(0, max);
}

function normalizeArtist(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function importKey(artist, stage, startsAt) {
  return [normalizeArtist(artist), String(stage || "").trim().toLowerCase(), String(startsAt || "").trim()].join("|");
}

function parseTime12(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(h) || h > 23 || min > 59) return null;
  const ap = m[3] ? m[3].toLowerCase().startsWith("p") : null;
  const am = m[3] ? m[3].toLowerCase().startsWith("a") : null;
  if (ap && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return { h, min };
}

function denverOffsetForDate(year, month, day, hour) {
  function nthWeekday(y, mo, weekday, n) {
    const d = new Date(Date.UTC(y, mo - 1, 1));
    const first = d.getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const dstStart = nthWeekday(year, 3, 0, 2);
  const dstEnd = nthWeekday(year, 11, 0, 1);
  const mins = month * 10000 + day * 100 + hour;
  const start = 3 * 10000 + dstStart * 100 + 2;
  const end = 11 * 10000 + dstEnd * 100 + 2;
  return mins >= start && mins < end ? "-06:00" : "-07:00";
}

function eventDayParts(startsAt) {
  if (!startsAt) return null;
  try {
    const d = new Date(startsAt);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const get = (t) => Number((parts.find((p) => p.type === t) || {}).value);
    return { y: get("year"), mo: get("month"), d: get("day") };
  } catch {
    const m = String(startsAt).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
  }
}

function toIsoInDenver(ymd, time, lateNight) {
  if (!ymd || !time) return "";
  let { y, mo, d } = ymd;
  let h = time.h;
  let day = d;
  // Club sets after midnight belong to the next calendar day when marked late, or when hour < 6 and event started in the evening.
  if (lateNight && h < 12) {
    const dt = new Date(Date.UTC(y, mo - 1, d + 1));
    y = dt.getUTCFullYear();
    mo = dt.getUTCMonth() + 1;
    day = dt.getUTCDate();
  }
  const off = denverOffsetForDate(y, mo, day, h);
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(day)}T${pad(h)}:${pad(time.min)}:00${off}`;
}

function parseSetDateTime(raw, eventStartsAt) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : s;
  }
  const t = parseTime12(s);
  if (!t) return "";
  const ymd = eventDayParts(eventStartsAt);
  if (!ymd) return "";
  let eventHour = 20;
  try {
    const ev = new Date(eventStartsAt);
    if (!Number.isNaN(ev.getTime())) {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).formatToParts(ev);
      eventHour = Number((parts.find((p) => p.type === "hour") || {}).value) || 20;
    }
  } catch (_) {}
  const lateNight = t.h < 6 && eventHour >= 12;
  return toIsoInDenver(ymd, t, lateNight);
}

function formatSetTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: TZ,
    }).format(d);
  } catch {
    return "";
  }
}

function shortSetTime(iso) {
  const label = formatSetTime(iso);
  if (!label) return "";
  // "11:30 PM" stays; drop ":00" minutes for on-the-hour times? Keep minutes to match "11:30".
  return label;
}

function sharedSetBadge(set) {
  if (!set || !set.artist) return "";
  const time = shortSetTime(set.startsAt || set.starts_at);
  return time
    ? "You both are catching " + set.artist + " at " + time
    : "You both are catching " + set.artist;
}

function compactSet(row, extra) {
  if (!row) return null;
  return {
    id: Number(row.id),
    eventId: row.event_id,
    artist: row.artist,
    stage: row.stage || "",
    startsAt: row.starts_at || "",
    endsAt: row.ends_at || "",
    startLabel: formatSetTime(row.starts_at),
    endLabel: formatSetTime(row.ends_at),
    status: row.status || "approved",
    source: row.source || "",
    sortOrder: Number(row.sort_order) || 0,
    ...(extra || {}),
  };
}

function sortSets(a, b) {
  const ta = a.starts_at || a.startsAt || "";
  const tb = b.starts_at || b.startsAt || "";
  if (ta && tb && ta !== tb) return String(ta).localeCompare(String(tb));
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  const sa = a.stage || "";
  const sb = b.stage || "";
  if (sa !== sb) return sa.localeCompare(sb);
  const oa = Number(a.sort_order != null ? a.sort_order : a.sortOrder) || 0;
  const ob = Number(b.sort_order != null ? b.sort_order : b.sortOrder) || 0;
  if (oa !== ob) return oa - ob;
  return String(a.artist || "").localeCompare(String(b.artist || ""));
}

function validateSetFields({ artist, stage, startsAt, endsAt, eventStartsAt }) {
  const name = clip(artist, MAX_ARTIST);
  if (!name) return { error: "Add the artist or set name." };
  const rejected = contentRejected(name) || contentRejected(stage);
  if (rejected) return { error: rejected };
  return {
    artist: name,
    stage: clip(stage, MAX_STAGE),
    startsAt: parseSetDateTime(startsAt, eventStartsAt) || (startsAt && /^\d{4}-\d{2}-\d{2}T/.test(String(startsAt)) ? String(startsAt).trim() : ""),
    endsAt: parseSetDateTime(endsAt, eventStartsAt) || (endsAt && /^\d{4}-\d{2}-\d{2}T/.test(String(endsAt)) ? String(endsAt).trim() : ""),
  };
}

/**
 * Turn source payload (artists list, timetable, or text) into a simple or timed lineup.
 * Club nights with only artist names become a simple lineup (no stage, often no times).
 */
function lineupFromSource(ev, raw) {
  const fromRaw = extractTimedLineup(raw, ev);
  if (fromRaw.length) return fromRaw;
  if (Array.isArray(ev && ev.lineup) && ev.lineup.length) {
    return ev.lineup.map((s, i) => normalizeIncomingSet(s, ev, i)).filter(Boolean);
  }
  return lineupFromArtists(ev);
}

function normalizeIncomingSet(s, ev, i) {
  if (!s) return null;
  const artist = clip(s.artist || s.name || s.title || "", MAX_ARTIST);
  if (!artist) return null;
  const stage = clip(s.stage || s.area || s.venue || "", MAX_STAGE);
  const startsAt = parseSetDateTime(s.startsAt || s.starts_at || s.startTime || s.start || "", ev && ev.startsAt) || "";
  const endsAt = parseSetDateTime(s.endsAt || s.ends_at || s.endTime || s.end || "", ev && ev.startsAt) || "";
  return {
    artist,
    stage,
    startsAt,
    endsAt,
    importKey: importKey(artist, stage, startsAt),
    sortOrder: s.sortOrder != null ? Number(s.sortOrder) : i,
  };
}

function lineupFromArtists(ev) {
  const artists = uniqueArtists(ev && ev.artists);
  if (!artists.length) return [];
  const single = artists.length === 1;
  const timed = single && ev.startsAt && !ev.timeTba && !ev.dateOnly;
  return artists.map((artist, i) => {
    const startsAt = timed ? ev.startsAt : "";
    const endsAt = timed ? (ev.endsAt || "") : "";
    return {
      artist,
      stage: "",
      startsAt,
      endsAt,
      importKey: importKey(artist, "", startsAt),
      sortOrder: i,
    };
  });
}

function uniqueArtists(list) {
  const out = [];
  const seen = new Set();
  for (const a of list || []) {
    const name = clip(typeof a === "string" ? a : (a && (a.name || a.title)), MAX_ARTIST);
    const key = normalizeArtist(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function extractTimedLineup(raw, ev) {
  const out = [];
  if (!raw) return out;
  const timetable = raw.timetable || raw.lineup || raw.sets || raw.schedule;
  const rows = Array.isArray(timetable)
    ? timetable
    : (timetable && (timetable.data || timetable.edges || timetable.nodes)) || [];
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    let node = list[i];
    if (node && node.node) node = node.node;
    if (node && node.event) node = node.event;
    const artists = uniqueArtists(node.artists || node.performers || [node.artist || node.title || node.name]);
    const stage = clip(node.stage || (node.area && node.area.name) || (node.venue && node.venue.name) || "", MAX_STAGE);
    const startsAt = parseSetDateTime(node.startTime || node.startsAt || node.start || node.starts_at, ev && ev.startsAt);
    const endsAt = parseSetDateTime(node.endTime || node.endsAt || node.end || node.ends_at, ev && ev.startsAt);
    for (const artist of artists) {
      out.push({
        artist,
        stage,
        startsAt: startsAt || "",
        endsAt: endsAt || "",
        importKey: importKey(artist, stage, startsAt || ""),
        sortOrder: out.length,
      });
    }
  }
  if (out.length) return out;
  const text = raw.lineupText || raw.description || raw.bio || "";
  return parseLineupText(text, ev);
}

function parseLineupText(text, ev) {
  const out = [];
  const blob = String(text || "");
  if (!blob.trim()) return out;
  const re = /(?:^|\n)\s*([A-Za-z0-9][A-Za-z0-9 .'\u2019\-&/+]{1,60}?)\s+(?:[-–—:@]?\s*)(\d{1,2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?)\s*(?:[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?))?/gm;
  let m;
  while ((m = re.exec(blob))) {
    const artist = clip(m[1].replace(/\s+/g, " "), MAX_ARTIST);
    if (!artist || /^(doors|start|end|stage|lineup|set times?)$/i.test(artist)) continue;
    const startsAt = parseSetDateTime(m[2], ev && ev.startsAt) || "";
    const endsAt = parseSetDateTime(m[3], ev && ev.startsAt) || "";
    out.push({
      artist,
      stage: "",
      startsAt,
      endsAt,
      importKey: importKey(artist, "", startsAt),
      sortOrder: out.length,
    });
  }
  return out;
}

async function isGoingTo(db, userId, ev) {
  const key = ev.event_key || ev.eventKey || eventKey(ev);
  const row = await db.prepare(`SELECT user_id FROM event_going WHERE user_id=? AND (event_id=? OR event_key=?)`).get(userId, ev.id, key);
  return Boolean(row);
}

async function clearCatchingForEvent(db, userId, ev) {
  if (!ev || !ev.id) return;
  const key = ev.event_key || ev.eventKey || "";
  await db.prepare(`
    DELETE FROM sets_catching
    WHERE user_id=? AND set_id IN (
      SELECT s.id FROM sets_lineup s
      JOIN events e ON e.id=s.event_id
      WHERE e.id=? OR (? != '' AND e.event_key=?)
    )
  `).run(userId, ev.id, key, key);
}

async function syncImportedSets(db, events) {
  if (!events || !events.length) return { upserted: 0 };
  let upserted = 0;
  for (const ev of events) {
    if (!ev || !ev.id) continue;
    const lineup = lineupFromSource(ev, ev.raw || ev.sourcePayload);
    if (!lineup.length) continue;
    const existing = await db.prepare(`SELECT * FROM sets_lineup WHERE event_id=?`).all(ev.id);
    const byKey = new Map();
    const byArtist = new Map();
    for (const row of existing) {
      if (row.import_key) byKey.set(String(row.import_key), row);
      const nk = normalizeArtist(row.artist);
      if (!byArtist.has(nk)) byArtist.set(nk, []);
      byArtist.get(nk).push(row);
    }
    let order = existing.length;
    for (const item of lineup) {
      const key = item.importKey || importKey(item.artist, item.stage, item.startsAt);
      let row = byKey.get(key);
      if (!row) {
        const cands = byArtist.get(normalizeArtist(item.artist)) || [];
        row = cands.find((r) => !r.import_key || r.source === "import") || null;
      }
      if (row) {
        if (row.source === "import" && row.status === "approved") {
          await db.prepare(`
            UPDATE sets_lineup SET artist=?, stage=?, starts_at=?, ends_at=?, import_key=?, updated_at=datetime('now')
            WHERE id=?
          `).run(item.artist, item.stage || "", item.startsAt || "", item.endsAt || "", key, row.id);
          upserted += 1;
        }
        continue;
      }
      await db.prepare(`
        INSERT INTO sets_lineup (event_id, artist, stage, starts_at, ends_at, status, source, import_key, sort_order)
        VALUES (?,?,?,?,?,'approved','import',?,?)
      `).run(ev.id, item.artist, item.stage || "", item.startsAt || "", item.endsAt || "", key, item.sortOrder != null ? item.sortOrder : order);
      order += 1;
      upserted += 1;
    }
  }
  return { upserted };
}

function firstAvatarUrl(user) {
  let photos = user && user.photos;
  if (typeof photos === "string") {
    try { photos = JSON.parse(photos); } catch { photos = []; }
  }
  const list = Array.isArray(photos) ? photos : [];
  const first = list.find((p) => p && p.type !== "video") || list[0];
  if (!first) return "";
  return first.url || first.id || "";
}

function catcherCard(user, relation, publicUser) {
  const base = publicUser
    ? publicUser(user, { relation })
    : { id: Number(user.id), name: user.name, username: user.username, photos: user.photos };
  return {
    id: Number(base.id),
    name: base.name,
    username: base.username,
    photos: base.photos,
    media: base.media,
    age: base.age,
    relation,
    avatar: firstAvatarUrl(user),
  };
}

async function relationMaps(db, viewerId) {
  const matches = await db.prepare(`SELECT a_id, b_id, match_kind FROM matches WHERE a_id=? OR b_id=?`).all(viewerId, viewerId);
  const matchIds = new Set();
  const friendMatchIds = new Set();
  for (const m of matches) {
    const other = Number(m.a_id) === Number(viewerId) ? Number(m.b_id) : Number(m.a_id);
    matchIds.add(other);
    if (String(m.match_kind || "") === "friend") friendMatchIds.add(other);
  }
  const follows = await db.prepare(`
    SELECT f.following_id AS id
    FROM follows f
    JOIN follows b ON b.follower_id=f.following_id AND b.following_id=f.follower_id
    WHERE f.follower_id=?
  `).all(viewerId);
  const friendIds = new Set(follows.map((r) => Number(r.id)).concat([...friendMatchIds]));
  return { matchIds, friendIds };
}

function relationFor(uid, maps) {
  if (maps.matchIds.has(uid)) return maps.friendIds.has(uid) && !maps.matchIds.has(uid) ? "friend" : (maps.friendIds.has(uid) && String() === "x" ? "friend" : "match");
  if (maps.friendIds.has(uid)) return "friend";
  return "discover";
}

// Prefer match, then friend, then discover-eligible.
function relationForViewer(uid, maps) {
  if (maps.matchIds.has(Number(uid))) return "match";
  if (maps.friendIds.has(Number(uid))) return "friend";
  return "discover";
}

async function loadEventSets(db, ev, viewer, extras) {
  const { blocked, publicUser, visibleInMode, mode, liked, passed } = extras || {};
  const blockedSet = blocked || new Set();
  const rows = await db.prepare(`SELECT * FROM sets_lineup WHERE event_id=?`).all(ev.id);
  const approved = rows.filter((r) => r.status === "approved").sort(sortSets);
  const pending = rows.filter((r) => r.status === "pending").sort(sortSets);
  if (!approved.length && !(extras && extras.includePending)) {
    return { sets: [], pending: isAdminUser(viewer) ? pending.map((r) => compactSet(r)) : [] };
  }
  const ids = approved.map((r) => r.id);
  let catchingRows = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    catchingRows = await db.prepare(`
      SELECT c.set_id, c.user_id, u.*
      FROM sets_catching c
      JOIN users u ON u.id=c.user_id
      WHERE c.set_id IN (${placeholders})
    `).all(...ids);
  }
  const maps = await relationMaps(db, viewer.id);
  const bySet = new Map();
  for (const row of catchingRows) {
    const sid = Number(row.set_id);
    if (!bySet.has(sid)) bySet.set(sid, []);
    bySet.get(sid).push(row);
  }
  const mineGoing = extras && extras.imGoing != null ? extras.imGoing : await isGoingTo(db, viewer.id, ev);
  const sets = approved.map((row) => {
    const people = bySet.get(Number(row.id)) || [];
    const visible = [];
    let imCatching = false;
    for (const u of people) {
      if (Number(u.id) === Number(viewer.id)) {
        imCatching = true;
        continue;
      }
      if (!isAdult(u)) continue;
      if (blockedSet.has(Number(u.id))) continue;
      if (hideSetsOf(u)) continue;
      const rel = relationForViewer(u.id, maps);
      if (rel === "discover") {
        if (liked && liked.has(Number(u.id))) continue;
        if (passed && passed.has(Number(u.id))) continue;
        if (maps.matchIds.has(Number(u.id))) { /* already match */ }
        if (visibleInMode && mode && !visibleInMode(viewer, u, mode)) continue;
      }
      visible.push(catcherCard(u, rel, publicUser));
    }
    visible.sort((a, b) => {
      const order = { match: 0, friend: 1, discover: 2 };
      return (order[a.relation] || 9) - (order[b.relation] || 9);
    });
    return compactSet(row, {
      imCatching,
      catchingCount: visible.length + (imCatching ? 1 : 0),
      catchers: visible.slice(0, 8),
    });
  });
  return {
    sets,
    pending: isAdminUser(viewer) ? pending.map((r) => compactSet(r, {
      suggestedBy: r.suggested_by,
    })) : [],
    imGoing: mineGoing,
    hideSets: hideSetsOf(viewer),
  };
}

async function attachSetsToEvents(db, events, viewer, extras) {
  if (!events || !events.length) return events;
  const ids = events.map((e) => e.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.prepare(`SELECT * FROM sets_lineup WHERE event_id IN (${placeholders}) AND status='approved'`).all(...ids);
  if (!rows.length) {
    for (const ev of events) ev.sets = ev.sets || [];
    return events;
  }
  const byEvent = new Map();
  for (const row of rows) {
    if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, []);
    byEvent.get(row.event_id).push(row);
  }
  const setIds = rows.map((r) => r.id);
  const cPlace = setIds.map(() => "?").join(",");
  const catchingRows = await db.prepare(`
    SELECT c.set_id, c.user_id, s.event_id, u.id, u.name, u.username, u.photos, u.age, u.hide_sets, u.meet_intent, u.interested_in
    FROM sets_catching c
    JOIN sets_lineup s ON s.id=c.set_id
    JOIN users u ON u.id=c.user_id
    WHERE c.set_id IN (${cPlace})
  `).all(...setIds);
  const blocked = (extras && extras.blocked) || new Set();
  const maps = await relationMaps(db, viewer.id);
  const publicUser = extras && extras.publicUser;
  const catchBySet = new Map();
  for (const row of catchingRows) {
    const sid = Number(row.set_id);
    if (!catchBySet.has(sid)) catchBySet.set(sid, []);
    catchBySet.get(sid).push(row);
  }
  for (const ev of events) {
    const list = (byEvent.get(ev.id) || []).slice().sort(sortSets);
    ev.sets = list.map((row) => {
      const people = catchBySet.get(Number(row.id)) || [];
      const visible = [];
      let imCatching = false;
      for (const u of people) {
        if (Number(u.id) === Number(viewer.id)) { imCatching = true; continue; }
        if (!isAdult(u) || blocked.has(Number(u.id)) || hideSetsOf(u)) continue;
        visible.push(catcherCard(u, relationForViewer(u.id, maps), publicUser));
      }
      visible.sort((a, b) => {
        const order = { match: 0, friend: 1, discover: 2 };
        return (order[a.relation] || 9) - (order[b.relation] || 9);
      });
      return compactSet(row, {
        imCatching,
        catchingCount: visible.length + (imCatching ? 1 : 0),
        catchers: visible.slice(0, 5),
      });
    });
    ev.setsCount = ev.sets.length;
  }
  return events;
}

async function catchingSetIdsForUser(db, userId, { approvedOnly = true } = {}) {
  const sql = approvedOnly
    ? `SELECT c.set_id AS id, s.event_id, s.artist, s.stage, s.starts_at, s.ends_at, s.status
       FROM sets_catching c JOIN sets_lineup s ON s.id=c.set_id
       WHERE c.user_id=? AND s.status='approved'`
    : `SELECT c.set_id AS id, s.event_id, s.artist, s.stage, s.starts_at, s.ends_at, s.status
       FROM sets_catching c JOIN sets_lineup s ON s.id=c.set_id
       WHERE c.user_id=?`;
  return db.prepare(sql).all(userId);
}

function pickSharedSet(mine, theirs) {
  const theirIds = new Set(theirs.map((s) => Number(s.id)));
  const shared = mine.filter((s) => theirIds.has(Number(s.id))).slice().sort(sortSets);
  return shared[0] || null;
}

async function listedEventIds(db, ids) {
  const unique = Array.from(new Set((ids || []).map((id) => String(id || "")).filter(Boolean)));
  if (!unique.length) return new Set();
  const rows = await db.prepare(`SELECT * FROM events WHERE id IN (${unique.map(() => "?").join(",")})`).all(...unique);
  const now = Date.now();
  return new Set(rows.filter((e) => eventIsListed(e, now)).map((e) => String(e.id)));
}

async function attachDiscoverSets(db, viewer, people, opts) {
  const filter = String((opts && opts.setsFilter) || "all");
  const mineAll = await catchingSetIdsForUser(db, viewer.id);
  const filterEventId = filter !== "all" && filter !== "same" ? filter : "";
  if (filterEventId) {
    const filterLive = await listedEventIds(db, [filterEventId]);
    if (!filterLive.has(String(filterEventId))) {
      for (const p of people) {
        p.sharedSet = null;
        p.sharedSetChip = "";
        p.sharedSetsCount = 0;
      }
      return [];
    }
  }

  const ids = people.map((p) => Number(p.id));
  let theirsByUser = new Map();
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await db.prepare(`
      SELECT c.user_id, c.set_id AS id, s.event_id, s.artist, s.stage, s.starts_at, s.ends_at, u.hide_sets
      FROM sets_catching c
      JOIN sets_lineup s ON s.id=c.set_id
      JOIN users u ON u.id=c.user_id
      WHERE c.user_id IN (${placeholders}) AND s.status='approved'
    `).all(...ids);
    for (const row of rows) {
      const uid = Number(row.user_id);
      if (!theirsByUser.has(uid)) theirsByUser.set(uid, []);
      theirsByUser.get(uid).push(row);
    }
  }

  const eventIds = mineAll.map((s) => s.event_id);
  for (const list of theirsByUser.values()) {
    for (const row of list) eventIds.push(row.event_id);
  }
  const liveIds = await listedEventIds(db, eventIds);
  const mine = mineAll.filter((s) => liveIds.has(String(s.event_id)));
  const myIds = new Set(mine.map((s) => Number(s.id)));
  const scopedMine = filterEventId ? mine.filter((s) => String(s.event_id) === String(filterEventId)) : mine;
  const scopedIds = new Set(scopedMine.map((s) => Number(s.id)));

  const out = [];
  for (const p of people) {
    const hidden = hideSetsOf({ hide_sets: p.hideSets || p.hide_sets }) || (theirsByUser.get(Number(p.id)) || []).some((r) => Number(r.hide_sets) === 1);
    // If they hid sets, treat as no shared sets for others.
    const theirs = hidden ? [] : (theirsByUser.get(Number(p.id)) || []).filter((s) => liveIds.has(String(s.event_id)));
    const sharedRow = pickSharedSet(scopedMine.length ? scopedMine : mine, theirs);
    const badge = sharedRow ? sharedSetBadge(compactSet(sharedRow)) : "";
    p.sharedSet = sharedRow ? compactSet(sharedRow) : null;
    p.sharedSetChip = badge;
    p.sharedSetsCount = theirs.filter((s) => myIds.has(Number(s.id))).length;
    if (filter === "all") {
      out.push(p);
      continue;
    }
    const pool = filterEventId ? theirs.filter((s) => String(s.event_id) === String(filterEventId)) : theirs;
    const hit = pool.some((s) => scopedIds.has(Number(s.id)) || myIds.has(Number(s.id)));
    if (hit) out.push(p);
  }
  return out;
}

async function attachMatchSets(db, viewerId, otherId, otherUser) {
  if (otherUser && hideSetsOf(otherUser)) return { sharedSet: null, sharedSetChip: "" };
  const viewer = await db.prepare(`SELECT hide_sets FROM users WHERE id=?`).get(viewerId);
  const mineAll = await catchingSetIdsForUser(db, viewerId);
  const theirsAll = await catchingSetIdsForUser(db, otherId);
  const liveIds = await listedEventIds(db, mineAll.map((s) => s.event_id).concat(theirsAll.map((s) => s.event_id)));
  const mine = mineAll.filter((s) => liveIds.has(String(s.event_id)));
  const theirs = theirsAll.filter((s) => liveIds.has(String(s.event_id)));
  const sharedRow = pickSharedSet(mine, theirs);
  return {
    sharedSet: sharedRow ? compactSet(sharedRow) : null,
    sharedSetChip: sharedRow ? sharedSetBadge(compactSet(sharedRow)) : "",
    viewerHidesSets: hideSetsOf(viewer),
  };
}

async function seedDemoSets(db) {
  const demos = await db.prepare(`SELECT id, username FROM users WHERE is_demo=1`).all();
  if (!demos.length) return { created: false };
  const clubId = "sets-demo-club";
  const festId = "sets-demo-fest";
  const clubStart = "2027-03-20T22:00:00-06:00";
  const festStart = "2027-06-12T14:00:00-06:00";
  const style = { emoji: "🎧", color: "linear-gradient(160deg,#1a0a00,#ff5c00 55%,#ffc14d)" };
  const existingClub = await db.prepare(`SELECT id FROM events WHERE id=?`).get(clubId);
  if (!existingClub) {
    await db.prepare(`
      INSERT INTO events (id, event_key, name, city, date_label, venue, genres, emoji, color, is_example, category, artists, starts_at, ends_at, status, address, time_tba, source)
      VALUES (?,?,?,?,?,?,?,?,?,0,'rave',?,?,?,'active',?,0,'demo')
    `).run(
      clubId, eventKey({ name: "Yheti", venue: "The Complex", startsAt: clubStart }),
      "Yheti", "Salt Lake City", "Sat, Mar 20, 2027 · 10:00 PM", "The Complex",
      JSON.stringify(["bass", "dubstep"]), style.emoji, style.color,
      JSON.stringify(["Yheti", "Toadface", "Abelation"]),
      clubStart, "2027-03-21T02:00:00-06:00", "536 W 100 S, Salt Lake City, UT 84101"
    );
  }
  const existingFest = await db.prepare(`SELECT id FROM events WHERE id=?`).get(festId);
  if (!existingFest) {
    await db.prepare(`
      INSERT INTO events (id, event_key, name, city, date_label, venue, genres, emoji, color, is_example, category, artists, starts_at, ends_at, status, address, time_tba, source)
      VALUES (?,?,?,?,?,?,?,?,?,0,'rave',?,?,?,'active',?,0,'demo')
    `).run(
      festId, eventKey({ name: "Desert Lights", venue: "The Complex", startsAt: festStart }),
      "Desert Lights", "Salt Lake City", "Sat, Jun 12, 2027 · 2:00 PM", "Utah State Fairpark",
      JSON.stringify(["bass", "house", "techno"]), style.emoji, style.color,
      JSON.stringify(["LSDream", "John Summit", "CloZee", "Sara Landry"]),
      festStart, "2027-06-13T01:00:00-06:00", "155 N 1000 W, Salt Lake City, UT 84116"
    );
  }

  const clubSets = [
    { artist: "Abelation", stage: "", startsAt: "2027-03-20T22:00:00-06:00", endsAt: "2027-03-20T23:00:00-06:00" },
    { artist: "Toadface", stage: "", startsAt: "2027-03-20T23:00:00-06:00", endsAt: "2027-03-21T00:30:00-06:00" },
    { artist: "Yheti", stage: "", startsAt: "2027-03-21T00:30:00-06:00", endsAt: "2027-03-21T02:00:00-06:00" },
  ];
  const festSets = [
    { artist: "CloZee", stage: "Canyon Stage", startsAt: "2027-06-12T16:00:00-06:00", endsAt: "2027-06-12T17:15:00-06:00" },
    { artist: "Sara Landry", stage: "Warehouse", startsAt: "2027-06-12T20:00:00-06:00", endsAt: "2027-06-12T21:30:00-06:00" },
    { artist: "John Summit", stage: "Main Stage", startsAt: "2027-06-12T21:30:00-06:00", endsAt: "2027-06-12T23:00:00-06:00" },
    { artist: "LSDream", stage: "Main Stage", startsAt: "2027-06-12T23:15:00-06:00", endsAt: "2027-06-13T00:45:00-06:00" },
  ];

  async function ensureSets(eventId, items) {
    const have = await db.prepare(`SELECT COUNT(*) AS c FROM sets_lineup WHERE event_id=? AND status='approved'`).get(eventId);
    if (have && Number(have.c) > 0) return;
    let i = 0;
    for (const s of items) {
      await db.prepare(`
        INSERT INTO sets_lineup (event_id, artist, stage, starts_at, ends_at, status, source, import_key, sort_order)
        VALUES (?,?,?,?,?,'approved','demo',?,?)
      `).run(eventId, s.artist, s.stage || "", s.startsAt, s.endsAt || "", importKey(s.artist, s.stage, s.startsAt), i++);
    }
  }
  await ensureSets(clubId, clubSets);
  await ensureSets(festId, festSets);

  const byName = new Map(demos.map((u) => [u.username, u.id]));
  const rsvps = [
    ["vesper", clubId], ["nova", clubId], ["luna", clubId], ["jade", clubId], ["ember", clubId],
    ["vesper", festId], ["sol", festId], ["hex", festId], ["riot", festId], ["orion", festId],
  ];
  const goingIns = db.prepare(`INSERT OR IGNORE INTO event_going (user_id, event_id, event_key) VALUES (?,?,?)`);
  for (const [uname, eid] of rsvps) {
    const uid = byName.get(uname);
    if (!uid) continue;
    const ev = await db.prepare(`SELECT id, event_key, name, venue, starts_at FROM events WHERE id=?`).get(eid);
    if (!ev) continue;
    await goingIns.run(uid, ev.id, ev.event_key || eventKey(ev));
  }

  const stars = [
    ["vesper", clubId, "Yheti"],
    ["nova", clubId, "Yheti"],
    ["luna", clubId, "Yheti"],
    ["jade", clubId, "Toadface"],
    ["vesper", clubId, "Toadface"],
    ["ember", clubId, "Yheti"],
    ["vesper", festId, "LSDream"],
    ["sol", festId, "LSDream"],
    ["hex", festId, "John Summit"],
    ["orion", festId, "Sara Landry"],
  ];
  for (const [uname, eid, artist] of stars) {
    const uid = byName.get(uname);
    if (!uid) continue;
    const set = await db.prepare(`SELECT id FROM sets_lineup WHERE event_id=? AND artist=? AND status='approved'`).get(eid, artist);
    if (!set) continue;
    await db.prepare(`INSERT OR IGNORE INTO sets_catching (user_id, set_id) VALUES (?,?)`).run(uid, set.id);
  }
  return { created: true };
}

function requireAdmin(req, res) {
  if (!isAdminUser(req.user)) {
    res.status(404).json({ error: "Not found." });
    return false;
  }
  return true;
}

function installSets({
  app, getDb, auth, publicUser, blockedSet,
  visibleInMode, resolveMode,
}) {
  const db = () => getDb();

  app.get("/api/events/:id/sets", auth, async (req, res) => {
    const ev = await resolveEvent(db(), req.params.id);
    if (!ev || ev.is_example || String(ev.status || "active") === "removed") {
      return res.status(404).json({ error: "Event not found." });
    }
    const blocked = await blockedSet(req.user.id);
    const payload = await loadEventSets(db(), ev, req.user, {
      blocked,
      publicUser,
      visibleInMode,
      mode: resolveMode ? resolveMode(req.user, req.query.mode) : "both",
    });
    res.json(payload);
  });

  app.post("/api/events/:id/sets", auth, async (req, res) => {
    if (!isAdult(req.user)) return res.status(403).json({ error: "Kandi is 18+ only." });
    const ev = await resolveEvent(db(), req.params.id);
    if (!ev || ev.is_example || String(ev.status || "active") === "removed") {
      return res.status(404).json({ error: "Event not found." });
    }
    const going = await isGoingTo(db(), req.user.id, ev);
    const admin = isAdminUser(req.user);
    if (!going && !admin) return res.status(403).json({ error: "Mark yourself as going before you add a set." });
    const fields = validateSetFields({
      artist: req.body && req.body.artist,
      stage: req.body && req.body.stage,
      startsAt: req.body && (req.body.startsAt || req.body.starts_at || req.body.start),
      endsAt: req.body && (req.body.endsAt || req.body.ends_at || req.body.end),
      eventStartsAt: ev.starts_at || ev.startsAt,
    });
    if (fields.error) return res.status(400).json({ error: fields.error });
    const status = admin ? "approved" : "pending";
    const source = admin ? "admin" : "suggest";
    const info = await db().prepare(`
      INSERT INTO sets_lineup (event_id, artist, stage, starts_at, ends_at, status, source, suggested_by, import_key, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      ev.id, fields.artist, fields.stage, fields.startsAt, fields.endsAt,
      status, source, req.user.id, importKey(fields.artist, fields.stage, fields.startsAt),
      Number(req.body && req.body.sortOrder) || 0
    );
    const row = await db().prepare(`SELECT * FROM sets_lineup WHERE id=?`).get(Number(info.lastInsertRowid));
    res.json({ ok: true, set: compactSet(row), pending: status === "pending" });
  });

  app.post("/api/sets/:id/catch", auth, async (req, res) => {
    if (!isAdult(req.user)) return res.status(403).json({ error: "Kandi is 18+ only." });
    const set = await db().prepare(`SELECT * FROM sets_lineup WHERE id=?`).get(Number(req.params.id));
    if (!set || set.status !== "approved") return res.status(404).json({ error: "Set not found." });
    const ev = await resolveEvent(db(), set.event_id);
    if (!ev) return res.status(404).json({ error: "Event not found." });
    const going = await isGoingTo(db(), req.user.id, ev);
    if (!going) return res.status(403).json({ error: "Mark yourself as going to star the sets you're catching." });
    const on = req.body && req.body.catching != null
      ? Boolean(req.body.catching)
      : !(await db().prepare(`SELECT user_id FROM sets_catching WHERE user_id=? AND set_id=?`).get(req.user.id, set.id));
    if (on) {
      await db().prepare(`INSERT OR IGNORE INTO sets_catching (user_id, set_id) VALUES (?,?)`).run(req.user.id, set.id);
    } else {
      await db().prepare(`DELETE FROM sets_catching WHERE user_id=? AND set_id=?`).run(req.user.id, set.id);
    }
    const blocked = await blockedSet(req.user.id);
    const payload = await loadEventSets(db(), ev, req.user, { blocked, publicUser, visibleInMode, mode: resolveMode ? resolveMode(req.user, req.body && req.body.mode) : "both" });
    const current = payload.sets.find((s) => Number(s.id) === Number(set.id));
    res.json({ ok: true, catching: on, set: current, sets: payload.sets });
  });

  app.put("/api/me/sets-privacy", auth, async (req, res) => {
    const hide = Boolean(req.body && (req.body.hideSets ?? req.body.hide_sets));
    await db().prepare(`UPDATE users SET hide_sets=? WHERE id=?`).run(hide ? 1 : 0, req.user.id);
    const user = await db().prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
    res.json({ ok: true, hideSets: hideSetsOf(user) });
  });

  app.get("/api/admin/sets", auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const status = String(req.query.status || "pending");
    const eventId = String(req.query.eventId || req.query.event || "");
    let rows;
    if (eventId) {
      const ev = await resolveEvent(db(), eventId);
      if (!ev) return res.status(404).json({ error: "Event not found." });
      rows = await db().prepare(`
        SELECT s.*, u.username AS suggested_username, u.name AS suggested_name, e.name AS event_name, e.venue, e.starts_at AS event_starts_at, e.date_label
        FROM sets_lineup s
        JOIN events e ON e.id=s.event_id
        LEFT JOIN users u ON u.id=s.suggested_by
        WHERE s.event_id=? ${status !== "all" ? "AND s.status=?" : ""}
        ORDER BY s.starts_at, s.sort_order, s.id
      `).all(...(status !== "all" ? [ev.id, status] : [ev.id]));
    } else if (status === "all") {
      rows = await db().prepare(`
        SELECT s.*, u.username AS suggested_username, u.name AS suggested_name, e.name AS event_name, e.venue, e.starts_at AS event_starts_at, e.date_label
        FROM sets_lineup s
        JOIN events e ON e.id=s.event_id
        LEFT JOIN users u ON u.id=s.suggested_by
        WHERE COALESCE(e.status,'active')='active'
        ORDER BY e.starts_at, s.starts_at, s.sort_order, s.id
      `).all();
    } else {
      rows = await db().prepare(`
        SELECT s.*, u.username AS suggested_username, u.name AS suggested_name, e.name AS event_name, e.venue, e.starts_at AS event_starts_at, e.date_label
        FROM sets_lineup s
        JOIN events e ON e.id=s.event_id
        LEFT JOIN users u ON u.id=s.suggested_by
        WHERE s.status=?
        ORDER BY s.created_at DESC, s.id DESC
      `).all(status);
    }
    res.json({
      sets: rows.map((r) => compactSet(r, {
        eventName: r.event_name,
        eventVenue: r.venue,
        eventDate: r.date_label,
        suggestedBy: r.suggested_by ? { id: Number(r.suggested_by), username: r.suggested_username, name: r.suggested_name } : null,
      })),
    });
  });

  app.post("/api/admin/events/:eventId/sets", auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const ev = await resolveEvent(db(), req.params.eventId);
    if (!ev) return res.status(404).json({ error: "Event not found." });
    const fields = validateSetFields({
      artist: req.body && req.body.artist,
      stage: req.body && req.body.stage,
      startsAt: req.body && (req.body.startsAt || req.body.starts_at || req.body.start),
      endsAt: req.body && (req.body.endsAt || req.body.ends_at || req.body.end),
      eventStartsAt: ev.starts_at || ev.startsAt,
    });
    if (fields.error) return res.status(400).json({ error: fields.error });
    const info = await db().prepare(`
      INSERT INTO sets_lineup (event_id, artist, stage, starts_at, ends_at, status, source, suggested_by, import_key, sort_order)
      VALUES (?,?,?,?,?,'approved','admin',?,?,?)
    `).run(ev.id, fields.artist, fields.stage, fields.startsAt, fields.endsAt, req.user.id, importKey(fields.artist, fields.stage, fields.startsAt), Number(req.body && req.body.sortOrder) || 0);
    const row = await db().prepare(`SELECT * FROM sets_lineup WHERE id=?`).get(Number(info.lastInsertRowid));
    res.json({ ok: true, set: compactSet(row) });
  });

  app.put("/api/admin/sets/:id", auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const row = await db().prepare(`SELECT * FROM sets_lineup WHERE id=?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Set not found." });
    const ev = await resolveEvent(db(), row.event_id);
    const fields = validateSetFields({
      artist: req.body && req.body.artist != null ? req.body.artist : row.artist,
      stage: req.body && req.body.stage != null ? req.body.stage : row.stage,
      startsAt: req.body && (req.body.startsAt || req.body.starts_at || req.body.start) != null
        ? (req.body.startsAt || req.body.starts_at || req.body.start)
        : row.starts_at,
      endsAt: req.body && (req.body.endsAt || req.body.ends_at || req.body.end) != null
        ? (req.body.endsAt || req.body.ends_at || req.body.end)
        : row.ends_at,
      eventStartsAt: ev && (ev.starts_at || ev.startsAt),
    });
    if (fields.error) return res.status(400).json({ error: fields.error });
    const sortOrder = req.body && req.body.sortOrder != null ? Number(req.body.sortOrder) : row.sort_order;
    await db().prepare(`
      UPDATE sets_lineup SET artist=?, stage=?, starts_at=?, ends_at=?, sort_order=?, source=CASE WHEN source='import' THEN 'admin' ELSE source END, import_key=?, updated_at=datetime('now')
      WHERE id=?
    `).run(fields.artist, fields.stage, fields.startsAt, fields.endsAt, sortOrder, importKey(fields.artist, fields.stage, fields.startsAt), row.id);
    const next = await db().prepare(`SELECT * FROM sets_lineup WHERE id=?`).get(row.id);
    res.json({ ok: true, set: compactSet(next) });
  });

  app.post("/api/admin/sets/:id/review", auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const row = await db().prepare(`SELECT * FROM sets_lineup WHERE id=?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Set not found." });
    const decision = String((req.body && (req.body.decision || req.body.status)) || "").toLowerCase();
    if (decision !== "approve" && decision !== "approved" && decision !== "reject" && decision !== "rejected") {
      return res.status(400).json({ error: "Approve or reject this set." });
    }
    const status = decision.startsWith("approve") ? "approved" : "rejected";
    await db().prepare(`UPDATE sets_lineup SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, row.id);
    if (status === "rejected") {
      await db().prepare(`DELETE FROM sets_catching WHERE set_id=?`).run(row.id);
    }
    const next = await db().prepare(`SELECT * FROM sets_lineup WHERE id=?`).get(row.id);
    res.json({ ok: true, set: compactSet(next) });
  });

  app.delete("/api/admin/sets/:id", auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const row = await db().prepare(`SELECT * FROM sets_lineup WHERE id=?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Set not found." });
    await db().prepare(`DELETE FROM sets_catching WHERE set_id=?`).run(row.id);
    await db().prepare(`DELETE FROM sets_lineup WHERE id=?`).run(row.id);
    res.json({ ok: true });
  });
}

module.exports = {
  installSets,
  seedDemoSets,
  syncImportedSets,
  lineupFromSource,
  lineupFromArtists,
  parseLineupText,
  parseSetDateTime,
  formatSetTime,
  sharedSetBadge,
  attachDiscoverSets,
  attachMatchSets,
  attachSetsToEvents,
  clearCatchingForEvent,
  loadEventSets,
  hideSetsOf,
  publicHideSets,
  importKey,
  TZ,
};
