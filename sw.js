// Minimal service worker: lets the app be installed, shows notifications, and keeps the app shell
// available offline. Data requests always go to the network.
const SHELL = "grid-shell-v1";
const FILES = ["./", "index.html", "css/app.css", "js/app.js", "js/core.js", "js/api.js", "js/store.js", "js/prices.js", "js/grid.js", "js/map.js", "js/forecast.js", "js/alerts.js", "data/mapdata.json", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // APIs: straight to network
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(cs => { const c = cs.find(x => "focus" in x); return c ? c.focus() : self.clients.openWindow("./#prices"); }));
});
