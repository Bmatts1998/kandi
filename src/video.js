"use strict";

// Server-side video finishing. Videos arrive already shrunk by the browser (public/video-prep.js),
// so all we do here is a cheap stream copy: trim to the max length, move the index to the front
// ("faststart") so iPhones start playing right away, and tag HEVC so Safari accepts it in MP4.
// Never re-encodes (Render free has ~0.1 CPU); if ffmpeg is missing or fails, the original is kept.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

let ffmpegPath;
function findFfmpeg() {
  if (ffmpegPath !== undefined) return ffmpegPath;
  ffmpegPath = null;
  const candidates = [];
  try { const p = require("ffmpeg-static"); if (p) candidates.push(p); } catch (_) {}
  candidates.push("ffmpeg");
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ["-hide_banner", "-version"], { timeout: 8000 });
      if (r.status === 0) { ffmpegPath = c; break; }
    } catch (_) {}
  }
  return ffmpegPath;
}

function run(args, timeoutMs) {
  return new Promise((resolve) => {
    const bin = findFfmpeg();
    if (!bin) return resolve({ code: -1, stderr: "" });
    let stderr = "";
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch (_) {} }, timeoutMs || 30000);
    p.stderr.on("data", (d) => { if (stderr.length < 20000) stderr += d.toString(); });
    p.on("error", () => { clearTimeout(t); resolve({ code: -1, stderr }); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code, stderr }); });
  });
}

function parseInfo(stderr) {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
  const vm = /Stream #[^\n]*Video:\s*([a-z0-9_]+)/i.exec(stderr);
  const am = /Stream #[^\n]*Audio:\s*([a-z0-9_]+)/i.exec(stderr);
  return { duration, vcodec: vm ? vm[1].toLowerCase() : "", acodec: am ? am[1].toLowerCase() : "" };
}

// One ffmpeg at a time keeps memory flat on a 512 MB instance.
let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/**
 * @returns {Promise<{buffer: Buffer, mime: string, ext: string, duration: number, poster: Buffer|null, tooLong: boolean}>}
 */
function finishVideo(buffer, mime, { maxSeconds = 60, wantPoster = false } = {}) {
  const fallback = { buffer, mime, ext: mime === "video/quicktime" ? ".mov" : (mime === "video/webm" ? ".webm" : ".mp4"), duration: 0, poster: null, tooLong: false };
  if (!findFfmpeg()) return Promise.resolve(fallback);
  return serial(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-vid-"));
    const inPath = path.join(dir, "in" + fallback.ext);
    const outPath = path.join(dir, "out.mp4");
    const posterPath = path.join(dir, "poster.jpg");
    try {
      fs.writeFileSync(inPath, buffer);
      const info = parseInfo((await run(["-hide_banner", "-i", inPath], 15000)).stderr);
      const result = Object.assign({}, fallback, { duration: info.duration, tooLong: info.duration > maxSeconds + 1 });
      const copyable = /^(h264|hevc)$/.test(info.vcodec) && (!info.acodec || /^(aac|mp3|alac|ac3|eac3)$/.test(info.acodec));
      if (copyable) {
        const args = ["-hide_banner", "-y", "-i", inPath, "-t", String(maxSeconds), "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy"];
        if (info.vcodec === "hevc") args.push("-tag:v", "hvc1");
        args.push("-movflags", "+faststart", "-f", "mp4", outPath);
        const r = await run(args, 60000);
        if (r.code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
          result.buffer = fs.readFileSync(outPath);
          result.mime = "video/mp4";
          result.ext = ".mp4";
          result.tooLong = false;
          if (info.duration) result.duration = Math.min(info.duration, maxSeconds);
        }
      }
      if (wantPoster) {
        const src = result.ext === ".mp4" && fs.existsSync(outPath) ? outPath : inPath;
        const r = await run(["-hide_banner", "-y", "-ss", "0.1", "-i", src, "-frames:v", "1", "-vf", "scale='min(720,iw)':-2", "-q:v", "4", posterPath], 30000);
        if (r.code === 0 && fs.existsSync(posterPath)) result.poster = fs.readFileSync(posterPath);
      }
      return result;
    } catch (_) {
      return fallback;
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
}

// Small in-memory cache so iPhone range requests (many per video) don't each pull ~20 MB of
// base64 out of Postgres and decode it again.
const CACHE_LIMIT = Number(process.env.VIDEO_CACHE_BYTES || 64 * 1024 * 1024);
const CACHE_TTL_MS = 10 * 60 * 1000; // deleted posts stop being served within minutes
const cache = new Map();
let cacheBytes = 0;
function cacheGet(id) {
  const hit = cache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(id); cacheBytes -= hit.buffer.length; return null; }
  cache.delete(id); cache.set(id, hit);
  return hit;
}
function cachePut(id, entry) {
  entry.at = Date.now();
  const size = entry.buffer.length;
  if (size > CACHE_LIMIT / 2) return;
  if (cache.has(id)) { cacheBytes -= cache.get(id).buffer.length; cache.delete(id); }
  cache.set(id, entry);
  cacheBytes += size;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_LIMIT) break;
    cache.delete(k); cacheBytes -= v.buffer.length;
  }
}
function etagFor(id) {
  return '"' + crypto.createHash("sha1").update(String(id)).digest("hex").slice(0, 16) + '"';
}

module.exports = { finishVideo, findFfmpeg, cacheGet, cachePut, etagFor, parseInfo };
