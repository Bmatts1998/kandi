"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const heicConvert = require("heic-convert");
const objectStore = require("./object-store");

const MAX_EDGE = 1080;
const FULL_EDGE = 1080;
const MEDIUM_EDGE = 1080;
const THUMB_EDGE = 320;
const MIN_EDGE = 1080;
const TARGET_BYTES = Math.round(1.5 * 1024 * 1024);
const FULL_TARGET_BYTES = 350 * 1024;
const THUMB_TARGET_BYTES = 80 * 1024;
const INPUT_PIXELS = 200000000;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "miaf", "heif"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

const CACHE_MAX_BYTES = 48 * 1024 * 1024; // leave headroom on a 512 MB Render instance
const CACHE_MAX_ENTRY = 1.5 * 1024 * 1024;

function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.length >= 16 && buf.slice(4, 8).toString("ascii") === "ftyp") {
    const brands = [buf.slice(8, 12).toString("ascii")];
    const boxSize = buf.readUInt32BE(0);
    const end = Math.min(buf.length, Number.isFinite(boxSize) && boxSize > 16 ? boxSize : 64);
    for (let i = 16; i + 4 <= end; i += 4) brands.push(buf.slice(i, i + 4).toString("ascii"));
    if (brands.some((b) => AVIF_BRANDS.has(b))) return "image/avif";
    if (brands.some((b) => HEIC_BRANDS.has(b))) return "image/heic";
  }
  return null;
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status || 400;
  return err;
}

function isVideoOrAudioMime(mime) {
  const m = String(mime || "").toLowerCase();
  return m.startsWith("video/") || m.startsWith("audio/");
}

function isProcessableImage(buffer, mime) {
  if (isVideoOrAudioMime(mime)) return false;
  if (sniffImageMime(buffer)) return true;
  return String(mime || "").toLowerCase().startsWith("image/");
}

async function heicToJpeg(buffer) {
  try {
    const out = await sharp(buffer, { failOn: "none", limitInputPixels: INPUT_PIXELS })
      .rotate()
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    if (out && out[0] === 0xff && out[1] === 0xd8) return out;
  } catch (_) {
    /* Official sharp builds usually cannot decode HEVC/HEIC (no libde265). */
  }
  try {
    const out = await heicConvert({ buffer, format: "JPEG", quality: 0.9 });
    return Buffer.from(out);
  } catch (err) {
    throw httpError("Couldn't read that iPhone photo. Try taking it again or exporting it as a JPEG.", 400);
  }
}

async function prepareImageBuffer(input) {
  let buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const sniffed = sniffImageMime(buffer);
  if (!sniffed) {
    throw httpError("That file doesn't look like a photo. JPEG, PNG, WebP, GIF, HEIC, and AVIF are all fine.", 400);
  }
  if (sniffed === "image/heic" || sniffed === "image/heif") {
    buffer = await heicToJpeg(buffer);
  }
  return buffer;
}

const SHARP_OPTS = { failOn: "none", limitInputPixels: INPUT_PIXELS, sequentialRead: true };

function pipeline(buffer, edge) {
  return sharp(buffer, SHARP_OPTS)
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
}

async function encodeSize(buffer, edge, targetBytes) {
  const qualities = edge <= THUMB_EDGE ? [74, 68, 60, 52] : [80, 74, 68, 60, 52];
  let last = null;
  for (const quality of qualities) {
    try {
      const out = await pipeline(buffer, edge).webp({ quality, effort: 4 }).toBuffer();
      last = { buffer: out, mime: "image/webp", ext: ".webp" };
      if (out.length <= targetBytes) return last;
    } catch (_) {
      try {
        const out = await pipeline(buffer, edge).jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" }).toBuffer();
        last = { buffer: out, mime: "image/jpeg", ext: ".jpg" };
        if (out.length <= targetBytes) return last;
      } catch (__) {
        /* try the next quality */
      }
    }
  }
  if (last) return last;
  throw httpError("Couldn't process that photo. Try another one from your camera roll.", 400);
}

async function buildVariants(input) {
  const buffer = await prepareImageBuffer(input);
  const [full, thumb] = await Promise.all([
    encodeSize(buffer, FULL_EDGE, FULL_TARGET_BYTES),
    encodeSize(buffer, THUMB_EDGE, THUMB_TARGET_BYTES),
  ]);
  return { full, thumb };
}

