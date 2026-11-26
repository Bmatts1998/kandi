"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { buildVariants, variantForQuery } = require("./photo");
const { contentRejected } = require("./content-filter");
const { sendBuffer } = require("./media");
const { finishVideo } = require("./video");
const objectStore = require("./object-store");
const {
  MAX_VOICE_SECONDS, MAX_VIDEO_SECONDS, MAX_VOICE_BYTES, MAX_VIDEO_BYTES,
  DISAPPEAR_AFTER_MS, sniffMedia, extForMime, baseMime, isAllowedAudio,
  isAllowedVideo, parseMusicLink, sanitizeWaveform, previewText, publicMessage,
} = require("./chat-media");

const cacheDir = path.join(__dirname, "..", "data", "chat-cache");
try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) { /* ok */ }

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter: (_req, file, cb) => {
    const typ = baseMime(file.mimetype);
    if (!typ || typ === "application/octet-stream" || typ.startsWith("image/") || typ.startsWith("audio/") || typ.startsWith("video/")) {
      return cb(null, true);
    }
    cb(new Error("Please choose a photo, video, or voice note."));
  },
});

function maybeChatUpload(req, res, next) {
  const typ = String(req.headers["content-type"] || "");
  if (typ.includes("multipart/form-data")) {
    return chatUpload.fields([
      { name: "media", maxCount: 1 },
      { name: "file", maxCount: 1 },
      { name: "photo", maxCount: 1 },
      { name: "video", maxCount: 1 },
      { name: "voice", maxCount: 1 },
      { name: "poster", maxCount: 1 },
    ])(req, res, (err) => {
      if (!err) return next();
      const msg = err.code === "LIMIT_FILE_SIZE"
        ? "That video didn't get shrunk before sending. Close and reopen Kandi, then try again."
        : (err.message || "Upload failed");
      const e = new Error(msg);
      e.status = 400;
      next(e);
    });
  }
  next();
}

function pickFile(req, names) {
  const files = req.files || {};
  for (const name of names) {
    if (Array.isArray(files[name]) && files[name][0]) return files[name][0];
  }
  if (req.file) return req.file;
  return null;
}

function newFileId(ext) {
  return Date.now() + "-" + crypto.randomBytes(6).toString("hex") + (ext || "");
}

function cachePath(id) {
  // Keep media out of the public /uploads static folder.
  return path.join(cacheDir, String(id).replace(/[^a-zA-Z0-9._-]/g, "_"));
}

