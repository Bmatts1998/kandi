"use strict";

const MAX_REPLIES_PER_DAY = 20;

const DEFAULT_REPLIES = [
  "Yesss, I'm so down. See you on the floor 🧡",
  "Hydrate, stretch, and find me by the rail?",
  "That energy is contagious. What's your go-to set right now?",
  "PLUR. I'm already claiming a little dance space for us.",
  "Okay I felt that. Kandi trade when we meet?",
  "If the lasers look like a spaceship landing, I'm already in the pit.",
  "Love that. I'll be bouncing between the stage and merch.",
  "Say less. I'll be the one with extra earplugs if you need one.",
  "Haha yes. Afters snacks are a sacred ritual — you in?",
  "The bass is going to hit. Text me when you're close to the venue?",
  "I'm hyped. Let's actually say hi this time, not just vibe from across the floor.",
  "That's the whole reason I still go. Can't wait.",
  "Yes! I'll save you a spot if I get there first.",
  "Heard. Bring good energy and a full water bottle.",
];

const EVENT_REPLIES = [
  (name) => `I'll be at ${name} too — want to meet by merch?`,
  (name) => `${name} is going to be a moment. I'll be on the floor if you want to find me.`,
  (name) => `Yesss, ${name}! Save me a little space on the rail?`,
  (name) => `Perfect, I'm going to ${name} as well. Look for me near the water refill?`,
];

function isDemoUser(u) {
  if (!u) return false;
  return Boolean(Number(u.is_demo)) || Boolean(u.isDemo);
}

function pickReply({ sharedEvent, lastTexts, rng = Math.random } = {}) {
  const eventName = sharedEvent && String(sharedEvent.name || "").trim();
  const pool = [];
  if (eventName) EVENT_REPLIES.forEach((fn) => pool.push(fn(eventName)));
  DEFAULT_REPLIES.forEach((t) => pool.push(t));
  const last = new Set((lastTexts || []).map((t) => String(t || "")));
  const fresh = pool.filter((t) => !last.has(t));
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(rng() * list.length)] || DEFAULT_REPLIES[0];
}

function createDemoChat({ getDb, publicUser, broadcastToUser, delayRange = [3000, 10000] }) {
  const pending = new Map();

  async function sharedUpcomingEvent(realId, demoId) {
    const today = new Date().toISOString().slice(0, 10);
    return getDb().prepare(`
      SELECT e.id, e.name, e.emoji, e.starts_at
      FROM event_going a
      JOIN event_going b ON a.event_id = b.event_id
      JOIN events e ON e.id = a.event_id
      WHERE a.user_id=? AND b.user_id=?
        AND COALESCE(e.status, 'active') != 'removed'
        AND COALESCE(e.is_example, 0) = 0
        AND (e.starts_at IS NULL OR e.starts_at = '' OR substr(e.starts_at, 1, 10) >= ?)
      ORDER BY CASE WHEN e.starts_at IS NULL OR e.starts_at = '' THEN 1 ELSE 0 END, e.starts_at ASC
      LIMIT 1
    `).get(realId, demoId, today);
  }

  async function sendReply({ matchId, fromUser, toUser }) {
    const db = getDb();
    const day = new Date().toISOString().slice(0, 10);
    const count = await db.prepare(
      `SELECT COUNT(*) AS c FROM messages WHERE match_id=? AND from_id=? AND substr(created_at, 1, 10)=?`
    ).get(matchId, toUser.id, day);
    if (Number(count && count.c) >= MAX_REPLIES_PER_DAY) return null;

    const last = await db.prepare(
      `SELECT from_id, text FROM messages WHERE match_id=? ORDER BY id DESC LIMIT 8`
    ).all(matchId);
    if (last[0] && Number(last[0].from_id) === Number(toUser.id)) return null;
    const lastTexts = last.filter((m) => Number(m.from_id) === Number(toUser.id)).map((m) => m.text);
    const ev = await sharedUpcomingEvent(fromUser.id, toUser.id);
    const text = pickReply({ sharedEvent: ev, lastTexts });
    const createdAt = new Date().toISOString();
    const info = await db.prepare(
      `INSERT INTO messages (match_id, from_id, text, created_at) VALUES (?,?,?,?)`
    ).run(matchId, toUser.id, text, createdAt);
    const msg = await db.prepare(
      `SELECT id, from_id as fromId, text, created_at as at FROM messages WHERE id=?`
    ).get(Number(info.lastInsertRowid));
    if (typeof broadcastToUser === "function") {
      broadcastToUser(fromUser.id, { type: "message", matchId, message: msg, from: publicUser(toUser) });
    }
    return msg;
  }

  function maybeReply({ matchId, fromUser, toUser, delayMs }) {
    if (!matchId || !fromUser || !toUser) return;
    if (isDemoUser(fromUser) || !isDemoUser(toUser)) return;
    if (Number(fromUser.id) === Number(toUser.id)) return;
    const key = String(matchId);
    if (pending.has(key)) return;
    const lo = delayRange[0];
    const hi = delayRange[1];
    const wait = delayMs != null ? delayMs : (lo + Math.floor(Math.random() * (hi - lo + 1)));
    const timer = setTimeout(() => {
      pending.delete(key);
      sendReply({ matchId, fromUser, toUser }).catch((err) => console.error("demo reply", err.message || err));
    }, Math.max(0, wait));
    pending.set(key, timer);
  }

  function cancelAll() {
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
  }

  return { maybeReply, sendReply, pickReply, cancelAll, pending, MAX_REPLIES_PER_DAY };
}

module.exports = { createDemoChat, pickReply, isDemoUser, DEFAULT_REPLIES, MAX_REPLIES_PER_DAY };
