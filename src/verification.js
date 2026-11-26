"use strict";

const objectStore = require("./object-store");

const sharp = require("sharp");

const POSES = [
  { id: "thumbs_up", label: "Thumbs up", hint: "Hold a clear thumbs-up next to your face." },
  { id: "peace", label: "Peace sign (two fingers)", hint: "Hold a peace sign next to your face." },
  { id: "hand_on_head", label: "Hand on your head", hint: "Place one hand flat on top of your head." },
  { id: "hand_on_chin", label: "Hand on your chin", hint: "Rest your chin on one hand." },
  { id: "two_fingers_temple", label: "Two fingers at your temple", hint: "Hold two fingers at your temple, like a salute." },
];

function poseById(id) {
  return POSES.find((p) => p.id === String(id || "")) || null;
}

function randomPose() {
  return POSES[Math.floor(Math.random() * POSES.length)];
}

function adminNames() {
  const extra = String(process.env.KANDI_ADMINS || "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set(["boston"].concat(extra));
}

function isAdminUser(user) {
  if (!user) return false;
  if (Number(user.is_admin) === 1) return true;
  return adminNames().has(String(user.username || "").toLowerCase());
}

function mainPhotoKey(photos) {
  const list = Array.isArray(photos) ? photos : (function () {
    try { const v = JSON.parse(photos || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; }
  })();
  const first = list.find((p) => p && p.type !== "video") || list[0];
  if (!first) return "";
  return String(first.url || first.id || first.photoId || "");
}

function publicStatus(user) {
  if (!user) return "";
  const st = String(user.verification_status || "");
  if (user.verified_at || st === "approved") return "approved";
  if (st === "pending" || st === "rejected" || st === "stale") return st;
  return "";
}

async function shrinkSelfie(buffer) {
  const out = await sharp(buffer, { failOn: "none", limitInputPixels: 40e6 })
    .rotate()
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 68, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toBuffer();
  if (!out || out.length < 40) {
    const err = new Error("Couldn't process that selfie. Try again.");
    err.status = 400;
    throw err;
  }
  return out;
}

async function migrateVerification(db) {
  const userCols = [
    ["verified_at", "TEXT"],
    ["verified_photo", "TEXT DEFAULT ''"],
    ["verification_status", "TEXT DEFAULT ''"],
    ["is_admin", "INTEGER DEFAULT 0"],
  ];
  const tablePg = `CREATE TABLE IF NOT EXISTS verification_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pose TEXT NOT NULL,
    selfie_data TEXT NOT NULL,
    selfie_mime TEXT NOT NULL DEFAULT 'image/jpeg',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewer_id INTEGER,
    reason TEXT DEFAULT ''
  )`;
  const tableSqlite = `CREATE TABLE IF NOT EXISTS verification_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pose TEXT NOT NULL,
    selfie_data TEXT NOT NULL,
    selfie_mime TEXT NOT NULL DEFAULT 'image/jpeg',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewer_id INTEGER,
    reason TEXT DEFAULT ''
  )`;
  if (db.driver === "postgres") {
    for (const [col, typ] of userCols) await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} ${typ}`);
    await db.exec(tablePg);
    await db.exec("CREATE INDEX IF NOT EXISTS idx_verification_status ON verification_requests(status, created_at)");
  } else {
    for (const [col, typ] of userCols) {
      try { await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${typ}`); } catch (_) { /* exists */ }
    }
    await db.exec(tableSqlite);
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_verification_status ON verification_requests(status, created_at)"); } catch (_) { /* exists */ }
  }
  if (db.driver === "postgres") {
    await db.exec("ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS selfie_key TEXT");
    await db.exec("ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS selfie_storage TEXT");
  } else {
    for (const sql of [
      "ALTER TABLE verification_requests ADD COLUMN selfie_key TEXT",
      "ALTER TABLE verification_requests ADD COLUMN selfie_storage TEXT",
    ]) { try { await db.exec(sql); } catch (_) { /* exists */ } }
  }
  try {
    const r = await db.prepare(`UPDATE users SET is_admin=1 WHERE lower(username)='boston' AND COALESCE(is_admin,0)=0`).run();
    if (r && r.changes) console.log("Granted admin to " + r.changes + " account(s) (boston).");
  } catch (err) {
    console.error("admin backfill:", err.message || err);
  }
}

