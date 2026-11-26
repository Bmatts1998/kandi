"use strict";

// S3-compatible object storage (Cloudflare R2, Backblaze B2, or any S3 API).
// Inactive unless KANDI_S3_ENDPOINT, KANDI_S3_BUCKET, KANDI_S3_ACCESS_KEY_ID,
// and KANDI_S3_SECRET_ACCESS_KEY are all set. When they are missing, callers
// must keep using the current Postgres/SQLite base64 storage.

const crypto = require("crypto");
const { URL } = require("url");

function trim(v) {
  return String(v == null ? "" : v).trim();
}

function envFirst(names) {
  for (const name of names) {
    const v = trim(process.env[name]);
    if (v) return v;
  }
  return "";
}

function truthy(v, fallback) {
  if (v == null || v === "") return fallback;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

function config() {
  const endpoint = envFirst(["KANDI_S3_ENDPOINT", "S3_ENDPOINT"]).replace(/\/$/, "");
  const bucket = envFirst(["KANDI_S3_BUCKET", "S3_BUCKET"]);
  const accessKeyId = envFirst(["KANDI_S3_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID"]);
  const secretAccessKey = envFirst(["KANDI_S3_SECRET_ACCESS_KEY", "S3_SECRET_ACCESS_KEY"]);
  const region = envFirst(["KANDI_S3_REGION", "S3_REGION"]) || "auto";
  const publicBase = envFirst(["KANDI_S3_PUBLIC_BASE_URL", "S3_PUBLIC_BASE_URL"]).replace(/\/$/, "");
  const pathStyle = truthy(envFirst(["KANDI_S3_FORCE_PATH_STYLE", "S3_FORCE_PATH_STYLE"]), true);
  const enabled = !!(endpoint && bucket && accessKeyId && secretAccessKey);
  return { enabled, endpoint, bucket, accessKeyId, secretAccessKey, region, publicBase, pathStyle };
}

function enabled() {
  return config().enabled;
}

function clientConfig() {
  const on = enabled();
  return { enabled: on, directUpload: on };
}

function encodeRfc3986(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function encodeKey(key) {
  return String(key || "").split("/").map(encodeRfc3986).join("/");
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function amzStamp(d) {
  return (d || new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(secret, day, region) {
  return hmac(hmac(hmac(hmac("AWS4" + secret, day), region), "s3"), "aws4_request");
}

function objectUrl(cfg, key) {
  const base = cfg.endpoint;
  const k = encodeKey(key);
  if (cfg.pathStyle) return base + "/" + cfg.bucket + "/" + k;
  const u = new URL(base);
  return u.protocol + "//" + cfg.bucket + "." + u.host + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")) + "/" + k;
}

function hostFor(cfg) {
  const u = new URL(cfg.pathStyle ? cfg.endpoint + "/" + cfg.bucket : objectUrl(cfg, "x"));
  return u.host;
}

function canonicalQuery(query) {
  const keys = Object.keys(query).sort();
  return keys.map((k) => encodeRfc3986(k) + "=" + encodeRfc3986(query[k])).join("&");
}

function signedHeadersOf(headers) {
  return Object.keys(headers).map((k) => k.toLowerCase()).sort().join(";");
}

function canonicalHeaders(headers) {
  const pairs = Object.keys(headers).map((k) => [k.toLowerCase(), String(headers[k]).trim().replace(/\s+/g, " ")]);
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs.map((p) => p[0] + ":" + p[1] + "\n").join("");
}

function authorization(cfg, { method, url, headers, query, payloadHash, amz }) {
  const u = new URL(url);
  const day = amz.slice(0, 8);
  const cred = cfg.accessKeyId + "/" + day + "/" + cfg.region + "/s3/aws4_request";
  const signedHeaders = signedHeadersOf(headers);
  const canonical = [
    method.toUpperCase(),
    u.pathname,
    canonicalQuery(query || {}),
    canonicalHeaders(headers),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    day + "/" + cfg.region + "/s3/aws4_request",
    sha256Hex(canonical),
  ].join("\n");
  const sig = crypto.createHmac("sha256", signingKey(cfg.secretAccessKey, day, cfg.region)).update(stringToSign, "utf8").digest("hex");
  return { signature: sig, credential: cred, signedHeaders, authorization: "AWS4-HMAC-SHA256 Credential=" + cred + ", SignedHeaders=" + signedHeaders + ", Signature=" + sig };
}

function safeFileId(id) {
  const s = String(id || "").replace(/[^A-Za-z0-9._-]/g, "");
  return s.slice(0, 180);
}

function keyFor({ visibility, kind, userId, fileId, matchId }) {
  const id = safeFileId(fileId) || (Date.now() + "-" + crypto.randomBytes(6).toString("hex"));
  const vis = visibility === "private" ? "private" : "public";
  const k = String(kind || "files");
  if (k === "chat") return vis + "/chat/" + Number(matchId || 0) + "/" + id;
  if (k === "selfies") return vis + "/selfies/" + Number(userId || 0) + "/" + id;
  if (k === "videos") return vis + "/videos/" + Number(userId || 0) + "/" + id;
  return vis + "/photos/" + Number(userId || 0) + "/" + id;
}

function isPrivateKey(key) {
  return String(key || "").startsWith("private/");
}

function publicReadUrl(cfg, key) {
  if (!cfg.publicBase || isPrivateKey(key)) return null;
  return cfg.publicBase + "/" + encodeKey(key);
}

function presign(cfg, { method, key, expires, contentType, headers }) {
  if (!cfg.enabled) throw new Error("Object storage is not configured.");
  const amz = amzStamp();
  const day = amz.slice(0, 8);
  const url = objectUrl(cfg, key);
  const u = new URL(url);
  const expiresSec = Math.max(60, Math.min(7 * 24 * 3600, Number(expires) || 3600));
  const extra = Object.assign({}, headers || {});
  if (contentType) extra["content-type"] = contentType;
  extra.host = u.host;
  const payloadHash = "UNSIGNED-PAYLOAD";
  const cred = cfg.accessKeyId + "/" + day + "/" + cfg.region + "/s3/aws4_request";
  const signedHeaderNames = Object.keys(extra).map((k) => k.toLowerCase()).sort();
  const query = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": cred,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(expiresSec),
    "X-Amz-SignedHeaders": signedHeaderNames.join(";"),
  };
  const head = {};
  for (const [k, v] of Object.entries(extra)) head[k.toLowerCase()] = v;
  const auth = authorization(cfg, { method, url, headers: head, query, payloadHash, amz });
  query["X-Amz-Signature"] = auth.signature;
  u.search = "?" + canonicalQuery(query);
  const outHeaders = {};
  if (contentType) outHeaders["Content-Type"] = contentType;
  return { url: u.toString(), method: method.toUpperCase(), headers: outHeaders, expires: expiresSec };
}

function presignPut(key, { contentType, expires } = {}) {
  return presign(config(), { method: "PUT", key, contentType, expires: expires || 15 * 60, headers: {} });
}

function presignGet(key, { expires } = {}) {
  const cfg = config();
  const pub = publicReadUrl(cfg, key);
  if (pub) return { url: pub, method: "GET", headers: {}, expires: 0, public: true };
  const secs = expires || (isPrivateKey(key) ? 15 * 60 : 6 * 3600);
  return Object.assign(presign(cfg, { method: "GET", key, expires: secs }), { public: false });
}

function readUrl(key, opts) {
  return presignGet(key, opts).url;
}

async function request(cfg, { method, key, body, contentType, query }) {
  const amz = amzStamp();
  const url = objectUrl(cfg, key) + (query ? "?" + canonicalQuery(query) : "");
  const u = new URL(url);
  const payloadHash = body ? sha256Hex(body) : sha256Hex("");
  const headers = {
    host: u.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
  };
  if (contentType) headers["content-type"] = contentType;
  if (body) headers["content-length"] = String(body.length);
  const q = {};
  if (query) Object.assign(q, query);
  const auth = authorization(cfg, { method, url: u.origin + u.pathname, headers, query: q, payloadHash, amz });
  headers.authorization = auth.authorization;
  const res = await fetch(url, { method, headers, body: body || undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status >= 400) {
    const text = buf.toString("utf8").slice(0, 500);
    const err = new Error("S3 " + method + " " + res.status + (text ? ": " + text : ""));
    err.status = res.status;
    throw err;
  }
  return { status: res.status, headers: res.headers, body: buf };
}

async function putObject({ key, body, contentType }) {
  const cfg = config();
  if (!cfg.enabled) throw new Error("Object storage is not configured.");
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  await request(cfg, { method: "PUT", key, body: buf, contentType: contentType || "application/octet-stream" });
  return { key, bytes: buf.length };
}

async function getObject(key) {
  const cfg = config();
  if (!cfg.enabled) return null;
  try {
    const r = await request(cfg, { method: "GET", key });
    return { body: r.body, contentType: r.headers.get("content-type") || "application/octet-stream" };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function headObject(key) {
  const cfg = config();
  if (!cfg.enabled) return null;
  try {
    const r = await request(cfg, { method: "HEAD", key });
    return {
      contentType: r.headers.get("content-type") || "application/octet-stream",
      contentLength: Number(r.headers.get("content-length") || 0),
    };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function deleteObject(key) {
  if (!key) return;
  const cfg = config();
  if (!cfg.enabled) return;
  try {
    await request(cfg, { method: "DELETE", key });
  } catch (err) {
    if (err.status !== 404) console.error("object-store delete", key, err.message || err);
  }
}

async function deleteKeys(keys) {
  const list = Array.from(new Set((keys || []).filter(Boolean)));
  for (const key of list) await deleteObject(key);
}

function corsOrigins() {
  const extra = envFirst(["KANDI_S3_CORS_ORIGINS", "S3_CORS_ORIGINS"]);
  const set = new Set([
    "https://kandi-6rih.onrender.com",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
    "capacitor://localhost",
    "https://localhost",
    "http://localhost",
  ]);
  if (extra) extra.split(",").map((s) => s.trim()).filter(Boolean).forEach((o) => set.add(o));
  if (process.env.RENDER_EXTERNAL_URL) set.add(String(process.env.RENDER_EXTERNAL_URL).replace(/\/$/, ""));
  return Array.from(set);
}

function corsXml() {
  const origins = corsOrigins().map((o) => "<AllowedOrigin>" + o.replace(/&/g, "&amp;") + "</AllowedOrigin>").join("");
  return '<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration>' +
    "<CORSRule>" + origins +
    "<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>" +
    "<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><ExposeHeader>x-amz-request-id</ExposeHeader>" +
    "<MaxAgeSeconds>86400</MaxAgeSeconds></CORSRule></CORSConfiguration>";
}

async function applyBucketCors() {
  const cfg = config();
  if (!cfg.enabled) return false;
  const body = Buffer.from(corsXml(), "utf8");
  const amz = amzStamp();
  const url = cfg.pathStyle
    ? cfg.endpoint + "/" + cfg.bucket + "?cors"
    : (() => { const u = new URL(cfg.endpoint); return u.protocol + "//" + cfg.bucket + "." + u.host + "?cors"; })();
  const u = new URL(url);
  const payloadHash = sha256Hex(body);
  const headers = {
    host: u.host,
    "content-type": "application/xml",
    "content-length": String(body.length),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
  };
  const query = { cors: "" };
  const auth = authorization(cfg, { method: "PUT", url: u.origin + u.pathname, headers, query, payloadHash, amz });
  headers.authorization = auth.authorization;
  const res = await fetch(url, { method: "PUT", headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("S3 CORS " + res.status + (text ? ": " + text.slice(0, 400) : ""));
  }
  return true;
}

let corsTried = false;
function applyBucketCorsOnce() {
  if (corsTried || !enabled()) return;
  corsTried = true;
  applyBucketCors().then(() => {
    console.log("object-store: bucket CORS applied");
  }).catch((err) => {
    console.error("object-store: could not apply bucket CORS (set it in the dashboard if direct uploads fail):", err.message || err);
  });
}

function keyOwnedBy(key, { userId, matchId, kind }) {
  const k = String(key || "");
  if (kind === "chat") return k.startsWith("private/chat/" + Number(matchId || 0) + "/");
  if (kind === "selfies") return k.startsWith("private/selfies/" + Number(userId || 0) + "/");
  if (kind === "videos") return k.startsWith("public/videos/" + Number(userId || 0) + "/");
  if (kind === "photos" || kind === "poster") return k.startsWith("public/photos/" + Number(userId || 0) + "/") || k.startsWith("public/videos/" + Number(userId || 0) + "/");
  return k.includes("/" + Number(userId || 0) + "/");
}

module.exports = {
  config,
  enabled,
  clientConfig,
  keyFor,
  isPrivateKey,
  presignPut,
  presignGet,
  readUrl,
  putObject,
  getObject,
  headObject,
  deleteObject,
  deleteKeys,
  applyBucketCors,
  applyBucketCorsOnce,
  keyOwnedBy,
  corsOrigins,
};
