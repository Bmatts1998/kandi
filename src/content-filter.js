"use strict";

// Lightweight text filter for App Store guideline 1.2 (objectionable UGC).
// Rejects clearly prohibited material; reports still exist for everything else.

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[@$0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MINOR_SEX = /\b(child\s*porn|childporn|csam|cp\s*content|loli|lolita|shota|preteen|pre\s*teen|underage|under\s*age|pedophil|paedophil|pedophil)\b/;
const MINOR_AND_SEX = /\b(11|12|13|14|15|16|minor|underage|child|children|toddler|infant)\b[^\n]{0,40}\b(sex|sexual|porn|nude|naked|nudes|xxx)\b|\b(sex|sexual|porn|nude|naked|nudes|xxx)\b[^\n]{0,40}\b(11|12|13|14|15|16|minor|underage|child|children|toddler|infant)\b/;

function contentRejected(text) {
  const raw = String(text || "");
  if (!raw.trim()) return null;
  const n = normalize(raw);
  if (MINOR_SEX.test(n) || MINOR_AND_SEX.test(n) || MINOR_SEX.test(raw.toLowerCase())) {
    return "That text is not allowed on Kandi. Sexual content involving anyone under 18 is prohibited.";
  }
  return null;
}

function rejectedFromAll(parts) {
  for (const part of parts) {
    if (part == null) continue;
    if (Array.isArray(part)) {
      const bad = rejectedFromAll(part);
      if (bad) return bad;
      continue;
    }
    if (typeof part === "object") {
      const bad = rejectedFromAll(Object.values(part));
      if (bad) return bad;
      continue;
    }
    const bad = contentRejected(String(part));
    if (bad) return bad;
  }
  return null;
}

module.exports = { contentRejected, rejectedFromAll };
