/**
 * sw.js
 * Cachet alle app-bestanden zodat de companion volledig offline werkt
 * tijdens de tocht, ook zonder bereik.
 */

const CACHE_NAME = "doto2026-v1";
const CORE_ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "route.js",
  "checkpoints.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "route.gpx",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // route.gpx is optioneel: als het (nog) niet aanwezig is, mag de
      // installatie van de rest van de app niet mislukken.
      Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            /* bv. route.gpx nog niet geplaatst; wordt later via fetch gecachet */
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first voor app-bestanden, met achtergrond-update ("stale-while-revalidate").
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
