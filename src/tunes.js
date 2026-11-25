"use strict";

const MAX_TUNES = 5;

function hostOf(u) {
  return String(u.hostname || "").toLowerCase().replace(/^www\./, "");
}

function parseHttpUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.protocol === "http:") u.protocol = "https:";
  return u;
}

function normalizeSpotify(u) {
  const host = hostOf(u);
  if (host !== "open.spotify.com" && host !== "play.spotify.com") return null;
  const path = u.pathname.replace(/\/+$/, "");
  const m = path.match(/^(?:\/embed)?(?:\/intl-[a-z0-9-]+)?\/(track|playlist|album)\/([A-Za-z0-9]+)(?:\/.*)?$/i);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const id = m[2];
  return {
    url: "https://open.spotify.com/" + kind + "/" + id,
    embedUrl: "https://open.spotify.com/embed/" + kind + "/" + id + "?theme=0",
    source: "spotify",
    kind,
  };
}

function normalizeSoundCloud(u) {
  const host = hostOf(u);
  if (host === "w.soundcloud.com") {
    const inner = u.searchParams.get("url");
    if (!inner) return null;
    const innerUrl = parseHttpUrl(inner);
    if (!innerUrl) return null;
    return normalizeSoundCloud(innerUrl);
  }
  if (host !== "soundcloud.com" && host !== "m.soundcloud.com") return null;
  const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const reserved = new Set(["you", "discover", "feed", "stream", "upload", "pages", "search", "signin", "login", "settings", "notifications", "messages", "popular", "charts"]);
  if (reserved.has(parts[0].toLowerCase())) return null;
  const page = "https://soundcloud.com/" + parts.join("/");
  const params = new URLSearchParams({
    url: page,
    color: "#ff5c00",
    auto_play: "false",
    hide_related: "true",
    show_comments: "false",
    show_user: "true",
    show_reposts: "false",
    show_teaser: "false",
    visual: "false",
  });
  return {
    url: page,
    embedUrl: "https://w.soundcloud.com/player/?" + params.toString(),
    source: "soundcloud",
    kind: parts[1] === "sets" ? "playlist" : "track",
  };
}

function normalizeApple(u) {
  const host = hostOf(u);
  if (host !== "music.apple.com" && host !== "embed.music.apple.com" && host !== "itunes.apple.com") return null;
  const path = u.pathname.replace(/\/+$/, "");
  const m = path.match(/^\/([a-z]{2})\/(song|album|playlist)\/([^/]+)(?:\/([^/]+))?$/i);
  if (!m) return null;
  const locale = m[1].toLowerCase();
  const kind = m[2].toLowerCase();
  const slug = m[3];
  const id = m[4] || "";
  const rest = id ? slug + "/" + id : slug;
  const songQuery = u.searchParams.get("i");
  const q = songQuery ? ("?i=" + encodeURIComponent(songQuery)) : "";
  return {
    url: "https://music.apple.com/" + locale + "/" + kind + "/" + rest + q,
    embedUrl: "https://embed.music.apple.com/" + locale + "/" + kind + "/" + rest + q,
    source: "apple",
    kind: songQuery ? "song" : kind,
  };
}

function parseTune(raw) {
  const u = parseHttpUrl(typeof raw === "string" ? raw : (raw && (raw.url || raw.embedUrl)));
  if (!u) return null;
  return normalizeSpotify(u) || normalizeSoundCloud(u) || normalizeApple(u);
}

function parseTunes(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const raw = typeof item === "string" ? item : (item && (item.url || item.embedUrl || item.href) || "");
    if (!String(raw).trim()) continue;
    const parsed = parseTune(item);
    if (!parsed) return { error: true, tunes: out, invalid: String(raw).trim() };
    if (seen.has(parsed.source + ":" + parsed.url)) continue;
    seen.add(parsed.source + ":" + parsed.url);
    out.push(parsed);
    if (out.length >= MAX_TUNES) break;
  }
  return { error: false, tunes: out };
}

function tuneFrameHeight(tune) {
  if (!tune) return 152;
  if (tune.source === "spotify" && (tune.kind === "playlist" || tune.kind === "album")) return 352;
  if (tune.source === "apple" && (tune.kind === "playlist" || tune.kind === "album")) return 450;
  if (tune.source === "soundcloud") return 166;
  return 152;
}

module.exports = { MAX_TUNES, parseTune, parseTunes, tuneFrameHeight };
