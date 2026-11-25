"use strict";

const TZ = "America/Denver";

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

function eventDateKey(startsAt) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(startsAt));
  } catch {
    return String(startsAt || "").slice(0, 10);
  }
}

function eventKey(ev) {
  const name = ev && (ev.name != null ? ev.name : ev.title);
  const venue = ev && ev.venue;
  const starts = ev && (ev.startsAt || ev.starts_at);
  return [normalizeKeyPart(name), normalizeKeyPart(venue), eventDateKey(starts)].join("|");
}

function weekdayShort(startsAt) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date(startsAt));
  } catch {
    return "";
  }
}

function chipLabel(ev) {
  const name = String((ev && ev.name) || "").replace(/\s+/g, " ").trim();
  const short = name.length > 22 ? name.slice(0, 20).trim() + "…" : name;
  const wd = weekdayShort((ev && (ev.startsAt || ev.starts_at)) || "");
  return wd ? short + " · " + wd : short;
}

module.exports = { TZ, normalizeKeyPart, eventDateKey, eventKey, weekdayShort, chipLabel };
