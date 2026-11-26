#!/usr/bin/env node
"use strict";

/**
 * Move existing media out of Neon/SQLite base64 columns into the configured
 * S3-compatible bucket (Cloudflare R2 or Backblaze B2).
 *
 * Requires KANDI_S3_ENDPOINT, KANDI_S3_BUCKET, KANDI_S3_ACCESS_KEY_ID,
 * and KANDI_S3_SECRET_ACCESS_KEY. Does nothing if they are missing.
 *
 * Usage:
 *   node scripts/migrate-media-to-s3.js --dry-run
 *   node scripts/migrate-media-to-s3.js --limit 50
 *   node scripts/migrate-media-to-s3.js --kind photos,chat,selfies
 *
 * Safe to re-run: rows that already have object_key (and empty data) are skipped.
 * After a successful upload, data/thumb_data/selfie_data are cleared so Neon
 * storage can shrink, unless --keep-data is passed (copy to the bucket and
 * set object_key, but leave the original blobs in the database).
 * The /uploads/:id and auth media routes then redirect to signed URLs.
 */

require("../src/load-env");
const store = require("../src/object-store");
const { open } = require("../src/db");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const flag = process.argv.find((a) => a.startsWith("--" + name + "="));
  if (flag) return flag.slice(name.length + 3);
  return fallback;
}

const dryRun = process.argv.includes("--dry-run");
const keepData = process.argv.includes("--keep-data");
const limit = Math.max(1, Number(arg("limit", 500)) || 500);
const kinds = String(arg("kind", "photos,chat,selfies")).split(",").map((s) => s.trim()).filter(Boolean);

function decode(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data.length ? data : null;
  const s = String(data);
  if (!s) return null;
  try { return Buffer.from(s, "base64"); } catch (_) { return null; }
}

async function migratePhotos(db) {
  const rows = await db.prepare(
    `SELECT id, user_id, mime, data, thumb_data, thumb_mime, object_key, thumb_key FROM photo_files WHERE (object_key IS NULL OR object_key='') AND data IS NOT NULL AND data != '' LIMIT ?`
  ).all(limit);
  let ok = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    const buf = decode(row.data);
    if (!buf || !buf.length) { skipped++; continue; }
    const isVideo = String(row.mime || "").toLowerCase().startsWith("video/") || String(row.mime || "").toLowerCase().startsWith("audio/");
    const key = store.keyFor({ visibility: "public", kind: isVideo ? "videos" : "photos", userId: row.user_id, fileId: row.id });
    const thumbKey = row.thumb_data ? key + ".thumb" : null;
    console.log((dryRun ? "dry-run photo" : "upload photo"), row.id, row.mime, buf.length);
    if (!dryRun) {
      try {
        await store.putObject({ key, body: buf, contentType: row.mime || "application/octet-stream" });
        const thumb = decode(row.thumb_data);
        if (thumb && thumbKey) await store.putObject({ key: thumbKey, body: thumb, contentType: row.thumb_mime || "image/webp" });
        const photoSql = keepData
          ? `UPDATE photo_files SET storage='s3', object_key=?, thumb_key=? WHERE id=?`
          : `UPDATE photo_files SET storage='s3', object_key=?, thumb_key=?, data='', thumb_data=NULL WHERE id=?`;
        await db.prepare(photoSql).run(key, thumbKey, row.id);
        ok++;
      } catch (err) {
        failed++;
        console.error("photo failed", row.id, err.message || err);
      }
    } else ok++;
  }
  return { found: rows.length, ok, skipped, failed };
}

async function migrateChat(db) {
  const rows = await db.prepare(
    `SELECT id, user_id, match_id, mime, data, thumb_data, thumb_mime, object_key FROM chat_files WHERE (object_key IS NULL OR object_key='') AND data IS NOT NULL AND data != '' LIMIT ?`
  ).all(limit);
  let ok = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    const buf = decode(row.data);
    if (!buf || !buf.length) { skipped++; continue; }
    const key = store.keyFor({ visibility: "private", kind: "chat", userId: row.user_id, matchId: row.match_id, fileId: row.id });
    const thumbKey = row.thumb_data ? key + ".thumb" : null;
    console.log((dryRun ? "dry-run chat" : "upload chat"), row.id, row.mime, buf.length);
    if (!dryRun) {
      try {
        await store.putObject({ key, body: buf, contentType: row.mime || "application/octet-stream" });
        const thumb = decode(row.thumb_data);
        if (thumb && thumbKey) await store.putObject({ key: thumbKey, body: thumb, contentType: row.thumb_mime || "image/webp" });
        const chatSql = keepData
          ? `UPDATE chat_files SET storage='s3', object_key=?, thumb_key=? WHERE id=?`
          : `UPDATE chat_files SET storage='s3', object_key=?, thumb_key=?, data='', thumb_data=NULL WHERE id=?`;
        await db.prepare(chatSql).run(key, thumbKey, row.id);
        ok++;
      } catch (err) {
        failed++;
        console.error("chat failed", row.id, err.message || err);
      }
    } else ok++;
  }
  return { found: rows.length, ok, skipped, failed };
}

async function migrateSelfies(db) {
  const rows = await db.prepare(
    `SELECT id, user_id, selfie_mime, selfie_data, selfie_key FROM verification_requests WHERE (selfie_key IS NULL OR selfie_key='') AND selfie_data IS NOT NULL AND selfie_data != '' LIMIT ?`
  ).all(limit);
  let ok = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    const buf = decode(row.selfie_data);
    if (!buf || !buf.length) { skipped++; continue; }
    const fileId = "verif-" + row.id + ".jpg";
    const key = store.keyFor({ visibility: "private", kind: "selfies", userId: row.user_id, fileId });
    console.log((dryRun ? "dry-run selfie" : "upload selfie"), row.id, buf.length);
    if (!dryRun) {
      try {
        await store.putObject({ key, body: buf, contentType: row.selfie_mime || "image/jpeg" });
        const selfieSql = keepData
          ? `UPDATE verification_requests SET selfie_storage='s3', selfie_key=? WHERE id=?`
          : `UPDATE verification_requests SET selfie_storage='s3', selfie_key=?, selfie_data='' WHERE id=?`;
        await db.prepare(selfieSql).run(key, row.id);
        ok++;
      } catch (err) {
        failed++;
        console.error("selfie failed", row.id, err.message || err);
      }
    } else ok++;
  }
  return { found: rows.length, ok, skipped, failed };
}

(async () => {
  if (!store.enabled()) {
    console.log("Object storage env vars are not set. Nothing to migrate. Configure KANDI_S3_ENDPOINT, KANDI_S3_BUCKET, KANDI_S3_ACCESS_KEY_ID, and KANDI_S3_SECRET_ACCESS_KEY first.");
    process.exit(0);
  }
  const db = await open();
  const report = { dryRun, limit };
  try {
    if (kinds.includes("photos")) report.photos = await migratePhotos(db);
    if (kinds.includes("chat")) report.chat = await migrateChat(db);
    if (kinds.includes("selfies")) report.selfies = await migrateSelfies(db);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try { if (db.close) await db.close(); } catch (_) {}
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