async function saveChatFile(db, { userId, matchId, buffer, mime, ext }) {
  let outBuf = buffer;
  let outMime = mime;
  let outExt = ext;
  let thumbBuf = null;
  let thumbMime = null;
  const looksImage = String(mime || "").toLowerCase().startsWith("image/");
  if (looksImage) {
    const variants = await buildVariants(buffer);
    outBuf = variants.full.buffer;
    outMime = variants.full.mime;
    outExt = variants.full.ext;
    thumbBuf = variants.thumb.buffer;
    thumbMime = variants.thumb.mime;
  }
  const id = newFileId(outExt || ext);
  let storage = null;
  let objectKey = null;
  let thumbKey = null;
  let dataVal = outBuf.toString("base64");
  let thumbVal = thumbBuf ? thumbBuf.toString("base64") : null;
  if (objectStore.enabled()) {
    try {
      objectKey = objectStore.keyFor({ visibility: "private", kind: "chat", userId, matchId, fileId: id });
      await objectStore.putObject({ key: objectKey, body: outBuf, contentType: outMime });
      if (thumbBuf) {
        thumbKey = objectKey + ".thumb";
        await objectStore.putObject({ key: thumbKey, body: thumbBuf, contentType: thumbMime });
      }
      storage = "s3";
      dataVal = "";
      thumbVal = null;
    } catch (err) {
      console.error("object-store chat put failed, using db:", err.message || err);
      storage = null;
      objectKey = null;
      thumbKey = null;
      dataVal = outBuf.toString("base64");
      thumbVal = thumbBuf ? thumbBuf.toString("base64") : null;
    }
  }
  await db.prepare(`INSERT INTO chat_files (id, user_id, match_id, mime, data, thumb_data, thumb_mime, storage, object_key, thumb_key) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, matchId, outMime, dataVal, thumbVal, thumbMime, storage, objectKey, thumbKey);
  try { fs.writeFileSync(cachePath(id), outBuf); } catch (_) { /* ephemeral disk is ok */ }
  return { id, mime: outMime };
}

async function deleteChatFiles(db, ids) {
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  for (const id of unique) {
    const still = await db.prepare(`SELECT id FROM messages WHERE media_id=? OR poster_id=? LIMIT 1`).get(id, id);
    if (still) continue;
    try {
      const row = await db.prepare(`SELECT object_key, thumb_key FROM chat_files WHERE id=?`).get(id);
      if (row) await objectStore.deleteKeys([row.object_key, row.thumb_key]);
    } catch (err) { console.error("object-store chat delete", id, err.message || err); }
    await db.prepare(`DELETE FROM chat_files WHERE id=?`).run(id);
    try { fs.unlinkSync(cachePath(id)); } catch (_) { /* ok */ }
  }
}

async function deleteMessages(db, rows, broadcastToUser) {
  if (!rows || !rows.length) return [];
  const ids = [];
  const byMatch = new Map();
  for (const row of rows) {
    ids.push(Number(row.id));
    const mid = Number(row.match_id);
    if (!byMatch.has(mid)) byMatch.set(mid, { match: null, ids: [], files: [] });
    byMatch.get(mid).ids.push(Number(row.id));
    if (row.media_id) byMatch.get(mid).files.push(row.media_id);
    if (row.poster_id) byMatch.get(mid).files.push(row.poster_id);
  }
  for (const id of ids) {
    await db.prepare(`DELETE FROM messages WHERE id=?`).run(id);
  }
  for (const [, pack] of byMatch) {
    await deleteChatFiles(db, pack.files);
  }
  if (broadcastToUser) {
    for (const [matchId, pack] of byMatch) {
      const match = await db.prepare(`SELECT * FROM matches WHERE id=?`).get(matchId);
      if (!match) continue;
      const payload = { type: "messages-deleted", matchId: Number(matchId), messageIds: pack.ids };
      broadcastToUser(match.a_id, payload);
      broadcastToUser(match.b_id, payload);
    }
  }
  return ids;
}

async function purgeExpiredMessages(db, broadcastToUser) {
  const rows = await db.prepare(`SELECT * FROM messages WHERE disappear=1 AND read_at IS NOT NULL AND read_at != ''`).all();
  const due = rows.filter((r) => {
    const at = Date.parse(r.read_at);
    return Number.isFinite(at) && (at + DISAPPEAR_AFTER_MS) <= Date.now();
  });
  return deleteMessages(db, due, broadcastToUser);
}

async function findMatch(db, myId, otherId) {
  const [a, b] = myId < otherId ? [myId, otherId] : [otherId, myId];
  return db.prepare(`SELECT * FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
}

function startDisappearSweeper(getDb, broadcastToUser) {
  const tick = () => {
    const db = getDb();
    if (!db) return;
    purgeExpiredMessages(db, broadcastToUser).catch((err) => {
      console.error("disappear sweeper:", err.message || err);
    });
  };
  const timer = setInterval(tick, 3000);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}


async function markDisappearRead(db, { match, readerId, messageIds, broadcastToUser }) {
  if (!match) return { readIds: [], readAt: null };
  const wanted = Array.isArray(messageIds) ? messageIds.map(Number).filter(Number.isFinite) : null;
  const otherId = Number(match.a_id) === Number(readerId) ? match.b_id : match.a_id;
  const rows = await db.prepare(`SELECT * FROM messages WHERE match_id=? AND from_id=?`).all(match.id, otherId);
  const now = new Date().toISOString();
  const newly = [];
  for (const row of rows) {
    if (String(row.attach_type || "") === "system") continue;
    if (row.read_at) continue;
    if (wanted && wanted.length && !wanted.includes(Number(row.id))) continue;
    await db.prepare(`UPDATE messages SET read_at=? WHERE id=? AND (read_at IS NULL OR read_at='')`).run(now, row.id);
    newly.push(Number(row.id));
  }
  if (newly.length && broadcastToUser) {
    const payload = { type: "messages-read", matchId: match.id, messageIds: newly, readAt: now };
    broadcastToUser(readerId, payload);
    broadcastToUser(otherId, payload);
    setTimeout(() => {
      purgeExpiredMessages(db, broadcastToUser).catch((err) => {
        console.error("disappear after read:", err.message || err);
      });
    }, DISAPPEAR_AFTER_MS + 200);
  }
  return { readIds: newly, readAt: newly.length ? now : null };
}

function installChat({ app, getDb, auth, publicUser, blockedSet, pairIds, broadcastToUser, sharedShows, getDemoChat }) {
  const db = () => getDb();

  async function requireMatch(req, res, otherId) {
    if ((await blockedSet(req.user.id)).has(Number(otherId))) {
      res.status(403).json({ error: "You can't message this person." });
      return null;
    }
    const match = await findMatch(db(), req.user.id, Number(otherId));
    if (!match) {
      res.status(404).json({ error: "You can only chat after you match." });
      return null;
    }
    return match;
  }

  app.get("/api/chats/media/:id", auth, async (req, res) => {
    const id = String(req.params.id || "");
    if (!id) return res.status(404).json({ error: "Not found." });
    const file = await db().prepare(`SELECT * FROM chat_files WHERE id=?`).get(id);
    if (!file) return res.status(404).json({ error: "That media is gone." });
    const msg = await db().prepare(`SELECT * FROM messages WHERE media_id=? OR poster_id=?`).get(id, id);
    const match = msg
      ? await db().prepare(`SELECT * FROM matches WHERE id=?`).get(msg.match_id)
      : await db().prepare(`SELECT * FROM matches WHERE id=?`).get(file.match_id);
    if (!match || (Number(match.a_id) !== Number(req.user.id) && Number(match.b_id) !== Number(req.user.id))) {
      return res.status(403).json({ error: "You can't view this." });
    }
    const otherId = Number(match.a_id) === Number(req.user.id) ? match.b_id : match.a_id;
    if ((await blockedSet(req.user.id)).has(Number(otherId))) {
      return res.status(403).json({ error: "You can't view this." });
    }
    const variant = variantForQuery(req.query);
    let typ = baseMime(file.mime);
    if (file.object_key && objectStore.enabled()) {
      const key = (typ.startsWith("image/") && variant === "thumb" && file.thumb_key) ? file.thumb_key : file.object_key;
      const signed = objectStore.presignGet(key, { expires: 60 * 60 });
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.redirect(302, signed.url);
    }
    let buffer = null;
    if (typ.startsWith("image/") && variant === "thumb" && file.thumb_data) {
      buffer = Buffer.from(file.thumb_data, "base64");
      typ = baseMime(file.thumb_mime) || typ;
    } else {
      try {
        const cached = cachePath(id);
        if (fs.existsSync(cached)) buffer = fs.readFileSync(cached);
      } catch (_) { /* fall through to db */ }
      if (!buffer) buffer = Buffer.from(file.data, "base64");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    const origSet = res.setHeader.bind(res);
    res.setHeader = (k, v) => {
      if (String(k).toLowerCase() === "cache-control") v = "private, max-age=3600";
      return origSet(k, v);
    };
    return sendBuffer(req, res, buffer, typ || "application/octet-stream");
  });


  app.get("/api/chats/:userId", auth, async (req, res) => {
    await purgeExpiredMessages(db(), broadcastToUser);
    const otherId = Number(req.params.userId);
    const match = await requireMatch(req, res, otherId);
    if (!match) return;
    const rows = await db().prepare(`SELECT * FROM messages WHERE match_id=? ORDER BY id ASC`).all(match.id);
    const shared = sharedShows ? await sharedShows(db(), req.user.id, otherId) : [];
    res.json({
      matchId: match.id,
      messages: rows.map(publicMessage),
      disappear: Boolean(Number(match.disappear)),
      sharedEvents: shared,
      meetPlan: (match.meet_spot || match.meet_time) ? {
        eventKey: match.meet_event_key || "",
        event: shared.find((s) => s.eventKey === match.meet_event_key || s.id === match.meet_event_key) || shared[0] || null,
        spot: match.meet_spot || "",
        time: match.meet_time || "",
      } : null,
    });
  });

  app.post("/api/chats/:userId", auth, maybeChatUpload, async (req, res) => {
    const otherId = Number(req.params.userId);
    const match = await requireMatch(req, res, otherId);
    if (!match) return;

    const body = req.body || {};
    const text = String(body.text || "").trim().slice(0, 1000);
    const msgBad = contentRejected(text);
    if (msgBad) return res.status(400).json({ error: msgBad });
    let typ = String(body.type || body.attachType || "").trim().toLowerCase();
    if (typ === "audio") typ = "voice";
    if (typ && !["voice", "photo", "video", "music"].includes(typ)) {
      return res.status(400).json({ error: "That attachment type isn't supported." });
    }

    const mediaFile = pickFile(req, typ === "voice" ? ["voice", "media", "file"]
      : typ === "video" ? ["video", "media", "file"]
      : typ === "photo" ? ["photo", "media", "file"]
      : ["media", "file", "photo", "video", "voice"]);
    const posterFile = pickFile(req, ["poster"]);

    if (!typ && mediaFile) {
      const declared = baseMime(mediaFile.mimetype);
      typ = declared.startsWith("video/") ? "video" : declared.startsWith("audio/") ? "voice" : "photo";
    }

    if (!typ && !text) return res.status(400).json({ error: "Message is empty." });
    if (!typ) typ = "";

    let mediaId = "";
    let posterId = "";
    let mime = "";
    let duration = Math.max(0, Math.min(MAX_VOICE_SECONDS, Math.round(Number(body.duration) || 0)));
    let linkUrl = "";
    let waveform = "";

    if (typ === "music") {
      const music = parseMusicLink(body.linkUrl || body.link || body.url || text);
      if (!music) {
        return res.status(400).json({ error: "Paste a Spotify, SoundCloud, or Apple Music link." });
      }
      linkUrl = music.url;
      // If they only pasted the link, don't also store it as the bubble caption.
      if (text && parseMusicLink(text) && parseMusicLink(text).url === music.url) {
        /* caption stays empty */
      }
    } else if (typ === "photo" || typ === "voice" || typ === "video") {
      if (!mediaFile || !mediaFile.buffer) {
        return res.status(400).json({ error: typ === "photo" ? "Choose a photo to send." : typ === "video" ? "Choose a video to send." : "Record a voice message first." });
      }
      const sniffed = sniffMedia(mediaFile.buffer);
      if (typ === "photo") {
        const savedPhoto = await saveChatFile(db(), { userId: req.user.id, matchId: match.id, buffer: mediaFile.buffer, mime: mediaFile.mimetype || "image/jpeg", ext: ".jpg" });
        mediaId = savedPhoto.id;
        mime = savedPhoto.mime;
      } else if (typ === "voice") {
        if (mediaFile.buffer.length > MAX_VOICE_BYTES) {
          return res.status(400).json({ error: "That voice message is too large. Try a shorter one." });
        }
        const allowed = isAllowedAudio(mediaFile.mimetype, sniffed);
        // AAC-in-MP4 from iOS often sniffs as video/mp4 (ftyp isom). Allow if the client said voice
        // and the container looks like mp4/webm/ogg.
        mime = allowed || (sniffed && sniffed.mime === "video/mp4" ? "audio/mp4" : null);
        if (!mime && sniffed && /^audio\//.test(sniffed.mime)) mime = sniffed.mime;
        if (!mime) return res.status(400).json({ error: "That voice memo format isn't supported. Try again from your phone." });
        if (duration > MAX_VOICE_SECONDS) {
          return res.status(400).json({ error: "Voice messages can be up to 60 seconds." });
        }
        const peaks = sanitizeWaveform(body.waveform);
        waveform = peaks.length ? JSON.stringify(peaks) : "";
        const savedVoice = await saveChatFile(db(), { userId: req.user.id, matchId: match.id, buffer: mediaFile.buffer, mime, ext: extForMime(mime) });
        mediaId = savedVoice.id;
      } else {
        if (mediaFile.buffer.length > MAX_VIDEO_BYTES) {
          return res.status(400).json({ error: "That video didn't get shrunk before sending. Close and reopen Kandi, then try again." });
        }
        mime = isAllowedVideo(mediaFile.mimetype, sniffed);
        if (!mime && sniffed && sniffed.mime === "video/mp4") mime = "video/mp4";
        if (!mime) return res.status(400).json({ error: "That video format isn't supported. Try an MP4 from your camera roll." });
        if (duration > MAX_VIDEO_SECONDS) {
          return res.status(400).json({ error: "Videos can be up to 60 seconds." });
        }
        const done = await finishVideo(mediaFile.buffer, mime, { maxSeconds: MAX_VIDEO_SECONDS, wantPoster: !(posterFile && posterFile.buffer) });
        if (done.tooLong) return res.status(400).json({ error: "Videos can be up to 60 seconds." });
        mime = done.mime;
        mediaId = (await saveChatFile(db(), { userId: req.user.id, matchId: match.id, buffer: done.buffer, mime, ext: done.ext })).id;
        if (!(posterFile && posterFile.buffer) && done.poster) {
          try { posterId = (await saveChatFile(db(), { userId: req.user.id, matchId: match.id, buffer: done.poster, mime: "image/jpeg", ext: ".jpg" })).id; } catch (_) {}
        }
        if (posterFile && posterFile.buffer) {
          try {
            const savedPoster = await saveChatFile(db(), { userId: req.user.id, matchId: match.id, buffer: posterFile.buffer, mime: posterFile.mimetype || "image/jpeg", ext: ".jpg" });
            posterId = savedPoster.id;
          } catch (_) {
            /* poster is optional */
          }
        }
      }
    }

    const caption = typ === "music" && parseMusicLink(text) ? "" : text;
    const disappear = typ === "system" ? 0 : (Number(match.disappear) ? 1 : 0);
    const info = await db().prepare(
      `INSERT INTO messages (match_id, from_id, text, attach_type, media_id, duration, mime, link_url, waveform, poster_id, disappear, read_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(match.id, req.user.id, caption, typ, mediaId, duration, mime, linkUrl, waveform, posterId, disappear, "");
    const row = await db().prepare(`SELECT * FROM messages WHERE id=?`).get(Number(info.lastInsertRowid));
    const msg = publicMessage(row);
    broadcastToUser(otherId, { type: "message", matchId: match.id, message: msg, from: publicUser(req.user) });
    const other = await db().prepare(`SELECT * FROM users WHERE id=?`).get(otherId);
    const demo = getDemoChat && getDemoChat();
    if (demo && typeof demo.maybeReply === "function") {
      demo.maybeReply({ matchId: match.id, fromUser: req.user, toUser: other });
    }
    res.json({ message: msg });
  });

  app.post("/api/chats/:userId/leave", auth, async (req, res) => {
    const otherId = Number(req.params.userId);
    const match = await requireMatch(req, res, otherId);
    if (!match) return;
    // Recipient leaving (or sender too): delete disappearing messages already opened.
    const rows = await db().prepare(`SELECT * FROM messages WHERE match_id=? AND disappear=1 AND read_at IS NOT NULL AND read_at != ''`).all(match.id);
    const ids = await deleteMessages(db(), rows, broadcastToUser);
    res.json({ ok: true, deletedIds: ids });
  });

  app.post("/api/chats/:userId/disappear", auth, async (req, res) => {
    const otherId = Number(req.params.userId);
    const match = await requireMatch(req, res, otherId);
    if (!match) return;
    const on = Boolean((req.body && (req.body.on === true || req.body.on === 1 || req.body.on === "1" || req.body.on === "true"))
      || (req.body && req.body.disappear === true));
    // If they sent { on: false } that's fine; also accept { disappear: 0 }.
    const enabled = (req.body && Object.prototype.hasOwnProperty.call(req.body, "on"))
      ? Boolean(req.body.on === true || req.body.on === 1 || req.body.on === "1" || req.body.on === "true")
      : (req.body && Object.prototype.hasOwnProperty.call(req.body, "disappear"))
        ? Boolean(Number(req.body.disappear))
        : on;
    await db().prepare(`UPDATE matches SET disappear=? WHERE id=?`).run(enabled ? 1 : 0, match.id);
    const text = (req.user.name || "Someone") + (enabled ? " turned on disappearing messages." : " turned off disappearing messages.");
    const info = await db().prepare(
      `INSERT INTO messages (match_id, from_id, text, attach_type, media_id, duration, mime, link_url, waveform, poster_id, disappear, read_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(match.id, req.user.id, text, "system", "", 0, "", "", "", "", 0, "");
    const row = await db().prepare(`SELECT * FROM messages WHERE id=?`).get(Number(info.lastInsertRowid));
    const msg = publicMessage(row);
    const payload = { type: "disappear", matchId: match.id, disappear: enabled, message: msg, from: publicUser(req.user) };
    broadcastToUser(req.user.id, payload);
    broadcastToUser(otherId, payload);
    res.json({ ok: true, disappear: enabled, message: msg });
  });
}

module.exports = {
  installChat,
  startDisappearSweeper,
  purgeExpiredMessages,
  deleteChatFiles,
  markDisappearRead,
  publicMessage,
  previewText,
};
