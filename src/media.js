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
  if (!m || (!m[1] && !m[2])) return res.status(416).end();
  let start;
  let end;
  if (!m[1]) { // suffix range: last N bytes
    start = Math.max(0, buffer.length - Number(m[2]));
    end = buffer.length - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), buffer.length - 1) : buffer.length - 1;
  }
  if (start >= buffer.length || start > end) {
    res.setHeader("Content-Range", "bytes */" + buffer.length);
    return res.status(416).end();
  }
  res.status(206);
  res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + buffer.length);
  res.setHeader("Content-Length", end - start + 1);
  return res.send(buffer.subarray(start, end + 1));
}

// The app shrinks every video to ~720p H.264 (about 15-20 MB per minute) before upload, so these
// caps only stop something unexpected. Any size original from the phone is fine.
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;
const MAX_STORY_VIDEO_BYTES = MAX_VIDEO_BYTES;
const MAX_STORY_VIDEO_SECONDS = MAX_VIDEO_SECONDS;
const MAX_STORY_TEXT = 140;
const MAX_ACTIVE_STORIES = 30;
const STORY_TTL_MS = 24 * 3600 * 1000;

function storyCutoffIso() {
  return new Date(Date.now() - STORY_TTL_MS).toISOString();
}

module.exports = {
  sniffVideoMime,
  sendBuffer,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  MAX_STORY_VIDEO_BYTES,
  MAX_STORY_VIDEO_SECONDS,
  MAX_STORY_TEXT,
  MAX_ACTIVE_STORIES,
  STORY_TTL_MS,
  storyCutoffIso,
};
