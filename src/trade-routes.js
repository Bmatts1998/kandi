"use strict";

// Digital kandi trades: two people meet, exchange a designed bracelet,
// and keep it on their profiles. Free for everyone (including iOS).

const crypto = require("crypto");
const { contentRejected } = require("./content-filter");
const KD = require("./kandi-design");
const { eventIsOver, overAtIso } = require("./event-end");
const { parseDesign, parseStoredDesign, extraFromDesign, parseExtra } = KD;

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const OFFER_TTL_MS = 15 * 60 * 1000;
const WORD_MAX = 8;
const MESSAGE_MAX = 140;
const TZ = "America/Denver";


function newId(prefix) {
  return prefix + crypto.randomBytes(12).toString("hex");
}

function makeCode() {
  const buf = crypto.randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return s;
}

function cleanCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function isoNow() {
  return new Date().toISOString();
}

function dayStamp(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return y + "-" + m + "-" + d;
}

function parseInstant(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function eventHappensOn(ev, day, tz) {
  if (!ev) return false;
  const zone = tz || TZ;
  const startMs = parseInstant(ev.starts_at || ev.startsAt);
  const endMs = parseInstant(ev.ends_at || ev.endsAt);
  if (startMs == null && endMs == null) return false;
  const startDay = startMs != null ? dayStamp(new Date(startMs), zone) : dayStamp(new Date(endMs), zone);
  let endDay;
  if (endMs != null) endDay = dayStamp(new Date(endMs), zone);
  else endDay = dayStamp(new Date(startMs + 8 * 3600 * 1000), zone);
  return startDay <= day && day <= endDay;
}

function compactEvent(ev) {
  if (!ev) return null;
  return {
    id: ev.id,
    name: ev.name || "",
    venue: ev.venue || "",
    city: ev.city || "",
    dateLabel: ev.date_label || ev.dateLabel || "",
    startsAt: ev.starts_at || ev.startsAt || "",
    endsAt: ev.ends_at || ev.endsAt || "",
    emoji: ev.emoji || "",
    overAt: overAtIso(ev),
    isPast: eventIsOver(ev),
  };
}

function clipWord(raw) {
  const s = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9&!?+]/g, "")
    .slice(0, WORD_MAX);
  return s;
}

function clipMessage(raw) {
  return String(raw || "").trim().slice(0, MESSAGE_MAX);
}

function hexColor(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  return m ? "#" + m[1].toLowerCase() : null;
}

async function migrateTrades(db) {
  const offers = `CREATE TABLE IF NOT EXISTS trade_offers (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    host_id INTEGER NOT NULL,
    guest_id INTEGER,
    event_id TEXT DEFAULT '',
    event_name TEXT DEFAULT '',
    event_venue TEXT DEFAULT '',
    event_date TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    host_design TEXT DEFAULT '',
    guest_design TEXT DEFAULT '',
    host_ready INTEGER DEFAULT 0,
    guest_ready INTEGER DEFAULT 0,
    created_at TEXT,
    expires_at TEXT,
    completed_at TEXT
  )`;
  const items = `CREATE TABLE IF NOT EXISTS trade_items (
    id TEXT PRIMARY KEY,
    offer_id TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    from_id INTEGER NOT NULL,
    beads TEXT NOT NULL,
    style TEXT DEFAULT 'classic',
    word TEXT DEFAULT '',
    message TEXT DEFAULT '',
    event_id TEXT DEFAULT '',
    event_name TEXT DEFAULT '',
    event_venue TEXT DEFAULT '',
    event_date TEXT DEFAULT '',
    traded_at TEXT,
    hidden INTEGER DEFAULT 0
  )`;
  await db.exec(offers);
  await db.exec(items);
  await KD.migrateDesigns(db);
  for (const sql of [
    "CREATE UNIQUE INDEX IF NOT EXISTS trade_offers_code_idx ON trade_offers(code)",
    "CREATE INDEX IF NOT EXISTS trade_offers_host_idx ON trade_offers(host_id, status)",
    "CREATE INDEX IF NOT EXISTS trade_offers_guest_idx ON trade_offers(guest_id, status)",
    "CREATE INDEX IF NOT EXISTS trade_items_owner_idx ON trade_items(owner_id, traded_at)",
    "CREATE INDEX IF NOT EXISTS trade_items_offer_idx ON trade_items(offer_id)",
  ]) {
    try { await db.exec(sql); } catch (err) { console.error("trade index:", err.message || err); }
  }
}