async function normalizePhoto(input) {
  // Kept for existing upload call sites: returns the full-size variant, plus thumb when available.
  const variants = await buildVariants(input);
  return { buffer: variants.full.buffer, mime: variants.full.mime, ext: variants.full.ext, thumb: variants.thumb };
}

async function servePhoto(input, mimeHint) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  try {
    const { data, info } = await sharp(buffer, { failOn: "none", limitInputPixels: INPUT_PIXELS })
      .rotate()
      .toBuffer({ resolveWithObject: true });
    const format = (info && info.format) || "jpeg";
    const mime = format === "jpg" || format === "jpeg" ? "image/jpeg" : "image/" + format;
    return { buffer: data, mime };
  } catch (_) {
    return { buffer, mime: mimeHint || sniffImageMime(buffer) || "image/jpeg" };
  }
}

class BufferCache {
  constructor({ maxBytes = CACHE_MAX_BYTES, maxEntry = CACHE_MAX_ENTRY } = {}) {
    this.maxBytes = maxBytes;
    this.maxEntry = maxEntry;
    this.map = new Map();
    this.bytes = 0;
  }
  get(key) {
    const row = this.map.get(key);
    if (!row) return null;
    this.map.delete(key);
    this.map.set(key, row);
    return row;
  }
  set(key, value) {
    const buffer = value && value.buffer;
    if (!buffer || buffer.length > this.maxEntry) return;
    const prev = this.map.get(key);
    if (prev) {
      this.bytes -= prev.buffer.length;
      this.map.delete(key);
    }
    while (this.bytes + buffer.length > this.maxBytes && this.map.size) {
      const oldest = this.map.keys().next().value;
      const evicted = this.map.get(oldest);
      this.map.delete(oldest);
      if (evicted) this.bytes -= evicted.buffer.length;
    }
    this.map.set(key, { buffer, mime: value.mime });
    this.bytes += buffer.length;
  }
  forgetPrefix(prefix) {
    for (const [k, v] of this.map) {
      if (k.startsWith(prefix)) { this.map.delete(k); this.bytes -= v.buffer.length; }
    }
  }
}
// Deleted media stops being served from memory right away.
function forgetMedia(id) { if (id) mediaCache.forgetPrefix(String(id) + ":"); }

const mediaCache = new BufferCache();

function variantForQuery(query) {
  const s = String((query && (query.s || query.size)) || "").toLowerCase();
  if (s === "thumb" || s === "t" || s === "sm") return "thumb";
  if (s === "full" || s === "medium" || s === "md" || s === "orig" || s === "original") return "full";
  const w = Number(query && query.w);
  if (Number.isFinite(w) && w > 0 && w <= 400) return "thumb";
  return "full";
}

function etagFor(id, variant, buffer) {
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
  const hash = buffer
    ? crypto.createHash("sha1").update(buffer).digest("base64url").slice(0, 16)
    : "0";
  const len = buffer ? buffer.length.toString(16) : "0";
  return `"u-${safe}-${variant}-${len}-${hash}"`;
}

function ifNoneMatchHits(req, etag) {
  const raw = String((req.headers && req.headers["if-none-match"]) || "");
  if (!raw) return false;
  const want = String(etag).replace(/^W\//, "");
  return raw.split(/,\s*/).some((part) => part.trim().replace(/^W\//, "") === want);
}

function sendMedia(req, res, buffer, mime, { etag, cacheControl } = {}) {
  res.setHeader("Content-Type", mime || "application/octet-stream");
  res.setHeader("Cache-Control", cacheControl || "public, max-age=31536000, immutable");
  if (etag) res.setHeader("ETag", etag);
  res.setHeader("Accept-Ranges", "bytes");
  if (etag && ifNoneMatchHits(req, etag) && !req.headers.range) {
    res.status(304).end();
    return;
  }
  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", buffer.length);
    return res.end(buffer);
  }
  const m = String(range).match(/bytes=(\d*)-(\d*)/);
  if (!m || (!m[1] && !m[2])) return res.status(416).end();
  let start;
  let end;
  if (!m[1]) { start = Math.max(0, buffer.length - Number(m[2])); end = buffer.length - 1; } // suffix range
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), buffer.length - 1) : buffer.length - 1; }
  if (start >= buffer.length || start > end) {
    res.setHeader("Content-Range", "bytes */" + buffer.length);
    return res.status(416).end();
  }
  res.status(206);
  res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + buffer.length);
  res.setHeader("Content-Length", end - start + 1);
  return res.end(buffer.subarray(start, end + 1));
}

