/**
 * sw.js
 * Cachet alle app-bestanden zodat de companion volledig offline werkt
 * tijdens de tocht, ook zonder bereik.
 */

const CACHE_NAME = "doto2026-v3";
const TILE_CACHE_NAME = "doto2026-tiles-v1"; // zelfde naam als in map.js: gedeelde tegel-cache
const CORE_ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "route.js",
  "map.js",
  "checkpoints.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "route.gpx",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
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
      Promise.all(
        keys
          // de tegel-cache (kaarttegels) blijft altijd staan, ook bij een
          // nieuwe app-versie: die tegels blijven geldig en zijn duur om
          // opnieuw te downloaden.
          .filter((k) => k !== CACHE_NAME && k !== TILE_CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Kaarttegels van OpenStreetMap: cache-first, met de tegel-cache die de
// gebruiker vooraf kan vullen via "Kaarttegels downloaden" in Instellingen.
// Zo blijft de Kaart-tab bruikbaar zonder bereik tijdens de tocht.
function isTileRequest(request) {
  return request.url.includes("tile.openstreetmap.org");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (isTileRequest(event.request)) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request)
            .then((res) => {
              if (res && res.ok) cache.put(event.request, res.clone());
              return res;
            })
            .catch(() => cached); // offline en nog niet gedownload: geen tegel beschikbaar
        })
      )
    );
    return;
  }

  // Cache-first voor app-bestanden, met achtergrond-update ("stale-while-revalidate").
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
