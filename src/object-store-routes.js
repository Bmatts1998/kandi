"use strict";

const crypto = require("crypto");
const store = require("./object-store");

function newFileId(ext) {
  const e = String(ext || "");
  const safe = e && /^\.[A-Za-z0-9]{1,8}$/.test(e) ? e : "";
  return Date.now() + "-" + crypto.randomBytes(6).toString("hex") + safe;
}

function extFromMime(mime, fallback) {
  const m = String(mime || "").toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return ".jpg";
  if (m === "image/png") return ".png";
  if (m === "image/webp") return ".webp";
  if (m === "image/gif") return ".gif";
  if (m === "video/mp4") return ".mp4";
  if (m === "video/quicktime") return ".mov";
  if (m === "video/webm") return ".webm";
  if (m === "audio/mp4" || m === "audio/m4a") return ".m4a";
  return fallback || "";
}

function installObjectStoreRoutes({ app, auth }) {
  app.get("/api/media/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(store.clientConfig());
  });

  app.post("/api/media/presign", auth, async (req, res) => {
    if (!store.enabled()) return res.status(404).json({ error: "Direct uploads are not enabled yet.", enabled: false });
    const purpose = String((req.body && req.body.purpose) || "").toLowerCase();
    const allowed = ["photo", "video", "poster", "chat", "selfie"];
    if (!allowed.includes(purpose)) return res.status(400).json({ error: "Unknown upload purpose." });
    const mime = String((req.body && req.body.mime) || "").toLowerCase();
    const bytes = Number(req.body && req.body.bytes);
    const max = purpose === "video" || purpose === "chat" ? 60 * 1024 * 1024 : 30 * 1024 * 1024;
    if (Number.isFinite(bytes) && bytes > max) return res.status(400).json({ error: "That file is too large to upload." });
    const matchId = Number(req.body && req.body.matchId);
    if (purpose === "chat" && !Number.isFinite(matchId)) return res.status(400).json({ error: "Chat uploads need a match." });
    const visibility = (purpose === "chat" || purpose === "selfie") ? "private" : "public";
    const kind = purpose === "video" ? "videos" : (purpose === "selfie" ? "selfies" : (purpose === "chat" ? "chat" : "photos"));
    const fileId = newFileId(extFromMime(mime, purpose === "video" ? ".mp4" : ".jpg"));
    const key = store.keyFor({ visibility, kind, userId: req.user.id, fileId, matchId });
    const signed = store.presignPut(key, { contentType: mime || "application/octet-stream", expires: 15 * 60 });
    res.json({
      enabled: true,
      fileId,
      key,
      method: signed.method,
      url: signed.url,
      headers: signed.headers,
      expires: signed.expires,
    });
  });
}

module.exports = { installObjectStoreRoutes, newFileId, extFromMime };
