// Kandi service worker: network-first for the app shell, cache-first for /uploads images.
// Never serve a stale app shell while online (old cached app.js was a cause of "nothing works").
const CACHE = "kandi-v13";
self.addEventListener("install", () => self.skipWaiting());
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
  e.respondWith(
    fetch(req, { cache: "no-store" }).then((res) => {
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === "navigate" ? caches.match("/", { ignoreSearch: true }) : undefined))
        .then((r) => r || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } }))
    )
  );
});
