"use strict";
const followRules = require("./follow-rules");

const crypto = require("crypto");
const { normalizePhoto, sniffImageMime, savePhotoFile, removePhotoFile } = require("./photo");
const { listUpcomingForProfile } = require("./meetup");
const { contentRejected } = require("./content-filter");
const { finishVideo } = require("./video");

const MAX_POST_PHOTOS = 10;

function sniffVideoMime(buf, name, typ) {
  typ = String(typ || "").toLowerCase();
  name = String(name || "").toLowerCase();
  if (typ.startsWith("video/")) return typ === "video/quicktime" ? "video/quicktime" : typ;
  if (buf && buf.length >= 12 && buf.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.slice(8, 12).toString("ascii");
    if (brand.startsWith("qt") || brand === "moov") return "video/quicktime";
    return "video/mp4";
  }
  if (name.endsWith(".mov") || name.endsWith(".qt")) return "video/quicktime";
  if (name.endsWith(".webm")) return "video/webm";
  if (name.endsWith(".mp4") || name.endsWith(".m4v")) return "video/mp4";
  return null;
}

function parseIds(raw) {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw || "[]") : raw || [];
    return Array.isArray(list) ? list.map(String).filter((x) => x && /^[\w.-]+$/.test(x)) : [];
  } catch (_) {
    return [];
  }
}

function parsePhotoIds(row) {
  let ids = parseIds(row.photo_ids);
  if (!ids.length) {
    ids = (row.photo_id ? [String(row.photo_id)] : []).concat(parseIds(row.extra_photos));
  }
  if (row.photo_id && !ids.includes(String(row.photo_id))) ids.unshift(String(row.photo_id));
  return [...new Set(ids.filter(Boolean))];
}

function postMediaIds(post) {
  const ids = parsePhotoIds(post);
  if (post.photo_id) ids.push(String(post.photo_id));
  if (post.video_id) ids.push(String(post.video_id));
  if (post.poster_id) ids.push(String(post.poster_id));
  return [...new Set(ids.filter(Boolean))];
}
const { popularScore: scoredPopular, followingRankTime, stripScoreFields } = require("./engagement");
const { normalizeGenreIds, publicGenres } = require("./genres");

function weekAgoIso() {
  return new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
}

function hoursAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 48;
  return Math.max(0, (Date.now() - t) / 3600000);
}

function popularScore(post) {
  return scoredPopular(post);
}

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

function authorBits(row) {
  const vibes = normalizeGenreIds(row.vibes || row.user_vibes || []);
  return {
    vibes,
    genres: publicGenres(vibes),
  };
}