async function goingEvents(db, userId) {
  return db.prepare(`
    SELECT e.*
    FROM event_going g
    JOIN events e ON e.id = g.event_id OR (COALESCE(g.event_key,'') != '' AND e.event_key = g.event_key)
    WHERE g.user_id=?
      AND COALESCE(e.is_example,0)=0
      AND COALESCE(e.status,'active')='active'
  `).all(userId);
}

async function todayShowsFor(db, userId, day, tz) {
  const rows = await goingEvents(db, userId);
  const stamp = day || dayStamp(new Date(), tz || TZ);
  const seen = new Set();
  const out = [];
  for (const ev of rows) {
    if (eventIsOver(ev)) continue;
    if (!eventHappensOn(ev, stamp, tz || TZ)) continue;
    const key = ev.event_key || ev.id;
    if (seen.has(key) || seen.has(ev.id)) continue;
    seen.add(key);
    seen.add(ev.id);
    out.push(compactEvent(ev));
  }
  out.sort((a, b) => String(a.startsAt || "").localeCompare(String(b.startsAt || "")));
  return out;
}

async function sharedTodayShows(db, aId, bId, tz) {
  const [a, b] = await Promise.all([todayShowsFor(db, aId, null, tz), todayShowsFor(db, bId, null, tz)]);
  const bIds = new Set(b.map((e) => e.id));
  return a.filter((e) => bIds.has(e.id));
}

async function loadEvent(db, eventId) {
  if (!eventId) return null;
  return db.prepare(`SELECT * FROM events WHERE id=?`).get(String(eventId));
}

function eventSnapshot(ev) {
  if (!ev) return { event_id: "", event_name: "", event_venue: "", event_date: "" };
  return {
    event_id: ev.id || "",
    event_name: ev.name || "",
    event_venue: ev.venue || "",
    event_date: ev.date_label || ev.dateLabel || "",
  };
}

async function expireStale(db) {
  const now = isoNow();
  try {
    await db.prepare(`UPDATE trade_offers SET status='expired' WHERE status IN ('open','joined') AND expires_at IS NOT NULL AND expires_at < ?`).run(now);
  } catch (_) { /* table may not exist yet */ }
}

async function cancelOpenFor(db, userId) {
  await db.prepare(`UPDATE trade_offers SET status='cancelled' WHERE (host_id=? OR guest_id=?) AND status IN ('open','joined')`).run(userId, userId);
}

async function getOffer(db, ref) {
  if (!ref) return null;
  const s = String(ref);
  const byId = await db.prepare(`SELECT * FROM trade_offers WHERE id=?`).get(s);
  if (byId) return byId;
  const code = cleanCode(s);
  if (!code) return null;
  return db.prepare(`SELECT * FROM trade_offers WHERE code=?`).get(code);
}

function roleOf(offer, userId) {
  const id = Number(userId);
  if (Number(offer.host_id) === id) return "host";
  if (offer.guest_id != null && Number(offer.guest_id) === id) return "guest";
  return null;
}

