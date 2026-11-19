/* RetroRevente : service worker minimal pour l'appli installée.
   Il ne garde rien en cache sauf une page « hors connexion » : l'appli est toujours servie fraîche par le réseau,
   et les appels /api ne passent jamais par ici. */
const V = "rr-hl-1", HORS = "/hors-ligne.html";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll([HORS, "/img/icone-192.png"]))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(HORS)));
});
