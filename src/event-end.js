"use strict";

// When a show is "over" and should disappear from user-facing lists.
// America/Denver throughout, matching Find My Crew's 6 AM MT day boundary.
//
// Rule:
//   1. If ends_at is a real clock time, the show is over at that instant.
//   2. If ends_at is a date only (YYYY-MM-DD), it's over at 6 AM Mountain
//      the morning after that date (last day of a fest stays up all night).
//   3. If there is no ends_at:
//        - Time TBA / date-only start (including 11:59 PM placeholders):
//          over at 6 AM Mountain the morning after the start date.
//        - Otherwise (club / concert with a start time): start + 8 hours.
//   4. If there is no start or end time, keep the show listed.
//
// Data is never deleted. Admin tools can still load past shows (isPast).

const TZ = "America/Denver";
const HOUR = 3600 * 1000;
const CLUB_DEFAULT_HOURS = 8;

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function tzParts(ms) {
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}

function tzOffset(ms) {
  const p = tzParts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - (Math.floor(ms / 1000) * 1000);
}

// Wall-clock time in Denver -> epoch ms. Day overflow (d+1) is normalized by Date.UTC.
function zoned(y, m, d, h, mi, s) {
  const guess = Date.UTC(y, m - 1, d, h || 0, mi || 0, s || 0);
  const off = tzOffset(guess);
  let t = guess - off;
  const off2 = tzOffset(t);
  if (off2 !== off) t = guess - off2;
  return t;
}

function nextSixAm(ms) {
  const p = tzParts(ms);
  let t = zoned(p.y, p.m, p.d, 6);
  if (t <= ms) t = zoned(p.y, p.m, p.d + 1, 6);
  return t;
}

// 6 AM Mountain the morning after this Denver calendar date.
function sixAmAfterDate(y, m, d) {
  return zoned(y, m, d + 1, 6);
}

function sixAmAfterInstant(ms) {
  const p = tzParts(ms);
  return sixAmAfterDate(p.y, p.m, p.d);
}

function dateOnlyMatch(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

function parseEventTime(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { ms: NaN, dateOnly: false };
  const day = dateOnlyMatch(s);
  if (day) return { ms: zoned(day.y, day.m, day.d, 0), dateOnly: true };
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return { ms: NaN, dateOnly: false };
  const p = tzParts(t);
  // Importers use 11:59 PM on the start date when the clock time is TBA.
  const dateOnly = p.h === 23 && p.mi === 59 && p.s === 0;
  return { ms: t, dateOnly };
}

function isTimeTba(ev) {
  if (!ev) return false;
  const v = ev.time_tba != null ? ev.time_tba : ev.timeTba;
  return v === true || v === 1 || v === "1" || Number(v) === 1 || ev.dateOnly === true;
}

function eventOverAt(ev) {
  if (!ev) return null;
  const startRaw = ev.starts_at != null && ev.starts_at !== "" ? ev.starts_at : ev.startsAt;
  const endRaw = ev.ends_at != null && ev.ends_at !== "" ? ev.ends_at : ev.endsAt;
  const start = parseEventTime(startRaw);
  const end = parseEventTime(endRaw);

  if (Number.isFinite(end.ms)) {
    let endMs = end.ms;
    // "10 PM – 2 AM" often stores 2 AM on the start date; roll that to the next morning.
    if (Number.isFinite(start.ms) && endMs < start.ms && !end.dateOnly && endMs + 24 * HOUR > start.ms) {
      endMs = endMs + 24 * HOUR;
    }
    if (end.dateOnly) return sixAmAfterInstant(endMs);
    return endMs;
  }

  if (!Number.isFinite(start.ms)) return null;
  if (isTimeTba(ev) || start.dateOnly) return sixAmAfterInstant(start.ms);
  return start.ms + CLUB_DEFAULT_HOURS * HOUR;
}

function eventIsOver(ev, now) {
  const t = eventOverAt(ev);
  if (t == null) return false;
  return (now != null ? now : Date.now()) >= t;
}

function eventIsListed(ev, now) {
  if (!ev) return false;
  if (ev.is_example || ev.isExample) return false;
  const status = String(ev.status || "active");
  if (status === "removed" || status === "past") return false;
  return !eventIsOver(ev, now);
}

function overAtIso(ev) {
  const t = eventOverAt(ev);
  return t == null ? "" : new Date(t).toISOString();
}

function filterListedEvents(rows, now) {
  return (rows || []).filter((e) => eventIsListed(e, now));
}

function denverInputValue(ms) {
  if (!Number.isFinite(ms)) return "";
  const p = tzParts(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return p.y + "-" + pad(p.m) + "-" + pad(p.d) + "T" + pad(p.h) + ":" + pad(p.mi);
}

// Admin "ends at" field: blank clears it; YYYY-MM-DDTHH:MM is Denver wall time.
function parseAdminEndsAt(raw) {
  if (raw == null) return { ok: false, error: "Missing end time." };
  const s = String(raw).trim();
  if (!s) return { ok: true, value: "" };
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const hasTime = m[4] != null;
    const ms = zoned(Number(m[1]), Number(m[2]), Number(m[3]), hasTime ? Number(m[4]) : 0, hasTime ? Number(m[5]) : 0, hasTime ? Number(m[6] || 0) : 0);
    if (hasTime) return { ok: true, value: new Date(ms).toISOString() };
    const pad = (n) => String(n).padStart(2, "0");
    return { ok: true, value: m[1] + "-" + pad(Number(m[2])) + "-" + pad(Number(m[3])) };
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return { ok: false, error: "Couldn't read that end time." };
  return { ok: true, value: new Date(t).toISOString() };
}

module.exports = {
  TZ,
  CLUB_DEFAULT_HOURS,
  zoned,
  nextSixAm,
  sixAmAfterDate,
  parseEventTime,
  eventOverAt,
  eventIsOver,
  eventIsListed,
  overAtIso,
  filterListedEvents,
  denverInputValue,
  parseAdminEndsAt,
};
