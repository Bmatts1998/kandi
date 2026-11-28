"use strict";

// Kandi bracelet designs: validation shared by trades, plus "My designs",
// a per-user library of saved bracelets (create, edit, rename, duplicate,
// delete) that people can build ahead of time and pick from at trade time.
// Free for everyone (including iOS): nothing here is gated or priced.

const crypto = require("crypto");
const { contentRejected } = require("./content-filter");

const WORD_MAX = 8;
const MESSAGE_MAX = 140;
const BEAD_MIN = 5;
const BEAD_MAX = 24;
const NAME_MAX = 30;
const MAX_DESIGNS = 20;

// Finishes (the look of the whole bracelet). The first eleven shipped with trades.
const STYLES = new Set([
  "classic", "glow", "uv", "pearl", "metallic", "rainbow", "sunset", "forest", "ice", "candy", "midnight",
  "neon", "pastel", "glitter", "jelly",
]);
const SHAPES = new Set(["round", "star", "heart", "pony", "cube", "flower"]);
const PATTERNS = new Set(["solid", "alternating", "rainbow", "custom"]);
const CHARMS = new Set(["none", "star", "heart", "bolt", "moon", "smiley", "peace", "butterfly", "flower", "crown", "rainbow", "gem", "alien"]);

function newId() {
  return "kd_" + crypto.randomBytes(10).toString("hex");
}

function isoNow() {
  return new Date().toISOString();
}

function clipWord(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9&!?+]/g, "").slice(0, WORD_MAX);
}

function clipMessage(raw) {
  return String(raw || "").trim().slice(0, MESSAGE_MAX);
}

