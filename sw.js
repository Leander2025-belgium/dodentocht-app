"use strict";

const CACHE_NAME = "dodentocht-2026-shell-v4-4-0";

const APP_SHELL = [
  "./",
  "./index.html",
  "./live.html",
  "./style.css?v=4.4.0",
  "./config.js?v=4.4.0",
  "./app.js?v=4.4.0",
  "./live.js?v=4.4.0",
  "./route.js?v=4.4.0",
  "./map.js?v=4.4.0",
  "./checkpoints.js?v=4.4.0",
  "./manifest.webmanifest?v=4.4.0",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./route.gpx"
];

const OPTIONAL_CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    // Leaflet is nuttig voor de kaart, maar een tijdelijk CDN-probleem mag de
    // installatie van de lokale route en voortgang niet blokkeren.
    await Promise.allSettled(
      OPTIONAL_CDN_ASSETS.map(asset => cache.add(asset))
    );
  })());

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Geen bulk/offline caching van OpenStreetMap-tegels.
  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const fallback = url.pathname.endsWith("/live.html")
        ? "./live.html"
        : "./index.html";

      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (
          await caches.match(request, { ignoreSearch: true }) ||
          await caches.match(fallback)
        );
      }
    })());
    return;
  }

  // Eigen bestanden zijn network-first. Zo verschijnt een nieuwe GitHub
  // Pages-versie meteen en blijft de laatst geladen versie offline bruikbaar.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return caches.match(request, { ignoreSearch: true });
      }
    })());
    return;
  }

  // Bibliotheekbestanden: snel uit cache, tegelijk op de achtergrond vernieuwen.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request)
      .then(async response => {
        if (response.ok || response.type === "opaque") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => cached);

    return cached || network;
  })());
});
