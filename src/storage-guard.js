"use strict";

// Videos were stored in Postgres (photo_files, base64). Neon's free plan caps a branch at 1 GiB,
// and a full database would break logins too, so new video uploads pause before we get close
// unless S3-compatible object storage is configured (see src/object-store.js).
// Cap: KANDI_MEDIA_DB_CAP_MB (default 800 MB of the 1024 MB limit). Photos are small and unaffected.

const objectStore = require("./object-store");

const CHECK_EVERY_MS = 5 * 60 * 1000;
let cached = { at: 0, bytes: 0 };

function capBytes() {
  const mb = Number(process.env.KANDI_MEDIA_DB_CAP_MB || 800);
  return (Number.isFinite(mb) && mb > 0 ? mb : 800) * 1024 * 1024;
}

async function dbBytes(db) {
  if (!db || db.driver !== "postgres") return 0; // local SQLite: no cap
  if (Date.now() - cached.at < CHECK_EVERY_MS) return cached.bytes;
  try {
    const row = await db.prepare(`SELECT pg_database_size(current_database()) AS b`).get();
    cached = { at: Date.now(), bytes: Number(row && row.b) || 0 };
  } catch (_) { /* never block uploads on a failed check */ }
  return cached.bytes;
}

const FULL_MSG = "Video uploads are paused for a bit while we make room. Photos still work.";

async function videoUploadAllowed(db) {
  if (objectStore.enabled()) return { ok: true, usedBytes: 0, capBytes: capBytes(), error: FULL_MSG };
  const used = await dbBytes(db);
  return { ok: used < capBytes(), usedBytes: used, capBytes: capBytes(), error: FULL_MSG };
}

// After a big upload, count it right away instead of waiting for the next check.
function noteBytes(n) { if (cached.at) cached.bytes += Math.round(Number(n || 0) * 1.34); }

module.exports = { videoUploadAllowed, noteBytes, capBytes };