function decodeData(data) {
  if (Buffer.isBuffer(data)) return data;
  return Buffer.from(String(data || ""), "base64");
}

const IMAGE_DB_CONCURRENCY = Math.max(1, Number(process.env.PHOTO_DB_CONCURRENCY || 2));
const RETRYABLE = /timeout|ETIMEDOUT|ECONNRESET|EPIPE|ECONNREFUSED|Connection terminated|too many clients|remaining connection slots|connection error|Client has encountered|could not connect|Connection ended|sorry, too many clients|Neon|fetch failed|socket hang up|Connection closed/i;

function createLimiter(max) {
  let active = 0;
  const q = [];
  return async function limit(fn) {
    if (active >= max) await new Promise((resolve) => q.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = q.shift();
      if (next) next();
    }
  };
}

const limitImageDb = createLimiter(IMAGE_DB_CONCURRENCY);
const inflight = new Map();

function coalesced(key, fn) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function withRetry(fn, tries) {
  const max = tries || 3;
  let last;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = String((err && (err.message || err.code)) || err);
      if (i === max - 1 || !RETRYABLE.test(msg)) throw err;
      await sleep(150 * Math.pow(2, i));
    }
  }
  throw last;
}

async function photoQuery(db, sql, ...params) {
  return withRetry(() => limitImageDb(() => db.prepare(sql).get(...params)));
}

async function photoRun(db, sql, ...params) {
  return withRetry(() => limitImageDb(() => db.prepare(sql).run(...params)));
}

async function photoAll(db, sql, ...params) {
  return withRetry(() => limitImageDb(() => db.prepare(sql).all(...params)));
}

function pickFromRow(row, variant) {
  if (!row) return null;
  const mime = String(row.mime || "");
  if (isVideoOrAudioMime(mime)) {
    if (!row.data) return null;
    return { buffer: decodeData(row.data), mime, processed: true, av: true };
  }
  if (variant === "thumb" && row.thumb_data) {
    return {
      buffer: decodeData(row.thumb_data),
      mime: row.thumb_mime || "image/webp",
      processed: Number(row.ready) === 1,
      av: false,
    };
  }
  if (row.data) {
    return {
      buffer: decodeData(row.data),
      mime: mime || "image/jpeg",
      processed: Number(row.ready) === 1,
      av: false,
    };
  }
  if (row.thumb_data) {
    return {
      buffer: decodeData(row.thumb_data),
      mime: row.thumb_mime || "image/webp",
      processed: Number(row.ready) === 1,
      av: false,
    };
  }
  return null;
}

async function materializeVariants(db, row) {
  if (!row || isVideoOrAudioMime(row.mime) || Number(row.ready) === 1) return row;
  if (Number(row.ready) === -1) return row;
  if (row.object_key && !row.data) return row;
  if (!row.data) {
    const full = await photoQuery(db, `SELECT id, mime, data, thumb_data, thumb_mime, ready, storage, object_key, thumb_key FROM photo_files WHERE id=?`, row.id);
    if (!full) return row;
    row = full;
  }
  const raw = decodeData(row.data);
  if (!isProcessableImage(raw, row.mime)) {
    try { await photoRun(db, `UPDATE photo_files SET ready=-1 WHERE id=?`, row.id); } catch (_) {}
    row.ready = -1;
    return row;
  }
  const variants = await buildVariants(raw);
  await photoRun(
    db,
    `UPDATE photo_files SET mime=?, data=?, thumb_data=?, thumb_mime=?, ready=1 WHERE id=?`,
    variants.full.mime,
    variants.full.buffer.toString("base64"),
    variants.thumb.buffer.toString("base64"),
    variants.thumb.mime,
    row.id
  );
  row.mime = variants.full.mime;
  row.data = variants.full.buffer;
  row.thumb_data = variants.thumb.buffer;
  row.thumb_mime = variants.thumb.mime;
  row.ready = 1;
  mediaCache.set(row.id + ":full", { buffer: variants.full.buffer, mime: variants.full.mime });
  mediaCache.set(row.id + ":thumb", { buffer: variants.thumb.buffer, mime: variants.thumb.mime });
  return row;
}

