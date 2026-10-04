// Atlas offline cache. The page, scripts and data are fetched fresh when online and served from the cache when not;
// terrain and imagery packs, pictures and fonts are kept once fetched, since they never change under the same name.
const SHELL = "atlas-shell-v1", KEEP = "atlas-keep-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["./", "index.html", "app.js", "style.css", "vendor/maplibre-gl.css", "manifest.webmanifest"]).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("atlas-") && k !== SHELL && k !== KEEP).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const keep = (url) => url.origin === location.origin ? /\/(tiles|vendor)\/|\/data\/img\/|\/docs\/img\//.test(url.pathname)
  : /fonts\.(googleapis|gstatic)\.com$|cdn\.jsdelivr\.net$/.test(url.hostname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (keep(url)) {
    // Cache first: these files are large and do not change.
    e.respondWith(caches.open(KEEP).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") c.put(req, res.clone()).catch(() => {});
      return res;
    }));
  } else if (url.origin === location.origin) {
    // Network first: the page, app and data update with each release; the cache covers going offline.
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.open(SHELL).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => hit || Response.error())));
  }
});
