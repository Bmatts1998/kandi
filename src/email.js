"use strict";

// Transactional email for Kandi: email verification and password reset.
//
// Everything here is gated on env vars. With no provider configured in production,
// email is still collected at sign-up but nobody is blocked waiting for a message
// that can't be sent. Render's Free plan blocks SMTP ports, so only HTTPS APIs are used.
//
// Providers (first match wins unless EMAIL_PROVIDER is set):
//   resend   RESEND_API_KEY
//   postmark POSTMARK_SERVER_TOKEN
//   gmail    GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN (Gmail API over HTTPS)
//   console  dev fallback (NODE_ENV !== production): links are written to the server log
// EMAIL_FROM        "Kandi <hello@yourdomain.com>" (required for resend/postmark; gmail defaults to the account)
// EMAIL_VERIFICATION=off  keep collecting email but never require verification

const crypto = require("crypto");

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;

function detectProvider(env = process.env) {
  const forced = String(env.EMAIL_PROVIDER || "").trim().toLowerCase();
  const has = {
    resend: Boolean(env.RESEND_API_KEY),
    postmark: Boolean(env.POSTMARK_SERVER_TOKEN),
    gmail: Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN),
  };
  if (forced === "none" || forced === "off") return "none";
  if (forced === "console") return "console";
  if (forced && has[forced]) return forced;
  if (has.resend) return "resend";
  if (has.postmark) return "postmark";
  if (has.gmail) return "gmail";
  if (String(env.NODE_ENV || "").toLowerCase() !== "production" && env.EMAIL_DEV_LOG !== "0") return "console";
  return "none";
}

function canSend(env = process.env) {
  return detectProvider(env) !== "none";
}