async function loadPhotoRow(db, id, variant) {
  let row = await photoQuery(
    db,
    `SELECT id, mime, thumb_data, thumb_mime, ready, storage, object_key, thumb_key FROM photo_files WHERE id=?`,
    id
  );
  if (!row) return null;
  const isAV = isVideoOrAudioMime(row.mime);
  const ready = Number(row.ready);
  const needData = isAV || variant !== "thumb" || ready !== 1 || !row.thumb_data;
  const needProcess = !isAV && ready !== 1 && ready !== -1;
  if (needData || needProcess) {
    const full = await photoQuery(
      db,
      `SELECT id, mime, data, thumb_data, thumb_mime, ready, storage, object_key, thumb_key FROM photo_files WHERE id=?`,
      id
    );
    if (full) row = full;
  }
  if (needProcess) {
    // Don't block the first view (or a feed of many photos) on sharp — that was
    // the source of multi-second loads and Neon timeouts. Boot backfill rewrites
    // variants in the background; this just nudges the current row along.
    const snapshot = row;
    setImmediate(() => {
      coalesced("mat:" + id, () => materializeVariants(db, snapshot)).catch((err) => {
        console.error("photo materialize", id, err.message || err);
      });
    });
  }
  return row;
}

async function sendUploadedMedia(req, res, db) {
  const id = req.params && req.params.id;
  if (!id || !/^[A-Za-z0-9._-]{1,180}$/.test(String(id))) return false;
  const variant = variantForQuery(req.query);
  const cacheKey = id + ":" + variant;
  const cached = mediaCache.get(cacheKey);
  // When the file lives in the bucket, always redirect to a signed URL. The
  // in-memory cache is filled on upload and would otherwise serve the bytes
  // through Render (and skip CORS-ready signed access) on the same instance.
  if (cached && !objectStore.enabled()) {
    sendMedia(req, res, cached.buffer, cached.mime, { etag: etagFor(id, variant, cached.buffer) });
    return true;
  }
  const row = await coalesced(String(id), () => loadPhotoRow(db, id, variant));
  if (!row) return false;
  if (row.object_key && objectStore.enabled()) {
    const key = (variant === "thumb" && row.thumb_key) ? row.thumb_key : row.object_key;
    const signed = objectStore.presignGet(key);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.redirect(302, signed.url);
    return true;
  }
  const picked = pickFromRow(row, variant);
  if (!picked) return false;
  mediaCache.set(cacheKey, { buffer: picked.buffer, mime: picked.mime });
  const etag = etagFor(id, variant, picked.buffer);
  const cacheControl = picked.processed
    ? "public, max-age=31536000, immutable"
    : "public, max-age=60";
  sendMedia(req, res, picked.buffer, picked.mime, { etag, cacheControl });
  return true;
}