async function shapeOffer(db, offer, viewerId, publicUser, blockedSet) {
  if (!offer) return null;
  const now = Date.now();
  const exp = Date.parse(offer.expires_at || "");
  let status = offer.status;
  if ((status === "open" || status === "joined") && Number.isFinite(exp) && exp < now) status = "expired";
  const snap = {
    id: offer.id,
    code: offer.code,
    status,
    expiresAt: offer.expires_at,
    createdAt: offer.created_at,
    completedAt: offer.completed_at,
    event: (offer.event_id || offer.event_name) ? {
      id: offer.event_id || "",
      name: offer.event_name || "",
      venue: offer.event_venue || "",
      dateLabel: offer.event_date || "",
    } : null,
    hostReady: Boolean(Number(offer.host_ready)),
    guestReady: Boolean(Number(offer.guest_ready)),
    role: roleOf(offer, viewerId),
  };
  const host = await db.prepare(`SELECT * FROM users WHERE id=?`).get(offer.host_id);
  const guest = offer.guest_id ? await db.prepare(`SELECT * FROM users WHERE id=?`).get(offer.guest_id) : null;
  snap.host = host ? publicUser(host) : null;
  snap.guest = guest ? publicUser(guest) : null;
  const role = snap.role;
  if (role === "host") {
    snap.mine = parseStoredDesign(offer.host_design);
    snap.theirs = Number(offer.guest_ready) ? parseStoredDesign(offer.guest_design) : (offer.guest_design ? { waiting: true } : null);
    if (snap.theirs && snap.theirs.waiting) snap.theirs = null;
    snap.theirReady = Boolean(Number(offer.guest_ready));
  } else if (role === "guest") {
    snap.mine = parseStoredDesign(offer.guest_design);
    snap.theirs = Number(offer.host_ready) ? parseStoredDesign(offer.host_design) : null;
    snap.theirReady = Boolean(Number(offer.host_ready));
  } else {
    snap.mine = null;
    snap.theirs = null;
    snap.theirReady = false;
  }
  if (status === "completed") {
    snap.mine = role === "guest" ? parseStoredDesign(offer.guest_design) : parseStoredDesign(offer.host_design);
    snap.theirs = role === "guest" ? parseStoredDesign(offer.host_design) : parseStoredDesign(offer.guest_design);
  }
  const otherId = role === "host" ? offer.guest_id : (role === "guest" ? offer.host_id : null);
  if (otherId && blockedSet) {
    const blocked = await blockedSet(viewerId);
    snap.blocked = blocked.has(Number(otherId));
  }
  return snap;
}

function itemPublic(row, fromUser, opts) {
  const hidden = Boolean(Number(row.hidden));
  const beads = parseJsonColors(row.beads);
  const extra = parseExtra(row.extra, beads.length);
  return {
    id: row.id,
    offerId: row.offer_id,
    from: fromUser,
    beads: beads,
    shapes: extra.shapes,
    pattern: extra.pattern,
    charm: extra.charm,
    style: row.style || "classic",
    word: row.word || "",
    message: (opts && opts.includeMessage === false) ? "" : (row.message || ""),
    event: (row.event_id || row.event_name) ? {
      id: row.event_id || "",
      name: row.event_name || "",
      venue: row.event_venue || "",
      dateLabel: row.event_date || "",
    } : null,
    tradedAt: row.traded_at,
    hidden: hidden,
  };
}

function parseJsonColors(raw) {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (Array.isArray(list) ? list : []).map(hexColor).filter(Boolean);
  } catch {
    return [];
  }
}

async function completeTrade(db, offer) {
  const hostDesign = parseStoredDesign(offer.host_design);
  const guestDesign = parseStoredDesign(offer.guest_design);
  if (!hostDesign || !guestDesign) return { error: "Both people need to finish their kandi first." };
  const now = isoNow();
  const hostItem = newId("titm_");
  const guestItem = newId("titm_");
  const ev = {
    event_id: offer.event_id || "",
    event_name: offer.event_name || "",
    event_venue: offer.event_venue || "",
    event_date: offer.event_date || "",
  };
  const insert = `INSERT INTO trade_items (id, offer_id, owner_id, from_id, beads, style, word, message, event_id, event_name, event_venue, event_date, traded_at, hidden, extra) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`;
  await db.prepare(insert).run(
    guestItem, offer.id, offer.guest_id, offer.host_id,
    JSON.stringify(hostDesign.beads), hostDesign.style, hostDesign.word, hostDesign.message,
    ev.event_id, ev.event_name, ev.event_venue, ev.event_date, now, extraFromDesign(hostDesign)
  );
  await db.prepare(insert).run(
    hostItem, offer.id, offer.host_id, offer.guest_id,
    JSON.stringify(guestDesign.beads), guestDesign.style, guestDesign.word, guestDesign.message,
    ev.event_id, ev.event_name, ev.event_venue, ev.event_date, now, extraFromDesign(guestDesign)
  );
  await db.prepare(`UPDATE trade_offers SET status='completed', completed_at=?, host_ready=1, guest_ready=1 WHERE id=?`).run(now, offer.id);
  return { ok: true, completedAt: now, hostItem, guestItem };
}

function publicBase(req) {
  const env = String(process.env.KANDI_PUBLIC_URL || "").replace(/\/$/, "");
  if (env) return env;
  const proto = (req.get && req.get("x-forwarded-proto")) || req.protocol || "https";
  const host = (req.get && (req.get("x-forwarded-host") || req.get("host"))) || "";
  return (proto + "://" + host).replace(/\/$/, "");
}

