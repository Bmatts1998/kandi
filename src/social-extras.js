"use strict";

// Hinge/Instagram-style plumbing: activity notifications, unread chat counts,
// unmatch, and "We met". Kept separate so the other feature modules stay untouched.

function toMs(v) {
  if (!v) return 0;
  let s = String(v).trim();
  if (!s.includes("T")) s = s.replace(" ", "T");
  if (/[+-]\d\d$/.test(s)) s += ":00";
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += "Z";
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function installSocialExtras({ app, getDb, auth, publicUser, blockedSet, broadcastToUser }) {
  const db = () => getDb();
  let ready = null;
  function ensureTables() {
    if (!ready) {
      ready = (async () => {
        const stmts = [
          `CREATE TABLE IF NOT EXISTS chat_reads (user_id INTEGER NOT NULL, match_id INTEGER NOT NULL, last_read_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, match_id))`,
          `CREATE TABLE IF NOT EXISTS notif_seen (user_id INTEGER PRIMARY KEY, seen_at TEXT)`,
          `CREATE TABLE IF NOT EXISTS we_met (user_id INTEGER NOT NULL, other_id INTEGER NOT NULL, answer TEXT NOT NULL, created_at TEXT, PRIMARY KEY (user_id, other_id))`,
        ];
        for (const sql of stmts) await db().exec(sql);
      })().catch((err) => { ready = null; throw err; });
    }
    return ready;
  }
  const pair = (a, b) => (a < b ? [a, b] : [b, a]);
  async function matchBetween(me, other) {
    const [a, b] = pair(Number(me), Number(other));
    return db().prepare(`SELECT * FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
  }

  async function unreadFor(meId) {
    await ensureTables();
    const blocked = await blockedSet(meId);
    const matches = await db().prepare(`SELECT * FROM matches WHERE a_id=? OR b_id=?`).all(meId, meId);
    const byUser = {};
    let total = 0;
    for (const m of matches) {
      const other = Number(m.a_id) === Number(meId) ? Number(m.b_id) : Number(m.a_id);
      if (blocked.has(other)) continue;
      const r = await db().prepare(`SELECT last_read_id FROM chat_reads WHERE user_id=? AND match_id=?`).get(meId, m.id);
      const row = await db().prepare(`SELECT COUNT(*) AS c FROM messages WHERE match_id=? AND from_id != ? AND id > ?`).get(m.id, meId, r ? Number(r.last_read_id) : 0);
      const n = row ? Number(row.c) : 0;
      if (n) { byUser[other] = n; total += n; }
    }
    return { total, byUser };
  }

  app.get("/api/chat/unread", auth, async (req, res) => {
    res.json(await unreadFor(req.user.id));
  });

  app.post("/api/chats/:userId/read", auth, async (req, res) => {
    await ensureTables();
    const m = await matchBetween(req.user.id, req.params.userId);
    if (!m) return res.json({ ok: true });
    const last = await db().prepare(`SELECT MAX(id) AS id FROM messages WHERE match_id=?`).get(m.id);
    const lastId = last && last.id ? Number(last.id) : 0;
    await db().prepare(`DELETE FROM chat_reads WHERE user_id=? AND match_id=?`).run(req.user.id, m.id);
    await db().prepare(`INSERT INTO chat_reads (user_id, match_id, last_read_id) VALUES (?,?,?)`).run(req.user.id, m.id, lastId);
    res.json({ ok: true, unread: await unreadFor(req.user.id) });
  });

  app.post("/api/matches/:userId/unmatch", auth, async (req, res) => {
    const other = Number(req.params.userId);
    const m = await matchBetween(req.user.id, other);
    if (m) {
      await db().prepare(`DELETE FROM messages WHERE match_id=?`).run(m.id);
      try { await db().prepare(`DELETE FROM chat_reads WHERE match_id=?`).run(m.id); } catch (_) {}
      await db().prepare(`DELETE FROM matches WHERE id=?`).run(m.id);
    }
    await db().prepare(`DELETE FROM likes WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)`).run(req.user.id, other, other, req.user.id);
    try { await db().prepare(`INSERT OR IGNORE INTO passes (from_id, to_id) VALUES (?,?)`).run(req.user.id, other); } catch (_) {}
    broadcastToUser(other, { type: "unmatch", userId: req.user.id });
    res.json({ ok: true });
  });

  app.post("/api/matches/:userId/we-met", auth, async (req, res) => {
    await ensureTables();
    const other = Number(req.params.userId);
    const answer = ["yes", "no"].includes(String(req.body.answer)) ? String(req.body.answer) : null;
    if (!answer) return res.status(400).json({ error: "Answer yes or no." });
    if (!(await matchBetween(req.user.id, other))) return res.status(404).json({ error: "You're not matched with this person." });
    await db().prepare(`DELETE FROM we_met WHERE user_id=? AND other_id=?`).run(req.user.id, other);
    await db().prepare(`INSERT INTO we_met (user_id, other_id, answer, created_at) VALUES (?,?,?,?)`).run(req.user.id, other, answer, new Date().toISOString());
    res.json({ ok: true, answer });
  });

  app.get("/api/matches/:userId/we-met", auth, async (req, res) => {
    await ensureTables();
    const row = await db().prepare(`SELECT answer FROM we_met WHERE user_id=? AND other_id=?`).get(req.user.id, Number(req.params.userId));
    res.json({ answer: row ? row.answer : null });
  });

  async function users(ids) {
    const map = new Map();
    for (const id of new Set(ids.map(Number))) {
      if (map.has(id)) continue;
      const u = await db().prepare(`SELECT * FROM users WHERE id=?`).get(id);
      if (u) map.set(id, publicUser(u));
    }
    return map;
  }

  app.get("/api/notifications", auth, async (req, res) => {
    await ensureTables();
    const me = Number(req.user.id);
    const plus = req.user.subscription === "plus" || req.user.subscription === "vip";
    const blocked = await blockedSet(me);
    const items = [];
    const likes = await db().prepare(`SELECT * FROM likes WHERE to_id=? ORDER BY id DESC LIMIT 40`).all(me);
    for (const l of likes) items.push({ kind: "like", fromId: Number(l.from_id), at: l.created_at, targetType: l.target_type, comment: l.comment || "" });
    const matches = await db().prepare(`SELECT * FROM matches WHERE a_id=? OR b_id=? ORDER BY id DESC LIMIT 40`).all(me, me);
    for (const m of matches) items.push({ kind: "match", fromId: Number(m.a_id) === me ? Number(m.b_id) : Number(m.a_id), at: m.created_at });
    const pl = await db().prepare(`SELECT pl.user_id, pl.post_id, pl.created_at FROM post_likes pl JOIN posts p ON p.id=pl.post_id WHERE p.user_id=? AND pl.user_id != ? ORDER BY pl.created_at DESC LIMIT 40`).all(me, me);
    for (const r of pl) items.push({ kind: "post_like", fromId: Number(r.user_id), at: r.created_at, postId: Number(r.post_id) });
    const cm = await db().prepare(`SELECT c.user_id, c.post_id, c.text, c.created_at FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.user_id=? AND c.user_id != ? ORDER BY c.id DESC LIMIT 40`).all(me, me);
    for (const r of cm) items.push({ kind: "comment", fromId: Number(r.user_id), at: r.created_at, postId: Number(r.post_id), text: String(r.text || "").slice(0, 120) });
    const fl = await db().prepare(`SELECT follower_id, created_at FROM follows WHERE following_id=? ORDER BY created_at DESC LIMIT 40`).all(me);
    for (const r of fl) items.push({ kind: "follow", fromId: Number(r.follower_id), at: r.created_at });
    const unread = await unreadFor(me);
    const visible = items.filter((it) => !blocked.has(it.fromId));
    visible.forEach((it) => { it.ts = toMs(it.at); });
    visible.sort((a, b) => b.ts - a.ts);
    const top = visible.slice(0, 60);
    const people = await users(top.map((it) => it.fromId));
    const seen = await db().prepare(`SELECT seen_at FROM notif_seen WHERE user_id=?`).get(me);
    const seenMs = seen ? toMs(seen.seen_at) : 0;
    const out = top.map((it) => {
      const hidden = it.kind === "like" && !plus; // Hinge-style: who liked you is a Kandi+ perk
      const u = people.get(it.fromId);
      return {
        kind: it.kind,
        at: it.ts ? new Date(it.ts).toISOString() : null,
        unread: it.ts > seenMs,
        postId: it.postId || null,
        targetType: it.targetType || null,
        text: hidden ? "" : (it.text || it.comment || ""),
        user: hidden || !u ? null : { id: u.id, name: u.name, username: u.username, photos: (u.photos || []).slice(0, 1) },
      };
    }).filter((n) => n.user || n.kind === "like");
    res.json({ notifications: out, unreadCount: out.filter((n) => n.unread).length, unreadMessages: unread.total, unreadByUser: unread.byUser });
  });

  app.post("/api/notifications/seen", auth, async (req, res) => {
    await ensureTables();
    await db().prepare(`DELETE FROM notif_seen WHERE user_id=?`).run(req.user.id);
    await db().prepare(`INSERT INTO notif_seen (user_id, seen_at) VALUES (?,?)`).run(req.user.id, new Date().toISOString());
    res.json({ ok: true });
  });

  return { unreadFor, ensureTables };
}

module.exports = { installSocialExtras, toMs };