async function savePhotoFile(db, { id, userId, buffer, mime, ext, uploadDir } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let outBuf = buf;
  let outMime = mime || "application/octet-stream";
  let outExt = ext || "";
  let thumbBuf = null;
  let thumbMime = null;
  let ready = 0;
  if (isProcessableImage(buf, mime)) {
    const variants = await buildVariants(buf);
    outBuf = variants.full.buffer;
    outMime = variants.full.mime;
    outExt = variants.full.ext;
    thumbBuf = variants.thumb.buffer;
    thumbMime = variants.thumb.mime;
    ready = 1;
  }
  const fileId = id || `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${outExt || ext || ""}`;
  let storage = null;
  let objectKey = null;
  let thumbKey = null;
  let dataVal = outBuf.toString("base64");
  let thumbVal = thumbBuf ? thumbBuf.toString("base64") : null;
  if (objectStore.enabled()) {
    try {
      const kind = isVideoOrAudioMime(outMime) ? "videos" : "photos";
      objectKey = objectStore.keyFor({ visibility: "public", kind, userId, fileId });
      await objectStore.putObject({ key: objectKey, body: outBuf, contentType: outMime });
      if (thumbBuf) {
        thumbKey = objectKey + ".thumb";
        await objectStore.putObject({ key: thumbKey, body: thumbBuf, contentType: thumbMime });
      }
      storage = "s3";
      dataVal = "";
      thumbVal = null;
    } catch (err) {
      console.error("object-store put failed, using db:", err.message || err);
      storage = null;
      objectKey = null;
      thumbKey = null;
      dataVal = outBuf.toString("base64");
      thumbVal = thumbBuf ? thumbBuf.toString("base64") : null;
    }
  }
  await db.prepare(
    `INSERT INTO photo_files (id, user_id, mime, data, thumb_data, thumb_mime, ready, storage, object_key, thumb_key) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    fileId,
    userId,
    outMime,
    dataVal,
    thumbVal,
    thumbMime,
    ready,
    storage,
    objectKey,
    thumbKey
  );
  if (uploadDir && !objectKey) {
    try { fs.writeFileSync(path.join(uploadDir, fileId), outBuf); } catch (_) { /* ephemeral disk is ok */ }
  }
  if (!objectKey) {
    if (ready === 1) {
      mediaCache.set(fileId + ":full", { buffer: outBuf, mime: outMime });
      if (thumbBuf) mediaCache.set(fileId + ":thumb", { buffer: thumbBuf, mime: thumbMime });
    } else if (isVideoOrAudioMime(outMime)) {
      mediaCache.set(fileId + ":full", { buffer: outBuf, mime: outMime });
    }
  }
  return fileId;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backfillPhotoVariants(db, { limit = 800 } = {}) {
  let done = 0;
  let failed = 0;
  while (done + failed < limit) {
    let rows;
    try {
      rows = await photoAll(
        db,
        `SELECT id FROM photo_files WHERE (ready IS NULL OR ready=0) AND mime NOT LIKE 'video/%' AND mime NOT LIKE 'audio/%' LIMIT 5`
      );
    } catch (err) {
      console.error("photo backfill query:", err.message || err);
      break;
    }
    if (!rows || !rows.length) break;
    for (const r of rows) {
      try {
        const row = await photoQuery(db, `SELECT id, mime, data, thumb_data, thumb_mime, ready, storage, object_key, thumb_key FROM photo_files WHERE id=?`, r.id);
        if (!row || Number(row.ready) === 1 || Number(row.ready) === -1) continue;
        await materializeVariants(db, row);
        done++;
      } catch (err) {
        failed++;
        try { await photoRun(db, `UPDATE photo_files SET ready=-1 WHERE id=?`, r.id); } catch (_) { /* skip */ }
        console.error("photo backfill", r.id, err.message || err);
      }
    }
    if (done && done % 25 === 0) console.log("photo backfill progress", { done, failed });
    await sleep(50);
  }
  if (done || failed) console.log("photo backfill finished", { done, failed });
  return { done, failed };
}

function startPhotoBackfill(db) {
  if (process.env.PHOTO_BACKFILL === "0") return;
  const delay = Number(process.env.PHOTO_BACKFILL_DELAY_MS || 4000);
  setTimeout(() => {
    backfillPhotoVariants(db).catch((err) => console.error("photo backfill failed:", err.message || err));
  }, Number.isFinite(delay) ? Math.max(0, delay) : 4000);
}


async function removePhotoFile(db, id) {
  if (!id) return;
  try {
    const row = await photoQuery(db, `SELECT object_key, thumb_key FROM photo_files WHERE id=?`, id);
    if (row) await objectStore.deleteKeys([row.object_key, row.thumb_key]);
  } catch (err) {
    console.error("object-store delete photo", id, err.message || err);
  }
  await photoRun(db, `DELETE FROM photo_files WHERE id=?`, id);
  forgetMedia(id);
}

async function removePhotoFilesForUser(db, userId) {
  if (!userId) return;
  try {
    const rows = await photoAll(db, `SELECT object_key, thumb_key FROM photo_files WHERE user_id=?`, userId);
    await objectStore.deleteKeys((rows || []).flatMap((r) => [r.object_key, r.thumb_key]));
  } catch (err) {
    console.error("object-store delete user photos", err.message || err);
  }
  await photoRun(db, `DELETE FROM photo_files WHERE user_id=?`, userId);
}

async function registerStoredPhotoFile(db, { id, userId, mime, key, thumbKey, ready }) {
  const fileId = id || `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  await db.prepare(
    `INSERT INTO photo_files (id, user_id, mime, data, thumb_data, thumb_mime, ready, storage, object_key, thumb_key) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(fileId, userId, mime || "application/octet-stream", "", null, null, ready == null ? 1 : ready, "s3", key, thumbKey || null);
  return fileId;
}

module.exports = {
  forgetMedia,
  sniffImageMime,
  normalizePhoto,
  buildVariants,
  servePhoto,
  savePhotoFile,
  removePhotoFile,
  removePhotoFilesForUser,
  registerStoredPhotoFile,
  sendUploadedMedia,
  startPhotoBackfill,
  backfillPhotoVariants,
  mediaCache,
  variantForQuery,
  MAX_UPLOAD_BYTES,
  TARGET_BYTES,
  MAX_EDGE,
  FULL_EDGE,
  MEDIUM_EDGE,
  THUMB_EDGE,
};
