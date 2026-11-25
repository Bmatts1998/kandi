"use strict";

const TZ = "America/Denver";

function icsEscape(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function foldLine(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let i = 0;
  let first = true;
  while (i < bytes.length) {
    const budget = first ? 75 : 74;
    let end = Math.min(bytes.length, i + budget);
    while (end > i && (bytes[end] & 0xc0) === 0x80) end -= 1;
    if (end === i) end = Math.min(bytes.length, i + budget);
    const slice = bytes.slice(i, end).toString("utf8");
    parts.push(first ? slice : " " + slice);
    first = false;
    i = end;
  }
  return parts.join("\r\n");
}

function pad(n) { return String(n).padStart(2, "0"); }

function partsInZone(iso, timeZone) {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  });
  const map = {};
  for (const p of fmt.formatToParts(d)) map[p.type] = p.value;
  return {
    y: map.year, mo: map.month, d: map.day,
    h: map.hour, min: map.minute, s: map.second,
  };
}

function localStamp(iso) {
  const p = partsInZone(iso, TZ);
  return `${p.y}${p.mo}${p.d}T${p.h}${p.min}${p.s}`;
}

function utcStamp(iso) {
  const d = new Date(iso);
  return d.getUTCFullYear()
    + pad(d.getUTCMonth() + 1)
    + pad(d.getUTCDate())
    + "T"
    + pad(d.getUTCHours())
    + pad(d.getUTCMinutes())
    + pad(d.getUTCSeconds())
    + "Z";
}

function dateStamp(iso) {
  const p = partsInZone(iso, TZ);
  return `${p.y}${p.mo}${p.d}`;
}

function nextDateStamp(iso) {
  const p = partsInZone(iso, TZ);
  const next = new Date(Date.UTC(Number(p.y), Number(p.mo) - 1, Number(p.d) + 1));
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

function addHours(iso, hours) {
  return new Date(Date.parse(iso) + hours * 3600000).toISOString();
}

function locationLine(ev) {
  const bits = [ev.venue, ev.address, ev.city].filter(Boolean);
  const out = [];
  for (const b of bits) {
    if (!out.some((x) => x.toLowerCase() === b.toLowerCase()) && !out.join(" ").toLowerCase().includes(b.toLowerCase())) {
      out.push(b);
    }
  }
  return out.join(", ");
}

function descriptionText(ev) {
  const lines = [];
  if (ev.artists && ev.artists.length) lines.push(ev.artists.join(", "));
  if (ev.ticketUrl) {
    const seller = ev.ticketSeller ? `Tickets via ${ev.ticketSeller}` : "Tickets";
    lines.push(`${seller}: ${ev.ticketUrl}`);
  }
  if (ev.sourceUrl && ev.sourceUrl !== ev.ticketUrl) lines.push(`Event page: ${ev.sourceUrl}`);
  if (ev.timeTba) lines.push("Start time: TBA");
  if (ev.ageLimit) lines.push(`Age: ${ev.ageLimit}`);
  return lines.join("\n");
}

function buildIcs(ev) {
  const now = utcStamp(new Date().toISOString());
  const allDay = !!ev.timeTba;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kandi//SLC Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${String(ev.id || "event").replace(/[^\w.-]/g, "-")}@kandi`,
    `DTSTAMP:${now}`,
  ];
  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(ev.startsAt)}`);
    lines.push(`DTEND;VALUE=DATE:${nextDateStamp(ev.startsAt)}`);
  } else {
    lines.push(`DTSTART;TZID=${TZ}:${localStamp(ev.startsAt)}`);
    const endIso = ev.endsAt && !ev.timeTba ? ev.endsAt : addHours(ev.startsAt, 3);
    lines.push(`DTEND;TZID=${TZ}:${localStamp(endIso)}`);
  }
  lines.push(`SUMMARY:${icsEscape(ev.name)}`);
  const loc = locationLine(ev);
  if (loc) lines.push(`LOCATION:${icsEscape(loc)}`);
  const desc = descriptionText(ev);
  if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
  if (ev.ticketUrl) lines.push(`URL:${ev.ticketUrl}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function googleCalendarUrl(ev) {
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", ev.name || "Event");
  params.set("ctz", TZ);
  if (ev.timeTba) {
    params.set("dates", `${dateStamp(ev.startsAt)}/${nextDateStamp(ev.startsAt)}`);
  } else {
    const endIso = ev.endsAt ? ev.endsAt : addHours(ev.startsAt, 3);
    params.set("dates", `${localStamp(ev.startsAt)}/${localStamp(endIso)}`);
  }
  const loc = locationLine(ev);
  if (loc) params.set("location", loc);
  const desc = descriptionText(ev);
  if (desc) params.set("details", desc);
  return "https://calendar.google.com/calendar/render?" + params.toString();
}

function icsFilename(ev) {
  const slug = String(ev.name || ev.id || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "event";
  return slug + ".ics";
}

module.exports = { buildIcs, googleCalendarUrl, icsFilename, locationLine, TZ };