async function maybeStaleVerification(db, user, nextPhotos) {
  if (!user) return;
  const approved = Boolean(user.verified_at) || String(user.verification_status || "") === "approved";
  if (!approved) return;
  const next = mainPhotoKey(nextPhotos);
  const prev = String(user.verified_photo || "") || mainPhotoKey(user.photos);
  if (next && prev && next !== prev) {
    await db.prepare(`UPDATE users SET verified_at=NULL, verification_status='stale' WHERE id=?`).run(user.id);
  }
}

function profilePhotoUrls(photosJson) {
  try {
    const list = JSON.parse(photosJson || "[]");
    return (Array.isArray(list) ? list : []).filter((p) => p && p.type !== "video" && p.url).slice(0, 6).map((p) => p.url);
  } catch (_) {
    return [];
  }
}

function installVerification({ app, getDb, auth, upload }) {
  const db = () => getDb();

  function requireAdmin(req, res) {
    if (!isAdminUser(req.user)) {
      res.status(404).json({ error: "Not found." });
      return false;
    }
    return true;
  }

  app.get("/api/verification", auth, async (req, res) => {
    const user = await db().prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
    const latest = await db().prepare(
      `SELECT id, pose, status, created_at, reviewed_at, reason FROM verification_requests WHERE user_id=? ORDER BY id DESC LIMIT 1`
    ).get(req.user.id);
    const pose = latest && latest.status === "pending" ? (poseById(latest.pose) || randomPose()) : randomPose();
    res.json({
      status: publicStatus(user),
      verified: publicStatus(user) === "approved",
      pose,
      poses: POSES,
      latest: latest ? {
        id: Number(latest.id),
        pose: latest.pose,
        status: latest.status,
        at: latest.created_at,
        reviewedAt: latest.reviewed_at,
        reason: latest.reason || "",
      } : null,
    });
  });

  app.post("/api/verification", auth, (req, res) => {
    upload.single("selfie")(req, res, async (err) => {
      try {
        if (err) return res.status(400).json({ error: err.message || "Upload failed" });
        if (!req.file || !req.file.buffer) return res.status(400).json({ error: "Take a live selfie to continue." });
        const pose = poseById(req.body && req.body.pose);
        if (!pose) return res.status(400).json({ error: "Choose the pose shown on the screen, then try again." });
        if (req.file.buffer.length > 12 * 1024 * 1024) {
          return res.status(400).json({ error: "That photo is too large. Try again from your camera." });
        }
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const recent = await db().prepare(
          `SELECT COUNT(*) AS n FROM verification_requests WHERE user_id=? AND created_at>=?`
        ).get(req.user.id, since);
        if (Number(recent && recent.n) >= 6) {
          return res.status(429).json({ error: "You've sent a few selfies already today. Try again tomorrow." });
        }
        const small = await shrinkSelfie(req.file.buffer);
        const now = new Date().toISOString();
        await db().prepare(`UPDATE verification_requests SET status='superseded' WHERE user_id=? AND status='pending'`).run(req.user.id);
        let selfieData = small.toString("base64");
        let selfieKey = null;
        let selfieStorage = null;
        if (objectStore.enabled()) {
          try {
            const tmpId = "pending-" + req.user.id + "-" + Date.now();
            selfieKey = objectStore.keyFor({ visibility: "private", kind: "selfies", userId: req.user.id, fileId: tmpId + ".jpg" });
            await objectStore.putObject({ key: selfieKey, body: small, contentType: "image/jpeg" });
            selfieData = "";
            selfieStorage = "s3";
          } catch (err) {
            console.error("verification object-store put failed, using db:", err.message || err);
            selfieKey = null;
            selfieStorage = null;
            selfieData = small.toString("base64");
          }
        }
        const info = await db().prepare(
          `INSERT INTO verification_requests (user_id, pose, selfie_data, selfie_mime, status, created_at, reason, selfie_key, selfie_storage) VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(req.user.id, pose.id, selfieData, "image/jpeg", "pending", now, "", selfieKey, selfieStorage);
        await db().prepare(`UPDATE users SET verification_status='pending' WHERE id=?`).run(req.user.id);
        res.json({
          ok: true,
          status: "pending",
          id: Number(info.lastInsertRowid),
          pose,
          message: "Thanks — we'll review your selfie and add a verified badge if it matches your profile photos.",
        });
      } catch (e) {
        console.error("verification upload:", e && (e.message || e));
        res.status(e.status || 400).json({ error: e.message || "Couldn't save that selfie. Try again." });
      }
    });
  });

  app.get("/api/verification/photo/:id", auth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: "Not found." });
    const row = await db().prepare(`SELECT id, user_id, selfie_data, selfie_mime, selfie_key FROM verification_requests WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ error: "Not found." });
    const mine = Number(row.user_id) === Number(req.user.id);
    if (!mine && !isAdminUser(req.user)) return res.status(404).json({ error: "Not found." });
    if (row.selfie_key && objectStore.enabled()) {
      const signed = objectStore.presignGet(row.selfie_key, { expires: 10 * 60 });
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.redirect(302, signed.url);
    }
    let body;
    try { body = Buffer.from(String(row.selfie_data || ""), "base64"); } catch (_) { body = null; }
    if (!body || !body.length) return res.status(404).json({ error: "Not found." });
    res.setHeader("Content-Type", row.selfie_mime || "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(body);
  });

  app.get("/api/admin/verifications", auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const status = String(req.query.status || "pending");
    const want = ["pending", "approved", "rejected", "all"].includes(status) ? status : "pending";
    const rows = want === "all"
      ? await db().prepare(`SELECT v.id, v.user_id, v.pose, v.status, v.created_at, v.reviewed_at, v.reason, u.username, u.name, u.photos, u.verified_at, u.verification_status FROM verification_requests v JOIN users u ON u.id=v.user_id WHERE v.status<>'superseded' ORDER BY v.id DESC LIMIT 80`).all()
      : await db().prepare(`SELECT v.id, v.user_id, v.pose, v.status, v.created_at, v.reviewed_at, v.reason, u.username, u.name, u.photos, u.verified_at, u.verification_status FROM verification_requests v JOIN users u ON u.id=v.user_id WHERE v.status=? ORDER BY v.id DESC LIMIT 80`).all(want);
    res.json({
      requests: (rows || []).map((r) => ({
        id: Number(r.id),
        userId: Number(r.user_id),
        username: r.username,
        name: r.name,
        pose: r.pose,
        poseLabel: (poseById(r.pose) && poseById(r.pose).label) || r.pose,
        poseHint: (poseById(r.pose) && poseById(r.pose).hint) || "",
        status: r.status,
        at: r.created_at,
        reviewedAt: r.reviewed_at,
        reason: r.reason || "",
        selfieUrl: "/api/verification/photo/" + Number(r.id),
        profilePhotos: profilePhotoUrls(r.photos),
      })),
    });
  });

  app.post("/api/admin/verifications/:id", auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    const action = String((req.body && req.body.action) || "").toLowerCase();
    if (!Number.isInteger(id) || (action !== "approve" && action !== "reject")) {
      return res.status(400).json({ error: "Choose approve or reject." });
    }
    const row = await db().prepare(`SELECT * FROM verification_requests WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ error: "Request not found." });
    if (row.status !== "pending") return res.status(409).json({ error: "This one was already reviewed." });
    const reason = String((req.body && req.body.reason) || "").trim().slice(0, 200);
    const now = new Date().toISOString();
    const next = action === "approve" ? "approved" : "rejected";
    await db().prepare(`UPDATE verification_requests SET status=?, reviewed_at=?, reviewer_id=?, reason=? WHERE id=?`)
      .run(next, now, req.user.id, reason, id);
    const user = await db().prepare(`SELECT * FROM users WHERE id=?`).get(row.user_id);
    if (action === "approve") {
      await db().prepare(`UPDATE users SET verified_at=?, verification_status='approved', verified_photo=? WHERE id=?`)
        .run(now, mainPhotoKey(user && user.photos), row.user_id);
    } else {
      await db().prepare(`UPDATE users SET verified_at=NULL, verification_status='rejected' WHERE id=?`).run(row.user_id);
    }
    res.json({ ok: true, status: next });
  });
}

module.exports = {
  POSES,
  isAdminUser,
  mainPhotoKey,
  migrateVerification,
  maybeStaleVerification,
  publicStatus,
  installVerification,
};
