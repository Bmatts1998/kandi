"use strict";

const { resolveEvent, setRsvp } = require("./meetup");

function publicShowCard(e) {
  if (!e) return null;
  return {
    id: e.id,
    name: e.name,
    date: e.date_label || e.date || "",
    startsAt: e.starts_at || e.startsAt || "",
    venue: e.venue || "",
    city: e.city || "",
    address: e.address || "",
    emoji: e.emoji || "",
    color: e.color || "",
    category: e.category || "concert",
    imageUrl: e.image_url || e.imageUrl || "",
    artists: Array.isArray(e.artists) ? e.artists : (typeof e.artists === "string" ? (function () { try { const v = JSON.parse(e.artists || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } })() : []),
    ageLimit: e.age_limit || e.ageLimit || "",
    eventKey: e.event_key || e.eventKey || "",
  };
}

function encodeInvite(payload) {
  return JSON.stringify({
    v: 1,
    eventId: String(payload.eventId || ""),
    eventKey: String(payload.eventKey || ""),
    name: String(payload.name || "Show").slice(0, 160),
    date: String(payload.date || "").slice(0, 80),
    venue: String(payload.venue || "").slice(0, 120),
    city: String(payload.city || "").slice(0, 80),
    emoji: String(payload.emoji || "").slice(0, 16),
    status: payload.status === "in" || payload.status === "out" ? payload.status : "pending",
  });
}

function parseInvite(text) {
  try {
    const data = JSON.parse(String(text || ""));
    if (!data || !data.eventId) return null;
    return {
      eventId: String(data.eventId),
      eventKey: String(data.eventKey || ""),
      name: String(data.name || "Show"),
      date: String(data.date || ""),
      venue: String(data.venue || ""),
      city: String(data.city || ""),
      emoji: String(data.emoji || ""),
      status: data.status === "in" || data.status === "out" ? data.status : "pending",
    };
  } catch (_) {
    return null;
  }
}

function findMatch(db, myId, otherId) {
  const a = Number(myId) < Number(otherId) ? Number(myId) : Number(otherId);
  const b = Number(myId) < Number(otherId) ? Number(otherId) : Number(myId);
  return db.prepare(`SELECT * FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
}

const inviteHits = new Map();
function rateOk(key, max, windowMs) {
  const now = Date.now();
  const list = (inviteHits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) return false;
  list.push(now);
  inviteHits.set(key, list);
  if (inviteHits.size > 5000) inviteHits.clear();
  return true;
}

function installShowInvites({ app, getDb, auth, publicUser, blockedSet, broadcastToUser, getUserFromReq }) {
  const db = () => getDb();

  app.get("/api/shows/:id", async (req, res) => {
    const ip = String(req.ip || "");
    if (!rateOk("show:" + ip, 60, 60000)) return res.status(429).json({ error: "Too many tries. Try again in a minute." });
    const ev = await resolveEvent(db(), req.params.id);
    if (!ev || ev.is_example || String(ev.status || "active") === "removed") {
      return res.status(404).json({ error: "That show link isn't working anymore." });
    }
    let signedIn = false;
    try {
      const me = getUserFromReq ? await getUserFromReq(req) : null;
      signedIn = Boolean(me);
    } catch (_) {}
    res.json({ show: publicShowCard(ev), signedIn });
  });

  app.post("/api/events/:id/invite", auth, async (req, res) => {
    if (!rateOk("inv:" + req.user.id, 30, 3600000)) {
      return res.status(429).json({ error: "That's a lot of invites. Try again in a bit." });
    }
    const ev = await resolveEvent(db(), req.params.id);
    if (!ev || ev.is_example || String(ev.status || "active") === "removed") {
      return res.status(404).json({ error: "Event not found." });
    }
    const otherId = Number(req.body && (req.body.userId || req.body.toId));
    if (!Number.isInteger(otherId) || otherId === Number(req.user.id)) {
      return res.status(400).json({ error: "Pick someone you've matched with." });
    }
    if ((await blockedSet(req.user.id)).has(otherId)) {
      return res.status(403).json({ error: "You can't invite this person." });
    }
    const match = await findMatch(db(), req.user.id, otherId);
    if (!match) return res.status(403).json({ error: "You can only invite people you've matched with." });

    const existing = await db().prepare(
      `SELECT id, text FROM messages WHERE match_id=? AND attach_type='show_invite' ORDER BY id DESC LIMIT 20`
    ).all(match.id);
    for (const row of existing) {
      const inv = parseInvite(row.text);
      if (inv && inv.eventId === String(ev.id) && inv.status === "pending") {
        return res.status(409).json({ error: "You already invited them to this show." });
      }
    }

    const payload = encodeInvite({
      eventId: ev.id,
      eventKey: ev.event_key || ev.eventKey || "",
      name: ev.name,
      date: ev.date_label || ev.date || "",
      venue: ev.venue || "",
      city: ev.city || "",
      emoji: ev.emoji || "",
      status: "pending",
    });
    const info = await db().prepare(
      `INSERT INTO messages (match_id, from_id, text, attach_type, media_id, duration, mime, link_url, waveform, poster_id, disappear, read_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(match.id, req.user.id, payload, "show_invite", "", 0, "", String(ev.id), "", "", 0, "");
    const row = await db().prepare(`SELECT * FROM messages WHERE id=?`).get(Number(info.lastInsertRowid));
    const { publicMessage } = require("./chat-media");
    const msg = publicMessage(row);
    const other = await db().prepare(`SELECT * FROM users WHERE id=?`).get(otherId);
    broadcastToUser(otherId, { type: "message", matchId: match.id, message: msg, from: publicUser(req.user) });
    res.json({ ok: true, message: msg, to: other ? { id: other.id, name: other.name, username: other.username } : { id: otherId } });
  });

  app.post("/api/events/invites/:messageId/respond", auth, async (req, res) => {
    const id = Number(req.params.messageId);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invite not found." });
    const row = await db().prepare(`SELECT * FROM messages WHERE id=? AND attach_type='show_invite'`).get(id);
    if (!row) return res.status(404).json({ error: "Invite not found." });
    const match = await db().prepare(`SELECT * FROM matches WHERE id=?`).get(row.match_id);
    if (!match) return res.status(404).json({ error: "Invite not found." });
    const inMatch = Number(req.user.id) === Number(match.a_id) || Number(req.user.id) === Number(match.b_id);
    if (!inMatch || Number(row.from_id) === Number(req.user.id)) {
      return res.status(403).json({ error: "Only the person you invited can respond." });
    }
    const inv = parseInvite(row.text);
    if (!inv) return res.status(400).json({ error: "Invite not found." });
    if (inv.status !== "pending") {
      return res.status(409).json({ error: "This invite was already answered." });
    }
    const answer = String((req.body && (req.body.response || req.body.answer)) || "").toLowerCase();
    const status = answer === "in" || answer === "yes" ? "in" : (answer === "out" || answer === "no" ? "out" : "");
    if (!status) return res.status(400).json({ error: "Choose I'm in or Maybe not." });

    let going = null;
    if (status === "in") {
      const ev = await resolveEvent(db(), inv.eventId) || (inv.eventKey ? await resolveEvent(db(), inv.eventKey) : null);
      if (!ev) return res.status(404).json({ error: "That show isn't listed anymore." });
      going = await setRsvp(db(), req.user, ev, { going: true });
    }
    const next = encodeInvite({ ...inv, status });
    await db().prepare(`UPDATE messages SET text=? WHERE id=?`).run(next, row.id);
    const updated = await db().prepare(`SELECT * FROM messages WHERE id=?`).get(row.id);
    const { publicMessage } = require("./chat-media");
    const msg = publicMessage(updated);
    const payload = { type: "message-update", matchId: match.id, message: msg };
    broadcastToUser(match.a_id, payload);
    broadcastToUser(match.b_id, payload);
    res.json({ ok: true, message: msg, going });
  });
}

module.exports = { installShowInvites, parseInvite, encodeInvite, publicShowCard };