function clipName(raw) {
  // eslint-disable-next-line no-control-regex
  return String(raw || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

function hexColor(raw) {
  const m = String(raw || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? "#" + m[1].toLowerCase() : null;
}

function oneOf(set, raw, fallback) {
  const v = String(raw == null ? "" : raw).trim().toLowerCase();
  return set.has(v) ? v : fallback;
}

// Returns { design } (normalized, safe to store/render) or { error }.
function parseDesign(raw) {
  let src = raw;
  if (typeof raw === "string") {
    try { src = JSON.parse(raw); } catch { return { error: "Pick a kandi style and try again." }; }
  }
  if (!src || typeof src !== "object" || Array.isArray(src)) return { error: "Pick a kandi style and try again." };
  const style = String(src.style || "classic").toLowerCase();
  if (!STYLES.has(style)) return { error: "That kandi style isn't available." };
  const beads = [];
  const shapes = [];
  const list = Array.isArray(src.beads) ? src.beads : [];
  const shapeList = Array.isArray(src.shapes) ? src.shapes : [];
  for (let i = 0; i < list.length; i++) {
    const hx = hexColor(list[i]);
    if (!hx) continue;
    beads.push(hx);
    shapes.push(oneOf(SHAPES, shapeList[i], "round"));
    if (beads.length >= BEAD_MAX) break;
  }
  if (beads.length < BEAD_MIN) return { error: "Add at least " + BEAD_MIN + " beads to your kandi." };
  const word = clipWord(src.word);
  const message = clipMessage(src.message);
  const bad = contentRejected(word) || contentRejected(message);
  if (bad) return { error: bad };
  return {
    design: {
      beads,
      shapes,
      style,
      pattern: oneOf(PATTERNS, src.pattern, "custom"),
      charm: oneOf(CHARMS, src.charm, "none"),
      word,
      message,
    },
  };
}

function parseStoredDesign(raw) {
  if (!raw) return null;
  const parsed = parseDesign(raw);
  return parsed.design || null;
}

// The columns trade_items keeps beyond beads/style/word/message.
function extraFromDesign(d) {
  return JSON.stringify({ v: 2, shapes: d.shapes, pattern: d.pattern, charm: d.charm });
}

function parseExtra(raw, beadCount) {
  let x = {};
  try { x = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {}; } catch { x = {}; }
  if (!x || typeof x !== "object") x = {};
  const shapes = [];
  for (let i = 0; i < beadCount; i++) shapes.push(oneOf(SHAPES, Array.isArray(x.shapes) ? x.shapes[i] : "", "round"));
  return { shapes, pattern: oneOf(PATTERNS, x.pattern, "custom"), charm: oneOf(CHARMS, x.charm, "none") };
}

async function migrateDesigns(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS kandi_designs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    design TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    last_used_at TEXT DEFAULT ''
  )`);
  try { await db.exec("CREATE INDEX IF NOT EXISTS kandi_designs_user_idx ON kandi_designs(user_id, updated_at)"); } catch (err) { console.error("kandi_designs index:", err.message || err); }
  // trade_items.extra: shapes/pattern/charm for the traded snapshot.
  if (db.driver === "postgres") {
    await db.exec("ALTER TABLE trade_items ADD COLUMN IF NOT EXISTS extra TEXT DEFAULT ''");
  } else {
    try { await db.exec("ALTER TABLE trade_items ADD COLUMN extra TEXT DEFAULT ''"); } catch (_) { /* already there */ }
  }
}

function rowPublic(row) {
  const d = parseStoredDesign(row.design);
  if (!d) return null;
  return {
    id: row.id,
    name: row.name || "My kandi",
    design: d,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    lastUsedAt: row.last_used_at || "",
  };
}

async function listFor(db, userId) {
  const rows = await db.prepare(`SELECT * FROM kandi_designs WHERE user_id=? ORDER BY updated_at DESC, id DESC`).all(userId);
  const designs = rows.map(rowPublic).filter(Boolean);
  let lastUsedId = "";
  let best = "";
  for (const d of designs) {
    if (d.lastUsedAt && d.lastUsedAt > best) { best = d.lastUsedAt; lastUsedId = d.id; }
  }
  return { designs, lastUsedId, max: MAX_DESIGNS };
}

async function countFor(db, userId) {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM kandi_designs WHERE user_id=?`).get(userId);
  return Number(r && r.n) || 0;
}

async function createDesign(db, userId, name, design) {
  if ((await countFor(db, userId)) >= MAX_DESIGNS) {
    return { error: "You can save up to " + MAX_DESIGNS + " designs. Delete one to make room." };
  }
  const id = newId();
  const now = isoNow();
  const nm = clipName(name) || "My kandi";
  const bad = contentRejected(nm);
  if (bad) return { error: bad };
  await db.prepare(`INSERT INTO kandi_designs (id, user_id, name, design, created_at, updated_at, last_used_at) VALUES (?,?,?,?,?,?,'')`)
    .run(id, userId, nm, JSON.stringify(design), now, now);
  const row = await db.prepare(`SELECT * FROM kandi_designs WHERE id=?`).get(id);
  return { item: rowPublic(row) };
}

async function ownedDesign(db, userId, id) {
  const row = await db.prepare(`SELECT * FROM kandi_designs WHERE id=? AND user_id=?`).get(String(id || ""), userId);
  return row || null;
}

async function touchUsed(db, userId, id) {
  if (!id) return;
  try {
    await db.prepare(`UPDATE kandi_designs SET last_used_at=? WHERE id=? AND user_id=?`).run(isoNow(), String(id), userId);
  } catch (err) { console.error("kandi design touch:", err.message || err); }
}

function installKandiDesigns({ app, getDb, auth }) {
  const db = () => getDb();

  app.get("/api/kandi-designs", auth, async (req, res) => {
    res.json(await listFor(db(), req.user.id));
  });

  app.post("/api/kandi-designs", auth, async (req, res) => {
    const body = req.body || {};
    const parsed = parseDesign(body.design);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const made = await createDesign(db(), req.user.id, body.name, parsed.design);
    if (made.error) return res.status(400).json({ error: made.error });
    res.status(201).json({ item: made.item, ...(await listFor(db(), req.user.id)) });
  });

  app.put("/api/kandi-designs/:id", auth, async (req, res) => {
    const row = await ownedDesign(db(), req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: "Design not found." });
    const body = req.body || {};
    let json = row.design;
    if (body.design != null) {
      const parsed = parseDesign(body.design);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      json = JSON.stringify(parsed.design);
    }
    let name = row.name;
    if (body.name != null) {
      name = clipName(body.name) || row.name || "My kandi";
      const bad = contentRejected(name);
      if (bad) return res.status(400).json({ error: bad });
    }
    await db().prepare(`UPDATE kandi_designs SET name=?, design=?, updated_at=? WHERE id=? AND user_id=?`).run(name, json, isoNow(), row.id, req.user.id);
    const fresh = await ownedDesign(db(), req.user.id, row.id);
    res.json({ item: rowPublic(fresh), ...(await listFor(db(), req.user.id)) });
  });

  app.post("/api/kandi-designs/:id/duplicate", auth, async (req, res) => {
    const row = await ownedDesign(db(), req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: "Design not found." });
    const d = parseStoredDesign(row.design);
    if (!d) return res.status(400).json({ error: "That design can't be copied." });
    const base = clipName(row.name) || "My kandi";
    const nm = (base.length + 5 > NAME_MAX ? base.slice(0, NAME_MAX - 5).trim() : base) + " copy";
    const made = await createDesign(db(), req.user.id, nm, d);
    if (made.error) return res.status(400).json({ error: made.error });
    res.status(201).json({ item: made.item, ...(await listFor(db(), req.user.id)) });
  });

  app.delete("/api/kandi-designs/:id", auth, async (req, res) => {
    await db().prepare(`DELETE FROM kandi_designs WHERE id=? AND user_id=?`).run(String(req.params.id), req.user.id);
    res.json({ ok: true, ...(await listFor(db(), req.user.id)) });
  });
}

async function deleteDesignsForUser(db, userId) {
  try { await db.prepare(`DELETE FROM kandi_designs WHERE user_id=?`).run(userId); } catch (_) { /* table may not exist yet */ }
}

module.exports = {
  BEAD_MIN,
  BEAD_MAX,
  MAX_DESIGNS,
  NAME_MAX,
  STYLES,
  SHAPES,
  PATTERNS,
  CHARMS,
  parseDesign,
  parseStoredDesign,
  extraFromDesign,
  parseExtra,
  hexColor,
  migrateDesigns,
  installKandiDesigns,
  createDesign,
  ownedDesign,
  touchUsed,
  deleteDesignsForUser,
};
