// Kandi service worker: network-first for the app shell, cache-first for /uploads images.
// Never serve a stale app shell while online (old cached app.js was a cause of "nothing works").
// Navigations that fail go to the branded /offline page, not a cached black SPA shell.
const CACHE = "kandi-v17";
const OFFLINE_URL = "/offline";
const OFFLINE_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#000000"><title>Can't reach Kandi</title><style>html,body{height:100%;margin:0;background:#000;color:#fff7f0;font:16px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}h1{letter-spacing:.28em;text-transform:uppercase;font-size:18px;color:#ff6a00}h2{margin:18px 0 8px;font-size:24px}p{color:rgba(255,247,240,.78)}button{margin-top:24px;height:52px;padding:0 28px;border:0;border-radius:999px;background:linear-gradient(90deg,#ff8a1a,#ff5c00);color:#fff;font:700 16px/1 -apple-system,sans-serif}</style></head><body><div><h1>Kandi</h1><h2>Can't reach Kandi</h2><p>Check your connection, then try again.</p><button type="button" onclick="location.href='/'">Try again</button></div><script>window.addEventListener("online",function(){location.href="/"});</script></body></html>`;

function offlineResponse(cached) {
  if (cached) return cached;
  return new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function isNavigate(req) {
  if (req.mode === "navigate") return true;
  if (req.destination === "document") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) return;
  if (url.pathname.startsWith("/uploads")) {
    if (req.headers.get("range")) return;
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      const ctype = String((res && res.headers.get("content-type")) || "");
      if (res && res.ok && res.status === 200 && ctype.startsWith("image/")) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })());
    return;
  }
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: "no-store" });
      if (res && res.ok && res.type === "basic") {
        const path = url.pathname;
        // Do not cache the SPA shell: serving it offline paints a black #app.
        const spaShell = path === "/" || path === "/index.html" || path === "/app.js";
        if (!spaShell) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
      }
      return res;
    } catch (_) {
      if (isNavigate(req) || url.pathname === OFFLINE_URL || url.pathname === "/offline.html") {
        const cached = await caches.match(OFFLINE_URL, { ignoreSearch: true });
        return offlineResponse(cached);
      }
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  })());
});
