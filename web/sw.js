// Service worker : app installable + consultation hors ligne de la dernière version vue.
const CACHE = "compo-fc-v1";
const SHELL = ["/", "/shim.js", "/manifest.webmanifest", "/favicon.ico", "/favicon-32.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== location.origin || u.pathname === "/login" || u.pathname === "/api/me") return;
  // Réseau d'abord (données toujours fraîches), cache en secours hors ligne.
  e.respondWith(fetch(r).then(res => {
    if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r).then(m => m || caches.match("/"))));
});