// Verification is enforced only when mail can actually go out.
function verificationActive(env = process.env) {
  const flag = String(env.EMAIL_VERIFICATION || "").trim().toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false") return false;
  return canSend(env);
}

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function validateEmail(raw) {
  const email = normalizeEmail(raw);
  if (!email) return { error: "Enter your email address." };
  if (email.length > 254) return { error: "That email address is too long." };
  if (!/^[^\s@"'<>(),;:\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  return { value: email };
}

function newToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// True when this account must confirm its email before using Kandi.
// Accounts created before verification existed (email_verify_required=0) are never locked.
function isLocked(user, env = process.env) {
  if (!user) return false;
  if (!Number(user.email_verify_required)) return false;
  if (user.email_verified_at) return false;
  return verificationActive(env);
}

function publicBase(req, env = process.env) {
  const fixed = String(env.KANDI_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const proto = String((req && req.headers && req.headers["x-forwarded-proto"]) || (req && req.protocol) || "http").split(",")[0].trim();
  const host = (req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "localhost";
  return proto + "://" + host;
}

// Simple in-memory limiter (one Render instance). key -> [timestamps]
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return { ok: false, retryInMs: windowMs - (now - list[0]) };
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < 3600000)) hits.delete(k);
  }
  return { ok: true };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function layout(title, intro, buttonText, url, footer) {
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#000;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#fff7f0">
<div style="max-width:480px;margin:0 auto;background:#0d0d0d;border:1px solid #2a1a0d;border-radius:20px;padding:32px 24px;text-align:center">
<div style="font-size:30px;font-weight:800;color:#ff8a1a;letter-spacing:-0.03em">Kandi</div>
<h1 style="font-size:20px;margin:20px 0 8px;color:#fff7f0">${escapeHtml(title)}</h1>
<p style="color:#c8b8aa;font-size:15px;line-height:1.5;margin:0 0 24px">${escapeHtml(intro)}</p>
<a href="${escapeHtml(url)}" style="display:inline-block;background:#ff6a00;background:linear-gradient(90deg,#ff8a1a,#ff5c00);color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:999px">${escapeHtml(buttonText)}</a>
<p style="color:#8a7a6c;font-size:12px;line-height:1.5;margin:24px 0 0">Or paste this link into your browser:<br><span style="word-break:break-all;color:#c8b8aa">${escapeHtml(url)}</span></p>
<p style="color:#8a7a6c;font-size:12px;line-height:1.5;margin:16px 0 0">${escapeHtml(footer)}</p>
</div></body></html>`;
  const text = `${title}\n\n${intro}\n\n${buttonText}: ${url}\n\n${footer}\n\n— Kandi`;
  return { html, text };
}

function verifyMessage({ name, url }) {
  const body = layout(
    "Confirm your email",
    `${name ? "Hey " + name + "! " : ""}Tap the button below to confirm your email and activate your Kandi account.`,
    "Confirm my email",
    url,
    "This link works once and expires in 24 hours. If you didn't sign up for Kandi, you can ignore this email."
  );
  return { subject: "Confirm your Kandi email", ...body };
}

function resetMessage({ name, username, url }) {
  const body = layout(
    "Reset your password",
    `${name ? "Hey " + name + ". " : ""}Someone asked to reset the password for @${username || "your account"} on Kandi. Tap below to choose a new one.`,
    "Choose a new password",
    url,
    "This link works once and expires in 1 hour. If you didn't ask for this, ignore this email and your password stays the same."
  );
  return { subject: "Reset your Kandi password", ...body };
}

async function fetchJson(url, opts) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.Message || (data.error && (data.error.message || data.error)) || data.raw)) || res.statusText;
    const err = new Error("Email provider error " + res.status + ": " + String(msg).slice(0, 300));
    err.status = res.status;
    throw err;
  }
  return data;
}

let gmailToken = { value: "", exp: 0 };
async function gmailAccessToken(env) {
  if (gmailToken.value && Date.now() < gmailToken.exp - 60000) return gmailToken.value;
  const body = new URLSearchParams({
    client_id: env.GMAIL_CLIENT_ID,
    client_secret: env.GMAIL_CLIENT_SECRET,
    refresh_token: env.GMAIL_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const data = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  gmailToken = { value: data.access_token, exp: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return gmailToken.value;
}

function encodeHeader(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
}

function buildMime({ from, to, subject, text, html }) {
  const boundary = "kandi_" + crypto.randomBytes(8).toString("hex");
  return [
    from ? `From: ${from}` : null,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text, "utf8").toString("base64"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf8").toString("base64"),
    `--${boundary}--`,
    "",
  ].filter((l) => l !== null).join("\r\n");
}

async function sendMail({ to, subject, text, html, tag }, env = process.env) {
  const provider = detectProvider(env);
  const from = String(env.EMAIL_FROM || "").trim();
  if (provider === "none") return { sent: false, provider };
  if (provider === "console") {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${text}`);
    return { sent: true, provider };
  }
  if (provider === "resend") {
    if (!from) throw new Error("EMAIL_FROM is required to send with Resend.");
    const data = await fetchJson("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html, tags: tag ? [{ name: "type", value: tag }] : undefined }),
    });
    return { sent: true, provider, id: data && data.id };
  }
  if (provider === "postmark") {
    if (!from) throw new Error("EMAIL_FROM is required to send with Postmark.");
    const data = await fetchJson("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: text, HtmlBody: html, Tag: tag, MessageStream: env.POSTMARK_STREAM || "outbound" }),
    });
    return { sent: true, provider, id: data && data.MessageID };
  }
  if (provider === "gmail") {
    const token = await gmailAccessToken(env);
    const raw = Buffer.from(buildMime({ from: from || null, to, subject, text, html }), "utf8").toString("base64url");
    const data = await fetchJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    return { sent: true, provider, id: data && data.id };
  }
  return { sent: false, provider };
}

function status(env = process.env) {
  const provider = detectProvider(env);
  return {
    provider,
    canSend: provider !== "none",
    verificationActive: verificationActive(env),
    fromSet: Boolean(String(env.EMAIL_FROM || "").trim()),
  };
}

module.exports = {
  VERIFY_TTL_MS,
  RESET_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_SENDS_PER_HOUR,
  detectProvider,
  canSend,
  verificationActive,
  normalizeEmail,
  validateEmail,
  newToken,
  hashToken,
  isLocked,
  publicBase,
  rateLimit,
  verifyMessage,
  resetMessage,
  sendMail,
  status,
  buildMime,
};
