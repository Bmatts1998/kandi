"use strict";

const { parseTune } = require("./tunes");

const MAX_VOICE_SECONDS = 60;
const MAX_VIDEO_SECONDS = 60;
const MAX_VOICE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const DISAPPEAR_AFTER_MS = 10 * 1000;

const AUDIO_MIMES = new Set([
  "audio/mp4", "audio/aac", "audio/m4a", "audio/x-m4a", "audio/mp4a-latm",
  "audio/webm", "audio/webm;codecs=opus", "audio/ogg", "audio/opus",
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave",
  "audio/3gpp", "audio/amr",
]);
const VIDEO_MIMES = new Set([
  "video/mp4", "video/quicktime", "video/webm", "video/3gpp", "video/x-m4v",
]);

function sniffMedia(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { kind: "container", mime: "video/webm" }; // webm/weba; refined by declared mime
  }
  if (buf.slice(0, 4).toString("ascii") === "OggS") return { kind: "audio", mime: "audio/ogg" };
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WAVE") {
    return { kind: "audio", mime: "audio/wav" };
  }
  if (buf.slice(0, 3).toString("ascii") === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
    return { kind: "audio", mime: "audio/mpeg" };
  }
  if (buf.length >= 16 && buf.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.slice(8, 12).toString("ascii").replace(/\0/g, "").trim();
    const audioBrands = new Set(["M4A", "M4B", "M4P", "mp4a"]);
    if (audioBrands.has(brand)) return { kind: "audio", mime: "audio/mp4" };
    return { kind: "video", mime: "video/mp4" };
  }
  return null;
}

function extForMime(mime) {
  const typ = String(mime || "").toLowerCase().split(";")[0].trim();
  if (typ === "audio/mp4" || typ === "audio/m4a" || typ === "audio/x-m4a" || typ === "audio/aac") return ".m4a";
  if (typ === "audio/webm") return ".webm";
  if (typ === "audio/ogg" || typ === "audio/opus") return ".ogg";
  if (typ === "audio/mpeg" || typ === "audio/mp3") return ".mp3";
  if (typ === "audio/wav" || typ === "audio/x-wav") return ".wav";
  if (typ === "audio/3gpp") return ".3gp";
  if (typ === "video/mp4" || typ === "video/x-m4v") return ".mp4";
  if (typ === "video/quicktime") return ".mov";
  if (typ === "video/webm") return ".webm";
  if (typ === "video/3gpp") return ".3gp";
  if (typ === "image/jpeg" || typ === "image/jpg") return ".jpg";
  if (typ === "image/png") return ".png";
  if (typ === "image/webp") return ".webp";
  if (typ === "image/gif") return ".gif";
  return ".bin";
}

function baseMime(mime) {
  return String(mime || "").toLowerCase().split(";")[0].trim();
}

function isAllowedAudio(mime, sniffed) {
  const typ = baseMime(mime);
  if (AUDIO_MIMES.has(typ) || typ.startsWith("audio/")) return typ || "audio/mp4";
  if (sniffed && sniffed.mime && sniffed.mime.startsWith("audio/")) return sniffed.mime;
  // iOS often reports video/mp4 or audio/mp4 for AAC in an mp4 wrapper; sniff may say video/mp4 for ftyp isom
  if (sniffed && (sniffed.mime === "audio/mp4" || typ === "video/mp4" || typ === "audio/mp4")) return typ || sniffed.mime;
  return null;
}

function isAllowedVideo(mime, sniffed) {
  const typ = baseMime(mime);
  if (VIDEO_MIMES.has(typ) || typ.startsWith("video/")) return typ || "video/mp4";
  if (sniffed && sniffed.mime && sniffed.mime.startsWith("video/")) return sniffed.mime;
  return null;
}

function parseMusicLink(raw) {
  const input = String(raw || "").trim();
  if (!input) return null;
  const uri = input.match(/^spotify:(track|album|playlist|episode|show):([A-Za-z0-9]+)$/i);
  const parsed = parseTune(uri ? ("https://open.spotify.com/" + uri[1].toLowerCase() + "/" + uri[2]) : input);
  if (!parsed) return null;
  return {
    provider: parsed.source,
    source: parsed.source,
    kind: parsed.kind,
    url: parsed.url,
    embedUrl: parsed.embedUrl,
  };
}

function sanitizeWaveform(raw) {
  let list = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch (_) { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 48).map((n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, Math.round(v)));
  });
}

function previewText(row) {
  const typ = row.attach_type || row.attachType || "";
  if (typ === "voice") return "🎤 Voice message";
  if (typ === "photo") return "📷 Photo";
  if (typ === "video") return "🎬 Video";
  if (typ === "music") return "🎵 Music";
  if (typ === "system") return row.text || "";
  return row.text || "";
}

function publicMessage(row) {
  if (!row) return null;
  const typ = row.attach_type || row.attachType || "";
  const mediaId = row.media_id || row.mediaId || "";
  const posterId = row.poster_id || row.posterId || "";
  const linkUrl = row.link_url || row.linkUrl || "";
  const music = typ === "music" ? parseMusicLink(linkUrl) : null;
  const fromId = row.from_id != null ? Number(row.from_id) : Number(row.fromId);
  const readAt = row.read_at || row.readAt || "";
  return {
    id: Number(row.id),
    fromId,
    text: row.text || "",
    at: row.created_at || row.at,
    attachType: typ || null,
    mediaId: mediaId || null,
    mediaUrl: mediaId ? "/api/chats/media/" + encodeURIComponent(mediaId) : null,
    duration: Number(row.duration) || 0,
    mime: row.mime || "",
    linkUrl: linkUrl || null,
    waveform: typ === "voice" ? sanitizeWaveform(row.waveform) : [],
    posterId: posterId || null,
    posterUrl: posterId ? "/api/chats/media/" + encodeURIComponent(posterId) : null,
    music: music || null,
    disappear: Boolean(Number(row.disappear)),
    readAt: readAt || null,
  };
}

module.exports = {
  MAX_VOICE_SECONDS,
  MAX_VIDEO_SECONDS,
  MAX_VOICE_BYTES,
  MAX_VIDEO_BYTES,
  DISAPPEAR_AFTER_MS,
  sniffMedia,
  extForMime,
  baseMime,
  isAllowedAudio,
  isAllowedVideo,
  parseMusicLink,
  sanitizeWaveform,
  previewText,
  publicMessage,
};
