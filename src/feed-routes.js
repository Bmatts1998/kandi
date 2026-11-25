"use strict";

function weekAgoIso() {
  return new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
}

function hoursAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 48;
  return Math.max(0, (Date.now() - t) / 3600000);
}

function popularScore(post) {
  const likes = Number(post.likeCount) || 0;
  const comments = Number(post.commentCount) || 0;
  return (likes * 2 + comments * 3) / Math.pow(hoursAgo(post.createdAt) + 2, 1.2);
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

function installFeed({ app, getDb, auth, upload, publicUser, blockedSet }) {
  function db() {
    return getDb();
  }

  async function formatPost(row, meId, likedSet) {
    const ev = row.event_id
      ? await db().prepare(`SELECT id, name, emoji, city FROM events WHERE id=?`).get(row.event_id)
      : null;
    const liked = likedSet
      ? likedSet.has(Number(row.id))
      : Boolean(await db().prepare(`SELECT user_id FROM post_likes WHERE user_id=? AND post_id=?`).get(meId, row.id));
    const following = Number(row.user_id) === Number(meId)
      ? false
      : Boolean(await db().prepare(`SELECT follower_id FROM follows WHERE follower_id=? AND following_id=?`).get(meId, row.user_id));
    return {
      id: Number(row.id),
      caption: row.caption || "",
      photoUrl: row.photo_id ? "/uploads/" + row.photo_id : null,
      event: ev ? { id: ev.id, name: ev.name, emoji: ev.emoji, city: ev.city } : null,
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
      },
    };
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
    res.json({ posts: await shapePosts(visible, req.user.id) });
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
    res.json({ posts: posts.slice(0, 40) });
  });

  app.get("/api/feed/top-ravers", auth, async (req, res) => {
    const blocked = await blockedSet(req.user.id);
    const rows = await db().prepare(
      `SELECT u.id, u.username, u.name, u.photos, u.is_demo,
         (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count
       FROM users u
       WHERE u.id != ?
       ORDER BY follower_count DESC, u.id ASC
       LIMIT 20`
    ).all(req.user.id);
    const people = [];
    for (const u of rows) {
      if (blocked.has(Number(u.id))) continue;
      if (Number(u.follower_count) < 1) continue;
      const following = Boolean(await db().prepare(`SELECT follower_id FROM follows WHERE follower_id=? AND following_id=?`).get(req.user.id, u.id));
      people.push({
        id: Number(u.id),
        username: u.username,
        name: u.name,
        avatar: firstAvatar(u.photos),
        isDemo: Boolean(u.is_demo),
        followerCount: Number(u.follower_count) || 0,
        following,
      });
      if (people.length >= 12) break;
    }
    res.json({ people });
  });

  app.post("/api/posts", auth, (req, res) => {
    upload.single("photo")(req, res, async (err) => {
      try {
        if (err) return res.status(400).json({ error: err.message || "Upload failed" });
        const caption = String((req.body && req.body.caption) || "").trim().slice(0, 2000);
        const eventId = String((req.body && req.body.eventId) || "").trim() || null;
        if (!caption && !req.file) return res.status(400).json({ error: "Add a photo or a caption." });
        if (eventId) {
          const ev = await db().prepare(`SELECT id FROM events WHERE id=?`).get(eventId);
          if (!ev) return res.status(400).json({ error: "Unknown event." });
        }
        let photoId = null;
        if (req.file) {
          const ext = require("path").extname(req.file.originalname || "").toLowerCase() || ".jpg";
          const safe = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
          photoId = `${Date.now()}-${require("crypto").randomBytes(6).toString("hex")}${safe}`;
          const mime = req.file.mimetype || "image/jpeg";
          await db().prepare(`INSERT INTO photo_files (id, user_id, mime, data) VALUES (?,?,?,?)`).run(
            photoId, req.user.id, mime, req.file.buffer.toString("base64")
          );
        }
        const createdAt = new Date().toISOString();
        const info = await db().prepare(
          `INSERT INTO posts (user_id, caption, photo_id, event_id, created_at) VALUES (?,?,?,?,?)`
        ).run(req.user.id, caption, photoId, eventId, createdAt);
        const row = await db().prepare(`${authorJoin} WHERE p.id=?`).get(Number(info.lastInsertRowid));
        const [post] = await shapePosts([row], req.user.id);
        res.json({ post });
      } catch (e) {
        res.status(500).json({ error: e.message || "Could not post." });
      }
    });
  });

  app.delete("/api/posts/:id", auth, async (req, res) => {
    const post = await db().prepare(`SELECT * FROM posts WHERE id=?`).get(Number(req.params.id));
    if (!post) return res.status(404).json({ error: "Post not found." });
    if (Number(post.user_id) !== Number(req.user.id)) return res.status(403).json({ error: "You can only delete your own posts." });
    await db().prepare(`DELETE FROM post_likes WHERE post_id=?`).run(post.id);
    await db().prepare(`DELETE FROM comments WHERE post_id=?`).run(post.id);
    await db().prepare(`DELETE FROM posts WHERE id=?`).run(post.id);
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
    res.json({ ok: true, liked: true, likeCount: Number(likes.c) || 0 });
  });

  app.delete("/api/posts/:id/like", auth, async (req, res) => {
    const id = Number(req.params.id);
    await db().prepare(`DELETE FROM post_likes WHERE user_id=? AND post_id=?`).run(req.user.id, id);
    const likes = await db().prepare(`SELECT COUNT(*) AS c FROM post_likes WHERE post_id=?`).get(id);
    res.json({ ok: true, liked: false, likeCount: Number(likes.c) || 0 });
  });

  app.get("/api/posts/:id/comments", auth, async (req, res) => {
    const id = Number(req.params.id);
    const post = await db().prepare(`SELECT * FROM posts WHERE id=?`).get(id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(Number(post.user_id))) return res.status(403).json({ error: "Post hidden." });
    const rows = await db().prepare(
      `SELECT c.*, u.username, u.name, u.photos AS user_photos
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
          author: { id: Number(r.user_id), username: r.username, name: r.name, avatar: firstAvatar(r.user_photos) },
        })),
    });
  });

  app.post("/api/posts/:id/comments", auth, async (req, res) => {
    const id = Number(req.params.id);
    const text = String(req.body.text || "").trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: "Write a comment." });
    const post = await db().prepare(`SELECT * FROM posts WHERE id=?`).get(id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(Number(post.user_id))) return res.status(403).json({ error: "You can't comment on this post." });
    const info = await db().prepare(
      `INSERT INTO comments (post_id, user_id, text, created_at) VALUES (?,?,?,?)`
    ).run(id, req.user.id, text, new Date().toISOString());
    const row = await db().prepare(
      `SELECT c.*, u.username, u.name, u.photos AS user_photos FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?`
    ).get(Number(info.lastInsertRowid));
    const count = await db().prepare(`SELECT COUNT(*) AS c FROM comments WHERE post_id=?`).get(id);
    res.json({
      comment: {
        id: Number(row.id),
        text: row.text,
        createdAt: row.created_at,
        mine: true,
        author: { id: Number(row.user_id), username: row.username, name: row.name, avatar: firstAvatar(row.user_photos) },
      },
      commentCount: Number(count.c) || 0,
    });
  });

  app.delete("/api/comments/:id", auth, async (req, res) => {
    const row = await db().prepare(`SELECT * FROM comments WHERE id=?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Comment not found." });
    if (Number(row.user_id) !== Number(req.user.id)) return res.status(403).json({ error: "You can only delete your own comments." });
    await db().prepare(`DELETE FROM comments WHERE id=?`).run(row.id);
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
    res.json({ ok: true, blocked: true });
  });

  app.post("/api/users/:id/follow", auth, async (req, res) => {
    const id = Number(req.params.id);
    if (!id || id === Number(req.user.id)) return res.status(400).json({ error: "You can't follow yourself." });
    const user = await db().prepare(`SELECT id FROM users WHERE id=?`).get(id);
    if (!user) return res.status(404).json({ error: "User not found." });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(id)) return res.status(403).json({ error: "You can't follow this person." });
    await db().prepare(`INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?,?,?)`).run(
      req.user.id, id, new Date().toISOString()
    );
    const counts = await followCounts(id);
    res.json({ ok: true, following: true, ...counts });
  });

  app.delete("/api/users/:id/follow", auth, async (req, res) => {
    const id = Number(req.params.id);
    await db().prepare(`DELETE FROM follows WHERE follower_id=? AND following_id=?`).run(req.user.id, id);
    const counts = await followCounts(id);
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
    const rows = await db().prepare(`${authorJoin} WHERE p.user_id=? ORDER BY p.created_at DESC, p.id DESC LIMIT 60`).all(id);
    res.json({
      user: publicUser(user, { ...counts, following, isMe: id === Number(req.user.id) }),
      posts: await shapePosts(rows, req.user.id),
    });
  });
}

module.exports = { installFeed, weekAgoIso, popularScore };
