"use strict";

// Per-show vibe tags. Apple App Store guideline 1.4.3: never name a drug,
// use drug emojis, slang, or copy that promotes or helps people find substances.
// Approved labels only: "Going sober 💧", "Sober-friendly", "Here to party 🎉".

const VIBES = [
  { id: "going_sober", label: "Going sober", emoji: "💧" },
  { id: "sober_friendly", label: "Sober-friendly", emoji: "" },
  { id: "party", label: "Here to party", emoji: "🎉" },
];

const VIBE_IDS = new Set(VIBES.map((v) => v.id));

function vibeEntry(id) {
  return VIBES.find((v) => v.id === id) || null;
}

// Returns a valid id, "" for blank, undefined when the value was omitted, or null if invalid.
function normalizeVibe(val, { omitted } = {}) {
  if (val == null) return omitted !== undefined ? omitted : undefined;
  const raw = String(val).trim();
  if (!raw || raw === "all" || raw === "none" || raw === "blank") return "";
  const s = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "going_sober" || s === "sober") return "going_sober";
  if (s === "sober_friendly" || s === "soberfriendly") return "sober_friendly";
  if (s === "party" || s === "here_to_party") return "party";
  if (VIBE_IDS.has(s)) return s;
  return null;
}

function vibeLabel(id) {
  const v = vibeEntry(id);
  if (!v) return "";
  return v.emoji ? v.label + " " + v.emoji : v.label;
}

function vibePublic(id) {
  const vibe = normalizeVibe(id, { omitted: "" }) || "";
  if (!vibe) return { vibe: "", vibeLabel: "" };
  return { vibe, vibeLabel: vibeLabel(vibe) };
}

async function vibe_migrate(db) {
  if (db.driver === "postgres") {
    await db.exec("ALTER TABLE event_going ADD COLUMN IF NOT EXISTS show_vibe TEXT DEFAULT ''");
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_vibe_event_going_show_vibe ON event_going(show_vibe)"); } catch (err) {
      console.error("idx_vibe_event_going_show_vibe:", err.message || err);
    }
  } else {
    try { await db.exec("ALTER TABLE event_going ADD COLUMN show_vibe TEXT DEFAULT ''"); } catch (_) {}
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_vibe_event_going_show_vibe ON event_going(show_vibe)"); } catch (_) {}
  }
}

module.exports = {
  VIBES,
  vibe_migrate,
  normalizeVibe,
  vibeLabel,
  vibePublic,
  vibeEntry,
};