function qrPayload(req, code) {
  const base = publicBase(req);
  return (base ? base + "/t/" + code : "KANDI-TRADE:" + code);
}

async function pickDefaultEvent(db, hostId, guestId, requestedId) {
  if (requestedId) {
    const ev = await loadEvent(db, requestedId);
    if (ev && String(ev.status || "active") !== "removed" && !ev.is_example) return ev;
  }
  if (guestId) {
    const shared = await sharedTodayShows(db, hostId, guestId);
    if (shared.length === 1) return loadEvent(db, shared[0].id);
    if (shared.length > 1) return loadEvent(db, shared[0].id);
    return null;
  }
  const mine = await todayShowsFor(db, hostId);
  if (mine.length) return loadEvent(db, mine[0].id);
  return null;
}

function installTrades({ app, getDb, auth, publicUser, blockedSet, broadcastToUser }) {
  const db = () => getDb();

  async function push(userId, payload) {
    if (!broadcastToUser || userId == null) return;
    try { broadcastToUser(userId, payload); } catch (err) { console.error("trade push:", err.message || err); }
  }

  KD.installKandiDesigns({ app, getDb, auth });

  app.get("/t/:code", (req, res) => {
    const code = cleanCode(req.params.code);
    res.redirect(302, "/?trade=" + encodeURIComponent(code || ""));
  });

  app.get("/api/trades/today-shows", auth, async (req, res) => {
    await expireStale(db());
    const otherId = req.query.with ? Number(req.query.with) : null;
    let shows;
    let shared = [];
    if (otherId && otherId !== Number(req.user.id)) {
      const blocked = await blockedSet(req.user.id);
      if (blocked.has(otherId)) return res.status(403).json({ error: "You can't trade kandi with this person." });
      shared = await sharedTodayShows(db(), req.user.id, otherId);
      shows = shared.length ? shared : await todayShowsFor(db(), req.user.id);
    } else {
      shows = await todayShowsFor(db(), req.user.id);
    }
    res.json({ shows, shared, today: dayStamp(new Date(), TZ) });
  });

  app.get("/api/trades/offers/active", auth, async (req, res) => {
    await expireStale(db());
    const row = await db().prepare(`
      SELECT * FROM trade_offers
      WHERE (host_id=? OR guest_id=?) AND status IN ('open','joined')
      ORDER BY created_at DESC
    `).get(req.user.id, req.user.id);
    if (!row) return res.json({ offer: null });
    res.json({ offer: await shapeOffer(db(), row, req.user.id, publicUser, blockedSet) });
  });

  app.post("/api/trades/offers", auth, async (req, res) => {
    await expireStale(db());
    await cancelOpenFor(db(), req.user.id);
    const ev = await pickDefaultEvent(db(), req.user.id, null, req.body && req.body.eventId);
    const snap = eventSnapshot(ev);
    let code = makeCode();
    let id = newId("toff_");
    const created = isoNow();
    const expires = new Date(Date.now() + OFFER_TTL_MS).toISOString();
    for (let i = 0; i < 6; i++) {
      try {
        await db().prepare(`INSERT INTO trade_offers (id, code, host_id, guest_id, event_id, event_name, event_venue, event_date, status, host_design, guest_design, host_ready, guest_ready, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, code, req.user.id, null, snap.event_id, snap.event_name, snap.event_venue, snap.event_date, "open", "", "", 0, 0, created, expires);
        break;
      } catch (err) {
        const msg = String((err && err.message) || err);
        if (/unique|duplicate/i.test(msg) && i < 5) {
          code = makeCode();
          id = newId("toff_");
          continue;
        }
        throw err;
      }
    }
    const row = await getOffer(db(), id);
    const offer = await shapeOffer(db(), row, req.user.id, publicUser, blockedSet);
    offer.qrPayload = qrPayload(req, row.code);
    offer.todayShows = await todayShowsFor(db(), req.user.id);
    res.json({ offer });
  });

  app.get("/api/trades/offers/:ref", auth, async (req, res) => {
    await expireStale(db());
    const row = await getOffer(db(), req.params.ref);
    if (!row) return res.status(404).json({ error: "That trade code isn't active. Ask them to open Trade kandi again." });
    const now = Date.now();
    if ((row.status === "open" || row.status === "joined") && Date.parse(row.expires_at || "") < now) {
      await db().prepare(`UPDATE trade_offers SET status='expired' WHERE id=?`).run(row.id);
      return res.status(410).json({ error: "That trade code expired. Ask them to start a new one." });
    }
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(Number(row.host_id)) || (row.guest_id && blocked.has(Number(row.guest_id)))) {
      return res.status(403).json({ error: "You can't trade kandi with this person." });
    }
    const offer = await shapeOffer(db(), row, req.user.id, publicUser, blockedSet);
    offer.qrPayload = qrPayload(req, row.code);
    if (offer.role) {
      const otherId = offer.role === "host" ? row.guest_id : row.host_id;
      offer.todayShows = otherId ? await (async () => {
        const shared = await sharedTodayShows(db(), req.user.id, otherId);
        return shared.length ? shared : await todayShowsFor(db(), req.user.id);
      })() : await todayShowsFor(db(), req.user.id);
    }
    res.json({ offer });
  });

  app.post("/api/trades/offers/:ref/join", auth, async (req, res) => {
    await expireStale(db());
    const row = await getOffer(db(), req.params.ref);
    if (!row) return res.status(404).json({ error: "That trade code isn't active. Ask them to open Trade kandi again." });
    if (row.status === "expired" || Date.parse(row.expires_at || "") < Date.now()) {
      await db().prepare(`UPDATE trade_offers SET status='expired' WHERE id=?`).run(row.id);
      return res.status(410).json({ error: "That trade code expired. Ask them to start a new one." });
    }
    if (row.status === "completed") return res.status(400).json({ error: "This trade is already done." });
    if (row.status === "cancelled") return res.status(400).json({ error: "This trade was cancelled." });
    if (Number(row.host_id) === Number(req.user.id)) {
      return res.status(400).json({ error: "That's your own code. Have the other person scan it." });
    }
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(Number(row.host_id))) {
      return res.status(403).json({ error: "You can't trade kandi with this person." });
    }
    if (row.status === "joined" && Number(row.guest_id) === Number(req.user.id)) {
      const offer = await shapeOffer(db(), row, req.user.id, publicUser, blockedSet);
      offer.todayShows = await sharedOrMine(db(), req.user.id, row.host_id);
      return res.json({ offer });
    }
    if (row.status === "joined") {
      return res.status(409).json({ error: "Someone already joined this trade." });
    }
    await cancelOpenFor(db(), req.user.id);
    let ev = null;
    if (row.event_id) ev = await loadEvent(db(), row.event_id);
    if (!ev) ev = await pickDefaultEvent(db(), row.host_id, req.user.id, req.body && req.body.eventId);
    const snap = ev ? eventSnapshot(ev) : { event_id: row.event_id || "", event_name: row.event_name || "", event_venue: row.event_venue || "", event_date: row.event_date || "" };
    await db().prepare(`UPDATE trade_offers SET guest_id=?, status='joined', event_id=?, event_name=?, event_venue=?, event_date=? WHERE id=? AND status='open'`)
      .run(req.user.id, snap.event_id, snap.event_name, snap.event_venue, snap.event_date, row.id);
    const fresh = await getOffer(db(), row.id);
    const offer = await shapeOffer(db(), fresh, req.user.id, publicUser, blockedSet);
    offer.todayShows = await sharedOrMine(db(), req.user.id, row.host_id);
    await push(row.host_id, { type: "trade", action: "joined", offer: await shapeOffer(db(), fresh, row.host_id, publicUser, blockedSet) });
    res.json({ offer });
  });

  app.post("/api/trades/offers/:ref/event", auth, async (req, res) => {
    await expireStale(db());
    const row = await getOffer(db(), req.params.ref);
    if (!row) return res.status(404).json({ error: "Trade not found." });
    const role = roleOf(row, req.user.id);
    if (!role) return res.status(403).json({ error: "You're not in this trade." });
    if (row.status === "completed") return res.status(400).json({ error: "This trade is already done." });
    if (row.status !== "open" && row.status !== "joined") return res.status(400).json({ error: "This trade isn't active." });
    const eventId = req.body && req.body.eventId != null ? String(req.body.eventId) : "";
    let snap = { event_id: "", event_name: "", event_venue: "", event_date: "" };
    if (eventId) {
      const ev = await loadEvent(db(), eventId);
      if (!ev || ev.is_example || String(ev.status || "active") === "removed") {
        return res.status(404).json({ error: "Show not found." });
      }
      snap = eventSnapshot(ev);
    }
    await db().prepare(`UPDATE trade_offers SET event_id=?, event_name=?, event_venue=?, event_date=? WHERE id=?`)
      .run(snap.event_id, snap.event_name, snap.event_venue, snap.event_date, row.id);
    const fresh = await getOffer(db(), row.id);
    const other = role === "host" ? fresh.guest_id : fresh.host_id;
    if (other) await push(other, { type: "trade", action: "event", offer: await shapeOffer(db(), fresh, other, publicUser, blockedSet) });
    res.json({ offer: await shapeOffer(db(), fresh, req.user.id, publicUser, blockedSet) });
  });

  app.post("/api/trades/offers/:ref/ready", auth, async (req, res) => {
    await expireStale(db());
    const row = await getOffer(db(), req.params.ref);
    if (!row) return res.status(404).json({ error: "Trade not found." });
    const role = roleOf(row, req.user.id);
    if (!role) return res.status(403).json({ error: "You're not in this trade." });
    if (row.status === "completed") {
      return res.json({ offer: await shapeOffer(db(), row, req.user.id, publicUser, blockedSet), completed: true });
    }
    if (row.status !== "joined") return res.status(400).json({ error: "Wait for the other person to join first." });
    const blocked = await blockedSet(req.user.id);
    const otherId = role === "host" ? row.guest_id : row.host_id;
    if (blocked.has(Number(otherId))) return res.status(403).json({ error: "You can't trade kandi with this person." });
    const body = req.body || {};
    // A saved design may be named by id (the server then uses its own copy); either way the
    // design that gets stored on the offer is a snapshot, so later edits to the saved design
    // never change a trade that already happened.
    let designSrc = body.design || (body.designId ? null : body);
    const designId = body.designId ? String(body.designId) : "";
    if (!designSrc && designId) {
      const saved = await KD.ownedDesign(db(), req.user.id, designId);
      if (!saved) return res.status(404).json({ error: "That saved design isn't available." });
      designSrc = JSON.parse(saved.design);
      if (body.message != null) designSrc.message = body.message;
    }
    const parsed = parseDesign(designSrc);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const json = JSON.stringify(parsed.design);
    let savedInfo = null;
    if (designId) {
      const own = await KD.ownedDesign(db(), req.user.id, designId);
      if (own) { await KD.touchUsed(db(), req.user.id, designId); savedInfo = { id: designId }; }
    } else if (body.saveAs != null && String(body.saveAs).trim() !== "" && body.saveAs !== false) {
      const made = await KD.createDesign(db(), req.user.id, body.saveAs === true ? "My kandi" : body.saveAs, parsed.design);
      if (made.item) { await KD.touchUsed(db(), req.user.id, made.item.id); savedInfo = { id: made.item.id, name: made.item.name }; }
      else savedInfo = { error: made.error };
    }
    if (role === "host") {
      await db().prepare(`UPDATE trade_offers SET host_design=?, host_ready=1 WHERE id=? AND status='joined'`).run(json, row.id);
    } else {
      await db().prepare(`UPDATE trade_offers SET guest_design=?, guest_ready=1 WHERE id=? AND status='joined'`).run(json, row.id);
    }
    let fresh = await getOffer(db(), row.id);
    let completed = false;
    if (Number(fresh.host_ready) && Number(fresh.guest_ready) && fresh.status === "joined") {
      const done = await completeTrade(db(), fresh);
      if (done.error) return res.status(400).json({ error: done.error });
      completed = true;
      fresh = await getOffer(db(), row.id);
    }
    const offer = await shapeOffer(db(), fresh, req.user.id, publicUser, blockedSet);
    await push(otherId, { type: "trade", action: completed ? "completed" : "ready", offer: await shapeOffer(db(), fresh, otherId, publicUser, blockedSet) });
    res.json({ offer, completed, saved: savedInfo });
  });

  app.post("/api/trades/offers/:ref/cancel", auth, async (req, res) => {
    const row = await getOffer(db(), req.params.ref);
    if (!row) return res.json({ ok: true });
    const role = roleOf(row, req.user.id);
    if (!role) return res.status(403).json({ error: "You're not in this trade." });
    if (row.status === "completed") return res.status(400).json({ error: "This trade is already done." });
    await db().prepare(`UPDATE trade_offers SET status='cancelled' WHERE id=? AND status IN ('open','joined')`).run(row.id);
    const other = role === "host" ? row.guest_id : row.host_id;
    if (other) await push(other, { type: "trade", action: "cancelled", offer: { id: row.id, status: "cancelled" } });
    res.json({ ok: true });
  });

  app.get("/api/trades/collection", auth, async (req, res) => {
    const userId = req.query.userId != null ? Number(req.query.userId) : Number(req.user.id);
    if (!userId) return res.status(400).json({ error: "Invalid user." });
    const isMe = userId === Number(req.user.id);
    if (!isMe) {
      const blocked = await blockedSet(req.user.id);
      if (blocked.has(userId)) return res.status(404).json({ error: "User not found." });
    }
    const rows = await db().prepare(`
      SELECT * FROM trade_items WHERE owner_id=?
      ORDER BY traded_at DESC, id DESC
    `).all(userId);
    const visible = rows.filter((r) => isMe || !Number(r.hidden));
    const fromIds = Array.from(new Set(visible.map((r) => Number(r.from_id))));
    const fromMap = new Map();
    for (const id of fromIds) {
      const u = await db().prepare(`SELECT * FROM users WHERE id=?`).get(id);
      fromMap.set(id, u ? publicUser(u) : { id, name: "Someone", username: "" });
    }
    const items = visible.map((r) => itemPublic(r, fromMap.get(Number(r.from_id)) || null, { includeMessage: true }));
    res.json({ items, count: items.filter((i) => !i.hidden).length });
  });

  app.get("/api/trades/items/:id", auth, async (req, res) => {
    const row = await db().prepare(`SELECT * FROM trade_items WHERE id=?`).get(String(req.params.id));
    if (!row) return res.status(404).json({ error: "Kandi not found." });
    const isOwner = Number(row.owner_id) === Number(req.user.id);
    if (!isOwner && Number(row.hidden)) return res.status(404).json({ error: "Kandi not found." });
    if (!isOwner) {
      const blocked = await blockedSet(req.user.id);
      if (blocked.has(Number(row.owner_id)) || blocked.has(Number(row.from_id))) {
        return res.status(404).json({ error: "Kandi not found." });
      }
    }
    const from = await db().prepare(`SELECT * FROM users WHERE id=?`).get(row.from_id);
    res.json({ item: itemPublic(row, from ? publicUser(from) : { id: Number(row.from_id), name: "Someone", username: "" }, { includeMessage: true }), isOwner });
  });

  app.post("/api/trades/items/:id/hide", auth, async (req, res) => {
    const row = await db().prepare(`SELECT * FROM trade_items WHERE id=?`).get(String(req.params.id));
    if (!row || Number(row.owner_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: "Kandi not found." });
    }
    const hidden = req.body && req.body.hidden != null ? Boolean(req.body.hidden) : !Number(row.hidden);
    await db().prepare(`UPDATE trade_items SET hidden=? WHERE id=?`).run(hidden ? 1 : 0, row.id);
    const from = await db().prepare(`SELECT * FROM users WHERE id=?`).get(row.from_id);
    const fresh = await db().prepare(`SELECT * FROM trade_items WHERE id=?`).get(row.id);
    res.json({ item: itemPublic(fresh, from ? publicUser(from) : null, { includeMessage: true }), isOwner: true });
  });
}

async function sharedOrMine(db, me, other) {
  const shared = await sharedTodayShows(db, me, other);
  return shared.length ? shared : todayShowsFor(db, me);
}

async function deleteTradesForUser(db, userId) {
  try {
    await db.prepare(`UPDATE trade_offers SET status='cancelled' WHERE (host_id=? OR guest_id=?) AND status IN ('open','joined')`).run(userId, userId);
    await db.prepare(`DELETE FROM trade_items WHERE owner_id=?`).run(userId);
  } catch (_) { /* tables may not exist yet */ }
  await KD.deleteDesignsForUser(db, userId);
}

module.exports = {
  installTrades,
  migrateTrades,
  deleteTradesForUser,
  eventHappensOn,
  dayStamp,
  parseDesign,
  cleanCode,
  makeCode,
  clipWord,
  TZ,
  OFFER_TTL_MS,
};
