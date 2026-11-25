"use strict";

function sniffVideoMime(buf, name, typ) {
  typ = String(typ || "").toLowerCase();
  name = String(name || "").toLowerCase();
  if (typ.startsWith("video/")) return typ === "video/quicktime" ? "video/quicktime" : typ;
  if (buf && buf.length >= 12 && buf.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.slice(8, 12).toString("ascii");
    const heic = /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1|miaf|heif|avif|avis)/.test(brand);
    if (heic) return null;
    if (brand.startsWith("qt") || brand === "moov") return "video/quicktime";
    return "video/mp4";
  }
  if (name.endsWith(".mov") || name.endsWith(".qt")) return "video/quicktime";
  if (name.endsWith(".webm")) return "video/webm";
  if (name.endsWith(".mp4") || name.endsWith(".m4v")) return "video/mp4";
  return null;
}

function sendBuffer(req, res, buffer, mime) {
  res.setHeader("Content-Type", mime || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=604800");
  res.setHeader("Accept-Ranges", "bytes");
  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  }
  const m = String(range).match(/bytes=(\d*)-(\d*)/);
  if (!m) return res.status(416).end();
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : buffer.length - 1;
  if (start >= buffer.length || end >= buffer.length || start > end) {
    res.setHeader("Content-Range", "bytes */" + buffer.length);
    return res.status(416).end();
  }
  res.status(206);
  res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + buffer.length);
  res.setHeader("Content-Length", end - start + 1);
  return res.send(buffer.subarray(start, end + 1));
}

// 8 MB keeps a 15s story well under Neon free-tier storage (base64 in photo_files).
// Feed posts may use a higher cap in a sibling module; stories stay tighter.
const MAX_STORY_VIDEO_BYTES = 8 * 1024 * 1024;
const MAX_STORY_VIDEO_SECONDS = 15;
const MAX_STORY_TEXT = 140;
const MAX_ACTIVE_STORIES = 30;
const STORY_TTL_MS = 24 * 3600 * 1000;

function storyCutoffIso() {
  return new Date(Date.now() - STORY_TTL_MS).toISOString();
}

module.exports = {
  sniffVideoMime,
  sendBuffer,
  MAX_STORY_VIDEO_BYTES,
  MAX_STORY_VIDEO_SECONDS,
  MAX_STORY_TEXT,
  MAX_ACTIVE_STORIES,
  STORY_TTL_MS,
  storyCutoffIso,
};
