"use strict";

const { contentRejected } = require("./content-filter");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { normalizePhoto, sniffImageMime, MAX_UPLOAD_BYTES } = require("./photo");
const {
  sniffVideoMime,
  MAX_STORY_VIDEO_BYTES,
  MAX_STORY_VIDEO_SECONDS,
  MAX_STORY_TEXT,
  MAX_ACTIVE_STORIES,
  storyCutoffIso,
} = require("./media");

function firstAvatar(photosJson) {
  try {
    const photos = typeof photosJson === "string" ? JSON.parse(photosJson) : photosJson || [];
    const ph = photos[0];
    if (!ph) return null;
    if (ph.type === "file" && ph.url) return { type: "file", url: ph.url };
    return { type: "gradient", gradient: ph.gradient || "", emoji: ph.emoji || "●" };
  } catch (_) {
    return null;
  }
}

function installStories({ app, getDb, auth, publicUser, blockedSet, broadcastToUser, uploadDir }) {
  function db() {
    return getDb();
  }

  const uploadStory = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: Math.max(MAX_UPLOAD_BYTES, MAX_STORY_VIDEO_BYTES), files: 2 },
    fileFilter: (_req, file, cb) => {
      const typ = String(file.mimetype || "").toLowerCase();
      const name = String(file.originalname || "").toLowerCase();
      if (!typ || typ === "application/octet-stream" || typ.startsWith("image/") || typ.startsWith("video/")) {
        return cb(null, true);
      }
      if (/\.(mov|mp4|m4v|qt|webm|jpg|jpeg|png|webp|gif|heic|heif|avif)$/.test(name)) return cb(null, true);
      cb(new Error("Please choose a photo or a short video (15 seconds or less)."));
    },
  });

  async function mediaInUse(fileId) {
    if (!fileId) return false;
    const post = await db().prepare(`SELECT id FROM posts WHERE photo_id=? LIMIT 1`).get(fileId);
    if (post) return true;
    try {
      const extra = await db().prepare(`SELECT id FROM posts WHERE extra_photos IS NOT NULL AND extra_photos LIKE ? LIMIT 1`).get("%" + fileId + "%");
      if (extra) return true;
    } catch (_) { /* extra_photos may not exist on a very old schema */ }
    const story = await db().prepare(`SELECT id FROM stories WHERE media_id=? OR poster_id=? LIMIT 1`).get(fileId, fileId);
    return Boolean(story);
  }

  async function deleteMediaIfOrphan(fileId, userId) {
    if (!fileId) return;
    if (await mediaInUse(fileId)) return;
    const row = await db().prepare(`SELECT user_id FROM photo_files WHERE id=?`).get(fileId);
    if (!row || (userId != null && Number(row.user_id) !== Number(userId))) return;
    await db().prepare(`DELETE FROM photo_files WHERE id=?`).run(fileId);
    if (uploadDir) {
      try { fs.unlinkSync(path.join(uploadDir, fileId)); } catch (_) { /* ephemeral disk is ok */ }
    }
  }

  async function storeBuffer(userId, buffer, mime, ext) {
    const id = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext || ""}`;
    await db().prepare(`INSERT INTO photo_files (id, user_id, mime, data) VALUES (?,?,?,?)`).run(
      id, userId, mime, buffer.toString("base64")
    );
    if (uploadDir) {
      try { fs.writeFileSync(path.join(uploadDir, id), buffer); } catch (_) { /* ephemeral disk is ok */ }
    }
    return id;
  }

  async function cleanupExpired() {
    const cutoff = storyCutoffIso();
    const rows = await db().prepare(
      `SELECT id, media_id, poster_id, user_id FROM stories WHERE created_at < ?`
    ).all(cutoff);
    for (const row of rows) {
      await db().prepare(`DELETE FROM story_views WHERE story_id=?`).run(row.id);
      await db().prepare(`DELETE FROM stories WHERE id=?`).run(row.id);
      await deleteMediaIfOrphan(row.media_id, row.user_id);
      await deleteMediaIfOrphan(row.poster_id, row.user_id);
    }
    return rows.length;
  }

  async function formatEvent(eventId) {
    if (!eventId) return null;
    const ev = await db().prepare(`SELECT id, name, emoji, city FROM events WHERE id=?`).get(eventId);
    return ev ? { id: ev.id, name: ev.name, emoji: ev.emoji, city: ev.city } : null;
  }

  async function shapeStory(row, meId, viewedSet, withCount) {
    const isMine = Number(row.user_id) === Number(meId);
    let viewCount = null;
    if (withCount && isMine) {
      const c = await db().prepare(`SELECT COUNT(*) AS c FROM story_views WHERE story_id=? AND user_id!=?`).get(row.id, meId);
      viewCount = c ? Number(c.c) || 0 : 0;
    }
    return {
      id: Number(row.id),
      kind: row.kind === "video" ? "video" : "photo",
      mediaUrl: row.media_id ? "/uploads/" + row.media_id : null,
      posterUrl: row.poster_id ? "/uploads/" + row.poster_id : null,
      textOverlay: row.text_overlay || "",
      event: await formatEvent(row.event_id),
      createdAt: row.created_at,
      viewed: isMine ? true : Boolean(viewedSet && viewedSet.has(Number(row.id))),
      viewCount,
    };
  }

  function ringUser(row, meId) {
    return {
      id: Number(row.user_id),
      username: row.username,
      name: row.name,
      avatar: firstAvatar(row.user_photos || row.photos),
      isDemo: Boolean(row.is_demo),
      isMe: Number(row.user_id) === Number(meId),
    };
  }

  async function loadActiveForUsers(userIds, meId) {
    if (!userIds.length) return [];
    const cutoff = storyCutoffIso();
    const out = [];
    for (const uid of userIds) {
      const rows = await db().prepare(
        `SELECT s.*, u.username, u.name, u.photos AS user_photos, u.is_demo
         FROM stories s JOIN users u ON u.id = s.user_id
         WHERE s.user_id=? AND s.created_at >= ?
         ORDER BY s.created_at ASC, s.id ASC`
      ).all(uid, cutoff);
      out.push(...rows);
    }
    const ids = out.map((r) => Number(r.id));
    const viewedSet = new Set();
    if (ids.length) {
      for (const id of ids) {
        const v = await db().prepare(`SELECT story_id FROM story_views WHERE user_id=? AND story_id=?`).get(meId, id);
        if (v) viewedSet.add(Number(v.story_id));
      }
    }
    return { rows: out, viewedSet };
  }

  async function userStories(userId, meId, withCount) {
    const cutoff = storyCutoffIso();
    const rows = await db().prepare(
      `SELECT s.*, u.username, u.name, u.photos AS user_photos, u.is_demo
       FROM stories s JOIN users u ON u.id = s.user_id
       WHERE s.user_id=? AND s.created_at >= ?
       ORDER BY s.created_at ASC, s.id ASC`
    ).all(userId, cutoff);
    const viewedSet = new Set();
    for (const r of rows) {
      const v = await db().prepare(`SELECT story_id FROM story_views WHERE user_id=? AND story_id=?`).get(meId, r.id);
      if (v) viewedSet.add(Number(r.id));
    }
    const stories = [];
    for (const r of rows) stories.push(await shapeStory(r, meId, viewedSet, withCount));
    const user = rows[0]
      ? ringUser(rows[0], meId)
      : null;
    return { user, stories, viewedSet, rows };
  }

  app.get("/api/stories", auth, async (req, res) => {
    await cleanupExpired().catch(() => {});
    const meId = Number(req.user.id);
    const blocked = await blockedSet(meId);
    const follows = await db().prepare(`SELECT following_id AS id FROM follows WHERE follower_id=?`).all(meId);
    const ids = [meId].concat(follows.map((r) => Number(r.id)).filter((id) => id !== meId && !blocked.has(id)));
    const cutoff = storyCutoffIso();

    const meUser = publicUser(req.user);
    const rings = [];
    const mine = await userStories(meId, meId, true);
    rings.push({
      user: {
        id: meId,
        username: meUser.username,
        name: meUser.name,
        avatar: firstAvatar(req.user.photos),
        isDemo: Boolean(req.user.is_demo),
        isMe: true,
      },
      stories: mine.stories,
      unseen: false,
      storyCount: mine.stories.length,
    });

    for (const uid of ids) {
      if (uid === meId) continue;
      const pack = await userStories(uid, meId, false);
      if (!pack.stories.length) continue;
      const unseen = pack.stories.some((s) => !s.viewed);
      rings.push({
        user: pack.user,
        stories: pack.stories,
        unseen,
        storyCount: pack.stories.length,
      });
    }

    const mineRing = rings[0];
    const others = rings.slice(1).sort((a, b) => {
      if (a.unseen !== b.unseen) return a.unseen ? -1 : 1;
      const at = a.stories.length ? a.stories[a.stories.length - 1].createdAt : "";
      const bt = b.stories.length ? b.stories[b.stories.length - 1].createdAt : "";
      return String(bt).localeCompare(String(at));
    });
    res.json({
      rings: [mineRing].concat(others),
      cutoff,
    });
  });

  app.get("/api/stories/user/:id", auth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Unknown user." });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(id) && id !== Number(req.user.id)) return res.status(404).json({ error: "User not found." });
    const user = await db().prepare(`SELECT * FROM users WHERE id=?`).get(id);
    if (!user) return res.status(404).json({ error: "User not found." });
    const pack = await userStories(id, req.user.id, id === Number(req.user.id));
    res.json({
      user: pack.user || {
        id,
        username: user.username,
        name: user.name,
        avatar: firstAvatar(user.photos),
        isDemo: Boolean(user.is_demo),
        isMe: id === Number(req.user.id),
      },
      stories: pack.stories,
      hasActiveStory: pack.stories.length > 0,
    });
  });

  app.post("/api/stories", auth, (req, res) => {
    uploadStory.fields([
      { name: "media", maxCount: 1 },
      { name: "photo", maxCount: 1 },
      { name: "video", maxCount: 1 },
      { name: "poster", maxCount: 1 },
    ])(req, res, async (err) => {
      try {
        if (err) {
          const msg = err.code === "LIMIT_FILE_SIZE"
            ? "That file is too big for a story. Photos can be any size and we'll shrink them; videos need to be 15 seconds or less and under 8 MB."
            : (err.message || "Upload failed");
          return res.status(400).json({ error: msg });
        }
        const files = req.files || {};
        const file = (files.media && files.media[0])
          || (files.photo && files.photo[0])
          || (files.video && files.video[0])
          || req.file
          || null;
        const posterFile = (files.poster && files.poster[0]) || null;
        if (!file) return res.status(400).json({ error: "Add a photo or a short video to post a story." });

        const textOverlay = String((req.body && req.body.textOverlay) || (req.body && req.body.text) || "").trim().slice(0, MAX_STORY_TEXT);
        const storyBad = contentRejected(textOverlay);
        if (storyBad) return res.status(400).json({ error: storyBad });
        const eventId = String((req.body && req.body.eventId) || "").trim() || null;
        if (eventId) {
          const ev = await db().prepare(`SELECT id FROM events WHERE id=?`).get(eventId);
          if (!ev) return res.status(400).json({ error: "Unknown event." });
        }

        const cutoff = storyCutoffIso();
        const existing = await db().prepare(`SELECT COUNT(*) AS c FROM stories WHERE user_id=? AND created_at>=?`).get(req.user.id, cutoff);
        if (existing && Number(existing.c) >= MAX_ACTIVE_STORIES) {
          return res.status(400).json({ error: "You can have up to " + MAX_ACTIVE_STORIES + " stories at a time. Delete one or wait for an older one to expire." });
        }

        const imageMime = sniffImageMime(file.buffer);
        const videoMime = !imageMime && sniffVideoMime(file.buffer, file.originalname, file.mimetype);
        let kind = "photo";
        let mediaId;
        let posterId = null;

        if (imageMime) {
          let normalized;
          try {
            normalized = await normalizePhoto(file.buffer);
          } catch (normErr) {
            return res.status(normErr.status || 400).json({ error: normErr.message || "Couldn't process that photo." });
          }
          mediaId = await storeBuffer(req.user.id, normalized.buffer, normalized.mime, normalized.ext);
        } else if (videoMime) {
          if (file.size > MAX_STORY_VIDEO_BYTES) {
            return res.status(400).json({ error: "That video is over 8 MB. Try a shorter clip (15 seconds or less)." });
          }
          const ext = videoMime === "video/quicktime" ? ".mov" : (videoMime === "video/webm" ? ".webm" : ".mp4");
          kind = "video";
          mediaId = await storeBuffer(req.user.id, file.buffer, videoMime, ext);
          if (posterFile && sniffImageMime(posterFile.buffer)) {
            try {
              const normalized = await normalizePhoto(posterFile.buffer);
              posterId = await storeBuffer(req.user.id, normalized.buffer, normalized.mime, normalized.ext);
            } catch (_) { /* poster is optional */ }
          }
        } else {
          return res.status(400).json({ error: "Please choose a photo or a short video (.mov or .mp4, 15 seconds or less)." });
        }

        const createdAt = new Date().toISOString();
        const info = await db().prepare(
          `INSERT INTO stories (user_id, media_id, kind, poster_id, text_overlay, event_id, created_at) VALUES (?,?,?,?,?,?,?)`
        ).run(req.user.id, mediaId, kind, posterId, textOverlay, eventId, createdAt);
        const row = await db().prepare(
          `SELECT s.*, u.username, u.name, u.photos AS user_photos, u.is_demo
           FROM stories s JOIN users u ON u.id = s.user_id WHERE s.id=?`
        ).get(Number(info.lastInsertRowid));
        const story = await shapeStory(row, req.user.id, new Set(), true);
        res.json({ story });
      } catch (e) {
        res.status(500).json({ error: e.message || "Could not post that story." });
      }
    });
  });

  app.post("/api/stories/:id/view", auth, async (req, res) => {
    const id = Number(req.params.id);
    const cutoff = storyCutoffIso();
    const row = await db().prepare(`SELECT * FROM stories WHERE id=? AND created_at>=?`).get(id, cutoff);
    if (!row) return res.status(404).json({ error: "Story not found." });
    if (Number(row.user_id) === Number(req.user.id)) return res.json({ ok: true, viewed: true });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(Number(row.user_id))) return res.status(403).json({ error: "You can't view this story." });
    await db().prepare(
      `INSERT OR IGNORE INTO story_views (story_id, user_id, created_at) VALUES (?,?,?)`
    ).run(id, req.user.id, new Date().toISOString());
    res.json({ ok: true, viewed: true });
  });

  app.get("/api/stories/:id/viewers", auth, async (req, res) => {
    const id = Number(req.params.id);
    const row = await db().prepare(`SELECT * FROM stories WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ error: "Story not found." });
    if (Number(row.user_id) !== Number(req.user.id)) return res.status(403).json({ error: "You can only see viewers of your own stories." });
    const blocked = await blockedSet(req.user.id);
    const rows = await db().prepare(
      `SELECT u.*, v.created_at AS viewed_at
       FROM story_views v JOIN users u ON u.id = v.user_id
       WHERE v.story_id=? AND v.user_id!=?
       ORDER BY v.created_at DESC`
    ).all(id, req.user.id);
    const viewers = rows
      .filter((u) => !blocked.has(Number(u.id)))
      .map((u) => ({
        ...publicUser(u),
        avatar: firstAvatar(u.photos),
        viewedAt: u.viewed_at,
      }));
    res.json({ viewers });
  });

  app.delete("/api/stories/:id", auth, async (req, res) => {
    const id = Number(req.params.id);
    const row = await db().prepare(`SELECT * FROM stories WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ error: "Story not found." });
    if (Number(row.user_id) !== Number(req.user.id)) return res.status(403).json({ error: "You can only delete your own stories." });
    await db().prepare(`DELETE FROM story_views WHERE story_id=?`).run(id);
    await db().prepare(`DELETE FROM stories WHERE id=?`).run(id);
    await deleteMediaIfOrphan(row.media_id, req.user.id);
    await deleteMediaIfOrphan(row.poster_id, req.user.id);
    res.json({ ok: true });
  });

  app.post("/api/stories/:id/reply", auth, async (req, res) => {
    const id = Number(req.params.id);
    const text = String((req.body && req.body.text) || "").trim().slice(0, 1000);
    const replyBad = contentRejected(text);
    if (replyBad) return res.status(400).json({ error: replyBad });
    if (!text) return res.status(400).json({ error: "Message is empty." });
    const cutoff = storyCutoffIso();
    const row = await db().prepare(`SELECT * FROM stories WHERE id=? AND created_at>=?`).get(id, cutoff);
    if (!row) return res.status(404).json({ error: "Story not found." });
    const otherId = Number(row.user_id);
    if (otherId === Number(req.user.id)) return res.status(400).json({ error: "You can't reply to your own story." });
    if ((await blockedSet(req.user.id)).has(otherId)) return res.status(403).json({ error: "You can't message this person." });
    const a = Math.min(Number(req.user.id), otherId);
    const b = Math.max(Number(req.user.id), otherId);
    const match = await db().prepare(`SELECT * FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
    if (!match) return res.status(403).json({ error: "Match with them first to reply to their story.", code: "need_match" });
    const body = "Replied to your story: " + text;
    const info = await db().prepare(`INSERT INTO messages (match_id, from_id, text) VALUES (?,?,?)`).run(match.id, req.user.id, body);
    const msg = await db().prepare(`SELECT id, from_id as fromId, text, created_at as at FROM messages WHERE id=?`).get(Number(info.lastInsertRowid));
    if (typeof broadcastToUser === "function") {
      broadcastToUser(otherId, { type: "message", matchId: match.id, message: msg, from: publicUser(req.user) });
    }
    res.json({ message: msg, matchId: match.id });
  });

  function runCleanup() {
    if (!getDb()) return;
    cleanupExpired().catch((err) => console.error("story cleanup", err.message || err));
  }
  // Boot can take longer than 8s on a cold Neon compute; skip until the db is open.
  const wait = setInterval(() => {
    if (!getDb()) return;
    clearInterval(wait);
    runCleanup();
    setInterval(runCleanup, 60 * 60 * 1000).unref();
  }, 3000);
  wait.unref();

  return { cleanupExpired, mediaInUse, MAX_STORY_VIDEO_BYTES, MAX_STORY_VIDEO_SECONDS };
}

module.exports = { installStories };
