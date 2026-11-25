"use strict";

const sharp = require("sharp");
const heicConvert = require("heic-convert");

const MAX_EDGE = 1600;
const MIN_EDGE = 1080;
const TARGET_BYTES = Math.round(1.5 * 1024 * 1024);
const INPUT_PIXELS = 200000000;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "miaf", "heif"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

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

async function normalizePhoto(input) {
  let buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const sniffed = sniffImageMime(buffer);
  if (!sniffed) {
    throw httpError("That file doesn't look like a photo. JPEG, PNG, WebP, GIF, HEIC, and AVIF are all fine.", 400);
  }
  if (sniffed === "image/heic" || sniffed === "image/heif") {
    buffer = await heicToJpeg(buffer);
  }

  const opts = { failOn: "none", limitInputPixels: INPUT_PIXELS, sequentialRead: true };
  let meta;
  try {
    meta = await sharp(buffer, opts).metadata();
  } catch (err) {
    throw httpError("Couldn't process that photo. Try another one from your camera roll.", 400);
  }

  const width = meta.width || 0;
  const height = meta.height || 0;
  const long = Math.max(width, height);
  const oriented = !meta.orientation || meta.orientation === 1;
  if (meta.format === "jpeg" && long > 0 && long <= MAX_EDGE && buffer.length <= TARGET_BYTES && oriented) {
    return { buffer, mime: "image/jpeg", ext: ".jpg" };
  }

  const edges = long > MAX_EDGE ? [MAX_EDGE, MIN_EDGE, 960] : (long > MIN_EDGE ? [long, MIN_EDGE, 960] : [long || MIN_EDGE, 960]);
  const qualities = [86, 80, 74, 68, 60, 52];
  let last = null;
  for (const edge of edges) {
    for (const quality of qualities) {
      try {
        const out = await sharp(buffer, opts)
          .rotate()
          .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
          .toBuffer();
        last = out;
        if (out.length <= TARGET_BYTES) return { buffer: out, mime: "image/jpeg", ext: ".jpg" };
      } catch (_) {
        /* try the next size/quality */
      }
    }
  }
  if (last && last[0] === 0xff) return { buffer: last, mime: "image/jpeg", ext: ".jpg" };
  throw httpError("Couldn't process that photo. Try another one from your camera roll.", 400);
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

module.exports = {
  sniffImageMime,
  normalizePhoto,
  servePhoto,
  MAX_UPLOAD_BYTES,
  TARGET_BYTES,
  MAX_EDGE,
};
