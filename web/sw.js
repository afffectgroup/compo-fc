// Service worker : app installable, ouverture instantanée et consultation hors ligne.
// - Page, scripts et icônes : servis tout de suite depuis le cache, mis à jour en arrière-plan.
// - Données (/api) : réseau d'abord, cache en secours hors ligne.
const CACHE = "compo-fc-v2";
const SHELL = ["/", "/shim.js", "/flags.js?v=1", "/manifest.webmanifest", "/favicon.ico", "/favicon-32.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

function refresh(req, key) {
  return fetch(req).then(res => {
    if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key || req, copy)); }
    return res;
  });
}

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  if (u.pathname === "/login" || u.pathname === "/logout" || u.pathname === "/api/me" || u.pathname === "/sw.js") return;

  if (u.pathname.startsWith("/api/")) {
    e.respondWith(refresh(r).catch(() => caches.match(r)));
    return;
  }
  // Page et fichiers de l'app : cache immédiat + mise à jour en arrière-plan
  const key = r.mode === "navigate" ? "/" : r;
  e.respondWith(caches.match(key).then(hit => {
    const net = refresh(r, key).catch(() => hit);
    if (hit) { e.waitUntil(net.then(() => {}, () => {})); return hit; }
    return net;
  }));
});
