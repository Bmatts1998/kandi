"use strict";

// Instagram / Facebook profile links on a Kandi profile.
// We only ever store a normalized handle (never a raw URL) and build the https link ourselves,
// so nothing like javascript: or a look-alike domain can reach another user's screen.

const IG_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"]);
const FB_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "mbasic.facebook.com", "fb.com", "www.fb.com"]);
const IG_RESERVED = new Set(["p", "reel", "reels", "tv", "explore", "stories", "accounts", "direct", "about", "legal", "developer"]);
const FB_RESERVED = new Set(["groups", "pages", "events", "watch", "marketplace", "share", "sharer", "sharer.php", "login", "login.php", "help", "policies", "photo", "photo.php", "story.php", "permalink.php", "home.php", "hashtag", "gaming", "reel", "videos"]);

function parseMaybeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  // A scheme, a slash, or a real-looking domain (instagram.com, fb.com, evil.net) means "link";
  // a bare handle with dots (rave.girl, boston.mattsson) does not.
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:/i.test(s) || s.includes("/") || /\.(com|net|org|am|co|io|me|app|link)$/i.test(s);
  if (!looksLikeUrl) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return { bad: true }; // javascript:, data:, etc.
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    return { url: u };
  } catch (_) {
    return { bad: true };
  }
}

function normalizeInstagram(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { value: "" };
  let handle = s;
  const parsed = parseMaybeUrl(s);
  if (parsed) {
    if (parsed.bad || !IG_HOSTS.has(parsed.url.hostname.toLowerCase())) return { error: "Instagram must be your @handle or an instagram.com link." };
    handle = (parsed.url.pathname.split("/").filter(Boolean)[0] || "");
    if (IG_RESERVED.has(handle.toLowerCase())) return { error: "Use the link to your Instagram profile, not a post." };
  }
  handle = handle.replace(/^@+/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) return { error: "That Instagram handle doesn't look right. Use letters, numbers, periods, or underscores." };
  return { value: handle };
}

function normalizeFacebook(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { value: "" };
  let name = s;
  const parsed = parseMaybeUrl(s);
  if (parsed) {
    if (parsed.bad || !FB_HOSTS.has(parsed.url.hostname.toLowerCase())) return { error: "Facebook must be your username or a facebook.com profile link." };
    const parts = parsed.url.pathname.split("/").filter(Boolean);
    const first = (parts[0] || "").toLowerCase();
    if (first === "profile.php") {
      const id = parsed.url.searchParams.get("id") || "";
      if (!/^\d{3,20}$/.test(id)) return { error: "That Facebook profile link is missing its id." };
      return { value: "id:" + id };
    }
    if (first === "people" && parts[2] && /^\d{3,20}$/.test(parts[2])) return { value: "id:" + parts[2] };
    if (FB_RESERVED.has(first)) return { error: "Use the link to your Facebook profile." };
    name = parts[0] || "";
  }
  name = name.replace(/^@+/, "").trim();
  if (/^\d{5,20}$/.test(name)) return { value: "id:" + name };
  if (!/^[A-Za-z0-9.]{3,50}$/.test(name)) return { error: "That Facebook username doesn't look right. Use letters, numbers, or periods." };
  return { value: name.toLowerCase() };
}

function instagramUrl(handle) {
  return handle && /^[a-z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}/` : "";
}
function facebookUrl(value) {
  if (!value) return "";
  if (/^id:\d{3,20}$/.test(value)) return `https://www.facebook.com/profile.php?id=${value.slice(3)}`;
  return /^[a-z0-9.]{3,50}$/.test(value) ? `https://www.facebook.com/${value}` : "";
}
function publicSocials(u) {
  const ig = String((u && u.instagram) || "");
  const fb = String((u && u.facebook) || "");
  return {
    instagram: ig, instagramUrl: instagramUrl(ig),
    facebook: fb, facebookLabel: fb.startsWith("id:") ? "Facebook" : fb, facebookUrl: facebookUrl(fb),
  };
}

module.exports = { normalizeInstagram, normalizeFacebook, instagramUrl, facebookUrl, publicSocials };