function installFeed({ app, getDb, auth, upload, uploadPost, publicUser, blockedSet, maxVideoBytes, engagement }) {
  const bump = () => { if (engagement && typeof engagement.scheduleRefresh === "function") engagement.scheduleRefresh(); };
  function db() {
    return getDb();
  }
  const postUpload = uploadPost || upload;
  const videoCap = maxVideoBytes || 50 * 1024 * 1024;

  async function formatPost(row, meId, likedSet) {
    const ev = row.event_id
      ? await db().prepare(`SELECT id, name, emoji, city, venue, date_label, ticket_url, ticket_seller, address, time_tba, starts_at FROM events WHERE id=?`).get(row.event_id)
      : null;
    const liked = likedSet
      ? likedSet.has(Number(row.id))
      : Boolean(await db().prepare(`SELECT user_id FROM post_likes WHERE user_id=? AND post_id=?`).get(meId, row.id));
    const following = Number(row.user_id) === Number(meId)
      ? false
      : Boolean(await db().prepare(`SELECT follower_id FROM follows WHERE follower_id=? AND following_id=?`).get(meId, row.user_id));
    const canFollow = !following && Number(row.user_id) !== Number(meId) && await followRules.canFollowSimple(db(), meId, row.user_id);
    const photoIds = parsePhotoIds(row);
    const photoUrls = photoIds.map((id) => "/uploads/" + id);
    const posterUrl = row.poster_id ? "/uploads/" + row.poster_id : null;
    const videoUrl = row.video_id ? "/uploads/" + row.video_id : null;
    return {
      id: Number(row.id),
      caption: row.caption || "",
      photoUrl: photoUrls[0] || posterUrl || null,
      photoUrls,
      videoUrl,
      posterUrl,
      event: ev ? {
        id: ev.id,
        name: ev.name,
        emoji: ev.emoji,
        city: ev.city,
        venue: ev.venue,
        date: ev.date_label,
        ticketUrl: ev.ticket_url || "",
        ticketSeller: ev.ticket_seller || "",
        address: ev.address || "",
        timeTba: Boolean(Number(ev.time_tba)),
        startsAt: ev.starts_at || "",
        icsUrl: "/api/events/" + encodeURIComponent(ev.id) + ".ics",
        mapsUrl: ev.address ? ("https://maps.apple.com/?q=" + encodeURIComponent((ev.venue ? ev.venue + ", " : "") + ev.address)) : "",
      } : null,
      createdAt: row.created_at,
      likeCount: Number(row.like_count != null ? row.like_count : row.likeCount) || 0,
      commentCount: Number(row.comment_count != null ? row.comment_count : row.commentCount) || 0,
      liked,
      author: {
        id: Number(row.user_id),
        username: row.username,
        name: row.name,
        avatar: firstAvatar(row.user_photos),
        isDemo: Boolean(row.is_demo),
        following,
        canFollow,
        ...authorBits(row),
      },
      authorScore: Number(row.engagement_score) || 0,
    };
  }

  async function deleteOwnedFile(fileId, userId) {
    if (!fileId) return;
    const used = await db().prepare(
      `SELECT id FROM posts WHERE photo_id=? OR video_id=? OR poster_id=? OR (photo_ids IS NOT NULL AND photo_ids LIKE ?) LIMIT 1`
    ).get(fileId, fileId, fileId, "%" + fileId + "%");
    if (used) return;
    const row = await db().prepare(`SELECT user_id FROM photo_files WHERE id=?`).get(fileId);
    if (!row || Number(row.user_id) !== Number(userId)) return;
    await removePhotoFile(db(), fileId);
  }

  async function storeBuffer(userId, buffer, mime, ext) {
    return savePhotoFile(db(), { userId, buffer, mime, ext });
  }

  async function attachCounts(rows) {
    const out = [];
    for (const row of rows) {
      if (row.like_count == null && row.likeCount == null) {
        const likes = await db().prepare(`SELECT COUNT(*) AS c FROM post_likes WHERE post_id=?`).get(row.id);
        const comments = await db().prepare(`SELECT COUNT(*) AS c FROM comments WHERE post_id=?`).get(row.id);
        row.like_count = likes ? likes.c : 0;
        row.comment_count = comments ? comments.c : 0;
      }
      out.push(row);
    }
    return out;
  }

  async function likedSetFor(meId, postIds) {
    const set = new Set();
    if (!postIds.length) return set;
    for (const id of postIds) {
      const row = await db().prepare(`SELECT user_id FROM post_likes WHERE user_id=? AND post_id=?`).get(meId, id);
      if (row) set.add(Number(id));
    }
    return set;
  }

  async function shapePosts(rows, meId) {
    const withCounts = await attachCounts(rows);
    const liked = await likedSetFor(meId, withCounts.map((r) => r.id));
    const posts = [];
    for (const row of withCounts) posts.push(await formatPost(row, meId, liked));
    return posts;
  }

  const authorJoin = `
    SELECT p.*, u.username, u.name, u.photos AS user_photos, u.is_demo,
      u.active_raver, u.engagement_score, u.raver_badge, u.vibes,
      (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
    FROM posts p
    JOIN users u ON u.id = p.user_id
  `;

  app.get("/api/feed/following", auth, async (req, res) => {
    const blocked = await blockedSet(req.user.id);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const rows = await db().prepare(
      `${authorJoin}
       WHERE (p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR p.user_id=?)
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ?`
    ).all(req.user.id, req.user.id, limit);
    const visible = rows.filter((r) => !blocked.has(Number(r.user_id)));
    const posts = await shapePosts(visible, req.user.id);
    posts.sort((a, b) => followingRankTime(b) - followingRankTime(a) || Number(b.id) - Number(a.id));
    res.json({ posts: posts.map(stripScoreFields) });
  });

  app.get("/api/feed/popular", auth, async (req, res) => {
    const blocked = await blockedSet(req.user.id);
    const since = weekAgoIso();
    const rows = await db().prepare(
      `${authorJoin} WHERE p.created_at >= ?`
    ).all(since);
    const visible = rows.filter((r) => !blocked.has(Number(r.user_id)));
    const posts = await shapePosts(visible, req.user.id);
    posts.sort((a, b) => popularScore(b) - popularScore(a) || String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ posts: posts.slice(0, 40).map(stripScoreFields) });
  });

  // Photos and posts people shared from a specific show (event gallery).
  app.get("/api/events/:id/posts", auth, async (req, res) => {
    const blocked = await blockedSet(req.user.id);
    const rows = await db().prepare(`${authorJoin} WHERE p.event_id=? ORDER BY p.created_at DESC`).all(String(req.params.id));
    const visible = rows.filter((r) => !blocked.has(Number(r.user_id))).slice(0, 60);
    res.json({ posts: await shapePosts(visible, req.user.id) });
  });

  app.get("/api/feed/top-ravers", auth, async (req, res) => {
    const blocked = await blockedSet(req.user.id);
    const rows = await db().prepare(
      `SELECT u.id, u.username, u.name, u.photos, u.is_demo, u.active_raver, u.engagement_score, u.raver_badge, u.vibes,
         (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count
       FROM users u
       WHERE u.id != ?
         AND COALESCE(u.engagement_hidden, 0) = 0
         AND (COALESCE(u.engagement_score, 0) > 0 OR (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) > 0)
       ORDER BY COALESCE(u.engagement_score, 0) DESC, follower_count DESC, u.id ASC
       LIMIT 20`
    ).all(req.user.id);
    const people = [];
    for (const u of rows) {
      if (blocked.has(Number(u.id))) continue;
      if (Number(u.follower_count) < 1) continue;
      const following = Boolean(await db().prepare(`SELECT follower_id FROM follows WHERE follower_id=? AND following_id=?`).get(req.user.id, u.id));
      const canFollow = !following && await followRules.canFollowSimple(db(), req.user.id, u.id);
      people.push({
        id: Number(u.id),
        username: u.username,
        name: u.name,
        avatar: firstAvatar(u.photos),
        isDemo: Boolean(u.is_demo),
        followerCount: Number(u.follower_count) || 0,
        ...authorBits(u),
        following,
        canFollow,
      });
      if (people.length >= 12) break;
    }
    res.json({ people });
  });

  app.post("/api/posts", auth, (req, res) => {
    const fields = postUpload.fields([
      { name: "photo", maxCount: MAX_POST_PHOTOS },
      { name: "photos", maxCount: MAX_POST_PHOTOS },
      { name: "video", maxCount: 1 },
      { name: "poster", maxCount: 1 },
    ]);
    fields(req, res, async (err) => {
      try {
        if (err) {
          const msg = err.code === "LIMIT_FILE_SIZE"
            ? "That video didn't get shrunk before sending. Update Kandi (close and reopen it) and try again."
            : err.code === "LIMIT_UNEXPECTED_FILE" ? ("You can add up to " + MAX_POST_PHOTOS + " photos per post.")
            : (err.message || "Upload failed");
          return res.status(400).json({ error: msg });
        }
        const caption = String((req.body && req.body.caption) || "").trim().slice(0, 2000);
        const capBad = contentRejected(caption);
        if (capBad) return res.status(400).json({ error: capBad });
        const eventId = String((req.body && req.body.eventId) || "").trim() || null;
        const files = req.files || {};
        const imageFiles = [...(files.photos || []), ...(files.photo || [])].slice(0, MAX_POST_PHOTOS);
        const videoFile = (files.video && files.video[0]) || null;
        const posterFile = (files.poster && files.poster[0]) || null;
        if (!caption && !imageFiles.length && !videoFile) return res.status(400).json({ error: "Add a photo, a short video, a caption, or tag a rave." });
        if (eventId) {
          const ev = await db().prepare(`SELECT id FROM events WHERE id=?`).get(eventId);
          if (!ev) return res.status(400).json({ error: "Unknown event." });
        }
        let videoId = null;
        let posterId = null;
        const photoIds = [];
        if (videoFile) {
          if (videoFile.size > videoCap) {
            return res.status(400).json({ error: "That video didn't get shrunk before sending. Close and reopen Kandi, then try again." });
          }
          const room = await require("./storage-guard").videoUploadAllowed(db());
          if (!room.ok) return res.status(507).json({ error: room.error, code: "storage_full" });
          const mime = sniffVideoMime(videoFile.buffer, videoFile.originalname, videoFile.mimetype)
            || (sniffImageMime(videoFile.buffer) ? null : "video/mp4");
          if (!mime || !String(mime).startsWith("video/")) {
            return res.status(400).json({ error: "Please choose a short video (.mov or .mp4) or a photo." });
          }
          const done = await finishVideo(videoFile.buffer, mime, { maxSeconds: 60, wantPoster: !posterFile });
          if (done.tooLong) return res.status(400).json({ error: "Videos can be up to 60 seconds. Trim it in Photos and try again." });
          videoId = await storeBuffer(req.user.id, done.buffer, done.mime, done.ext);
          if (!posterFile && done.poster) {
            try { posterId = await storeBuffer(req.user.id, done.poster, "image/jpeg", ".jpg"); } catch (_) {}
          }
          if (posterFile) {
            try {
              const normalized = await normalizePhoto(posterFile.buffer);
              posterId = await storeBuffer(req.user.id, normalized.buffer, normalized.mime, normalized.ext);
            } catch (_) { /* poster is optional */ }
          }
        } else {
          for (const file of imageFiles) {
            try {
              const normalized = await normalizePhoto(file.buffer);
              photoIds.push(await storeBuffer(req.user.id, normalized.buffer, normalized.mime, normalized.ext));
            } catch (normErr) {
              return res.status(normErr.status || 400).json({ error: normErr.message || "Couldn't process one of those photos." });
            }
          }
        }
        const photoId = photoIds[0] || null;
        const createdAt = new Date().toISOString();
        const info = await db().prepare(
          `INSERT INTO posts (user_id, caption, photo_id, event_id, created_at, video_id, poster_id, photo_ids, extra_photos) VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(req.user.id, caption, photoId, eventId, createdAt, videoId, posterId, JSON.stringify(photoIds), JSON.stringify(photoIds.slice(1)));
        const row = await db().prepare(`${authorJoin} WHERE p.id=?`).get(Number(info.lastInsertRowid));
        const [post] = await shapePosts([row], req.user.id);
        bump();
        res.json({ post: stripScoreFields(post) });
      } catch (e) {
        res.status(e.status || 500).json({ error: e.message || "Could not post." });
      }
    });
  });

  app.get("/api/posts/:id", auth, async (req, res) => {
    const id = Number(req.params.id);
    const row = await db().prepare(`${authorJoin} WHERE p.id=?`).get(id);
    if (!row) return res.status(404).json({ error: "Post not found." });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(Number(row.user_id))) return res.status(404).json({ error: "Post not found." });
    const [post] = await shapePosts([row], req.user.id);
    res.json({ post });
  });

  app.delete("/api/posts/:id", auth, async (req, res) => {
    const post = await db().prepare(`SELECT * FROM posts WHERE id=?`).get(Number(req.params.id));
    if (!post) return res.status(404).json({ error: "Post not found." });
    if (Number(post.user_id) !== Number(req.user.id)) return res.status(403).json({ error: "You can only delete your own posts." });
    const media = postMediaIds(post);
    await db().prepare(`DELETE FROM post_likes WHERE post_id=?`).run(post.id);
    await db().prepare(`DELETE FROM comments WHERE post_id=?`).run(post.id);
    await db().prepare(`DELETE FROM posts WHERE id=?`).run(post.id);
    for (const fileId of media) {
      try { await deleteOwnedFile(fileId, req.user.id); } catch (_) { /* leftover media is ok */ }
    }
    bump();
    res.json({ ok: true });
  });

  app.post("/api/posts/:id/like", auth, async (req, res) => {
    const id = Number(req.params.id);
    const post = await db().prepare(`SELECT * FROM posts WHERE id=?`).get(id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(Number(post.user_id))) return res.status(403).json({ error: "You can't like this post." });
    await db().prepare(`INSERT OR IGNORE INTO post_likes (user_id, post_id, created_at) VALUES (?,?,?)`).run(
      req.user.id, id, new Date().toISOString()
    );
    const likes = await db().prepare(`SELECT COUNT(*) AS c FROM post_likes WHERE post_id=?`).get(id);
    bump();
    res.json({ ok: true, liked: true, likeCount: Number(likes.c) || 0 });
  });

  app.delete("/api/posts/:id/like", auth, async (req, res) => {
    const id = Number(req.params.id);
    await db().prepare(`DELETE FROM post_likes WHERE user_id=? AND post_id=?`).run(req.user.id, id);
    const likes = await db().prepare(`SELECT COUNT(*) AS c FROM post_likes WHERE post_id=?`).get(id);
    bump();
    res.json({ ok: true, liked: false, likeCount: Number(likes.c) || 0 });
  });

  app.get("/api/posts/:id/comments", auth, async (req, res) => {
    const id = Number(req.params.id);
    const post = await db().prepare(`SELECT * FROM posts WHERE id=?`).get(id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(Number(post.user_id))) return res.status(403).json({ error: "Post hidden." });
    const rows = await db().prepare(
      `SELECT c.*, u.username, u.name, u.photos AS user_photos, u.active_raver, u.raver_badge, u.vibes
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id=?
       ORDER BY c.created_at ASC, c.id ASC`
    ).all(id);
    res.json({
      comments: rows
        .filter((r) => !blocked.has(Number(r.user_id)))
        .map((r) => ({
          id: Number(r.id),
          text: r.text,
          createdAt: r.created_at,
          mine: Number(r.user_id) === Number(req.user.id),
          author: { id: Number(r.user_id), username: r.username, name: r.name, avatar: firstAvatar(r.user_photos), ...authorBits(r) },
        })),
    });
  });

  app.post("/api/posts/:id/comments", auth, async (req, res) => {
    const id = Number(req.params.id);
    const text = String(req.body.text || "").trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: "Write a comment." });
    const commentBad = contentRejected(text);
    if (commentBad) return res.status(400).json({ error: commentBad });
    const post = await db().prepare(`SELECT * FROM posts WHERE id=?`).get(id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(Number(post.user_id))) return res.status(403).json({ error: "You can't comment on this post." });
    const info = await db().prepare(
      `INSERT INTO comments (post_id, user_id, text, created_at) VALUES (?,?,?,?)`
    ).run(id, req.user.id, text, new Date().toISOString());
    bump();
    const row = await db().prepare(
      `SELECT c.*, u.username, u.name, u.photos AS user_photos, u.active_raver, u.raver_badge, u.vibes FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?`
    ).get(Number(info.lastInsertRowid));
    const count = await db().prepare(`SELECT COUNT(*) AS c FROM comments WHERE post_id=?`).get(id);
    res.json({
      comment: {
        id: Number(row.id),
        text: row.text,
        createdAt: row.created_at,
        mine: true,
        author: { id: Number(row.user_id), username: row.username, name: row.name, avatar: firstAvatar(row.user_photos), ...authorBits(row) },
      },
      commentCount: Number(count.c) || 0,
    });
  });

  app.delete("/api/comments/:id", auth, async (req, res) => {
    const row = await db().prepare(`SELECT * FROM comments WHERE id=?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Comment not found." });
    if (Number(row.user_id) !== Number(req.user.id)) return res.status(403).json({ error: "You can only delete your own comments." });
    await db().prepare(`DELETE FROM comments WHERE id=?`).run(row.id);
    bump();
    const count = await db().prepare(`SELECT COUNT(*) AS c FROM comments WHERE post_id=?`).get(row.post_id);
    res.json({ ok: true, postId: Number(row.post_id), commentCount: Number(count.c) || 0 });
  });

  app.post("/api/posts/:id/report", auth, async (req, res) => {
    const id = Number(req.params.id);
    const reason = String(req.body.reason || "Something else").slice(0, 200);
    const post = await db().prepare(`SELECT * FROM posts WHERE id=?`).get(id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    if (Number(post.user_id) === Number(req.user.id)) return res.status(400).json({ error: "You can't report your own post." });
    await db().prepare(`INSERT INTO reports (reporter_id, target_id, reason, post_id) VALUES (?,?,?,?)`).run(
      req.user.id, post.user_id, reason, id
    );
    await db().prepare(`INSERT OR IGNORE INTO blocks (user_id, blocked_id, reason) VALUES (?,?,?)`).run(
      req.user.id, post.user_id, reason
    );
    await followRules.removeFollowsBetween(db(), req.user.id, post.user_id);
    bump();
    res.json({ ok: true, blocked: true });
  });

  // Follow rule: mutual match, or the person's own share-link token (body.k). Blocks always win.
  app.post("/api/users/:id/follow", auth, async (req, res) => {
    const id = Number(req.params.id);
    if (!id || id === Number(req.user.id)) return res.status(400).json({ error: "You can't follow yourself." });
    const user = await db().prepare(`SELECT id, username, share_token, share_follow FROM users WHERE id=?`).get(id);
    if (!user) return res.status(404).json({ error: "User not found." });
    const already = await db().prepare(`SELECT follower_id FROM follows WHERE follower_id=? AND following_id=?`).get(req.user.id, id);
    if (already && !(await followRules.isBlockedEitherWay(db(), req.user.id, id))) {
      return res.json({ ok: true, following: true, ...(await followCounts(id)) });
    }
    const token = String((req.body && (req.body.k || req.body.token)) || "");
    const check = await followRules.checkFollow(db(), req.user, user, token);
    if (!check.ok) return res.status(check.status).json({ error: check.error, code: check.code });
    await db().prepare(`INSERT OR IGNORE INTO follows (follower_id, following_id, created_at, via) VALUES (?,?,?,?)`).run(
      req.user.id, id, new Date().toISOString(), check.via
    );
    const counts = await followCounts(id);
    bump();
    res.json({ ok: true, following: true, ...counts });
  });

  app.delete("/api/users/:id/follow", auth, async (req, res) => {
    const id = Number(req.params.id);
    await db().prepare(`DELETE FROM follows WHERE follower_id=? AND following_id=?`).run(req.user.id, id);
    const counts = await followCounts(id);
    bump();
    res.json({ ok: true, following: false, ...counts });
  });

  async function followCounts(userId) {
    const followers = await db().prepare(`SELECT COUNT(*) AS c FROM follows WHERE following_id=?`).get(userId);
    const following = await db().prepare(`SELECT COUNT(*) AS c FROM follows WHERE follower_id=?`).get(userId);
    return { followerCount: Number(followers.c) || 0, followingCount: Number(following.c) || 0 };
  }

  app.get("/api/users/:id", auth, async (req, res) => {
    const id = Number(req.params.id);
    const user = await db().prepare(`SELECT * FROM users WHERE id=?`).get(id);
    if (!user) return res.status(404).json({ error: "User not found." });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(id) && id !== Number(req.user.id)) return res.status(404).json({ error: "User not found." });
    const counts = await followCounts(id);
    const following = id !== Number(req.user.id) && Boolean(
      await db().prepare(`SELECT follower_id FROM follows WHERE follower_id=? AND following_id=?`).get(req.user.id, id)
    );
    const matched = id !== Number(req.user.id) && await followRules.isMutualMatch(db(), req.user.id, id);
    const canFollow = !following && matched;
    const rows = await db().prepare(`${authorJoin} WHERE p.user_id=? ORDER BY p.created_at DESC, p.id DESC LIMIT 60`).all(id);
    const upcoming = await listUpcomingForProfile(db(), user, req.user);
    res.json({
      user: publicUser(user, { ...counts, following, canFollow, matched, isMe: id === Number(req.user.id), upcomingShows: upcoming.hidden ? [] : upcoming.shows, upcomingHidden: upcoming.hidden }),
      posts: await shapePosts(rows, req.user.id),
      upcomingShows: upcoming.hidden ? [] : upcoming.shows,
      upcomingHidden: upcoming.hidden,
    });
  });
}

module.exports = { installFeed, weekAgoIso, popularScore };
