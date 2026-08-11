/**
 * map.js
 * Echte kaart (straten, gebouwen, ...) op basis van Leaflet + OpenStreetMap-
 * tegels, met de route, controleposten en live positie erop getekend.
 *
 * Kaarttegels komen normaal via internet. Om de kaart ook tijdens de tocht
 * zonder bereik te laten werken, kan de gebruiker vooraf (thuis, via wifi)
 * alle tegels langs de route downloaden — zie downloadRouteTiles(). Die
 * tegels worden bewaard in de Cache Storage van de browser onder
 * TILE_CACHE_NAME, en sw.js dient ze nadien cache-first terug, ook offline.
 */

"use strict";

const TILE_CACHE_NAME = "doto2026-tiles-v1";
const TILE_URL_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers';

class MapView {
  constructor(elId, route, checkpoints) {
    this.route = route;
    this.checkpoints = checkpoints;
    this.userLatLon = null;
    this.reachedIds = new Set();
    this.followMode = false;

    this.map = L.map(elId, {
      zoomControl: false,
      attributionControl: true,
    }).setView([51.09, 4.24], 12); // voorlopig centrum, wordt overschreven zodra de route geladen is

    L.tileLayer(TILE_URL_TEMPLATE, {
      maxZoom: 18,
      minZoom: 9,
      attribution: OSM_ATTRIBUTION,
    }).addTo(this.map);

    L.control.zoom({ position: "bottomright" }).addTo(this.map);

    this.routeLine = null;
    this.walkedLine = null;
    this.cpMarkers = new Map(); // id -> marker
    this.userMarker = null;
    this.userHalo = null;
  }

  /* ---------------- Route & controleposten tekenen ---------------- */

  renderRoute() {
    if (!this.route.loaded) return;

    const latlngs = this.route.points.map((p) => [p.lat, p.lon]);

    if (this.routeLine) this.map.removeLayer(this.routeLine);
    this.routeLine = L.polyline(latlngs, {
      color: "#f5f6f7",
      weight: 4,
      opacity: 0.65,
    }).addTo(this.map);

    this.checkpoints.forEach((cp) => {
      if (cp.km === 0 || cp.km === 100) return;
      const pt = this.route.pointAtDistance(cp.km);
      if (!pt) return;
      const marker = L.circleMarker([pt.lat, pt.lon], {
        radius: 7,
        color: "#0a0a0e",
        weight: 2,
        fillColor: "#f5b942",
        fillOpacity: 1,
      }).bindPopup(`<b>${cp.name}</b><br>${cp.km} km`);
      marker.addTo(this.map);
      this.cpMarkers.set(cp.id, marker);
    });

    this.map.fitBounds(this.routeLine.getBounds(), { padding: [30, 30] });
    document.getElementById("mapEmpty").style.display = "none";
  }

  /** Kaart terug op de volledige route centreren. */
  resetView() {
    this.followMode = false;
    if (this.routeLine) {
      this.map.fitBounds(this.routeLine.getBounds(), { padding: [30, 30] });
    }
  }

  /** Kaart moet opnieuw de juiste afmetingen kennen nadat het tabblad zichtbaar werd. */
  invalidateSize() {
    this.map.invalidateSize();
  }

  /* ---------------- Live positie & voortgang ---------------- */

  setUserPosition(lat, lon) {
    this.userLatLon = { lat, lon };

    if (!this.userMarker) {
      this.userHalo = L.circleMarker([lat, lon], {
        radius: 14, color: "transparent", fillColor: "#4ade9a", fillOpacity: 0.22,
      }).addTo(this.map);
      this.userMarker = L.circleMarker([lat, lon], {
        radius: 7, color: "#06140d", weight: 2, fillColor: "#4ade9a", fillOpacity: 1,
      }).addTo(this.map);
    } else {
      this.userHalo.setLatLng([lat, lon]);
      this.userMarker.setLatLng([lat, lon]);
    }

    this._updateWalkedLine();

    if (this.followMode) this.map.panTo([lat, lon], { animate: true });
  }

  _updateWalkedLine() {
    if (!this.route.loaded || !this.userLatLon) return;
    const proj = this.route.projectDistanceKm(this.userLatLon.lat, this.userLatLon.lon, null);
    if (!proj) return;
    const walked = this.route.points.slice(0, proj.index + 1).map((p) => [p.lat, p.lon]);

    if (this.walkedLine) this.map.removeLayer(this.walkedLine);
    this.walkedLine = L.polyline(walked, { color: "#4ade9a", weight: 5, opacity: 0.9 }).addTo(this.map);
  }

  setReached(idsSet) {
    this.reachedIds = idsSet;
    this.cpMarkers.forEach((marker, id) => {
      const reached = idsSet.has(id);
      marker.setStyle({ fillColor: reached ? "#4ade9a" : "#f5b942" });
    });
  }
}

/* ==========================================================================
   OFFLINE TEGELS DOWNLOADEN
   Berekent alle tegels die de bounding box van de route overlappen voor een
   reeks zoomniveaus, en haalt ze één voor één op zodat ze in de Cache
   Storage terechtkomen. Nadien dient sw.js dezelfde tegels cache-first,
   ook zonder internet.
   ========================================================================== */

function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

function tilesForBounds(bounds, zoom, bufferTiles = 1) {
  const xMin = lonToTileX(bounds.minLon, zoom) - bufferTiles;
  const xMax = lonToTileX(bounds.maxLon, zoom) + bufferTiles;
  // let op: bij hogere breedtegraad geeft een hogere lat een lagere tileY
  const yMin = latToTileY(bounds.maxLat, zoom) - bufferTiles;
  const yMax = latToTileY(bounds.minLat, zoom) + bufferTiles;

  const tiles = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
}

/**
 * Download alle tegels die de route overlappen voor zoom 12 t/m 16
 * (overzicht t/m straatniveau) en bewaart ze in de Cache Storage.
 * Roept onProgress(done, total) aan tijdens het lopen.
 */
async function downloadRouteTiles(route, onProgress) {
  if (!route.loaded) throw new Error("Route nog niet geladen");

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  route.points.forEach((p) => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  });
  const bounds = { minLat, maxLat, minLon, maxLon };

  const zoomLevels = [12, 13, 14, 15, 16];
  let allTiles = [];
  zoomLevels.forEach((z) => {
    allTiles = allTiles.concat(tilesForBounds(bounds, z, 1));
  });

  const cache = await caches.open(TILE_CACHE_NAME);
  const total = allTiles.length;
  let done = 0;

  for (const t of allTiles) {
    const url = `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
    try {
      const existing = await cache.match(url);
      if (!existing) {
        const res = await fetch(url, { mode: "cors" });
        if (res && res.ok) await cache.put(url, res.clone());
      }
    } catch (e) {
      // enkele mislukte tegels (bv. tijdelijk geen netwerk) mogen de rest niet blokkeren
    }
    done++;
    if (onProgress) onProgress(done, total);
    // korte pauze tussen aanvragen: respectvol tegenover de gratis OSM-tegelserver
    await new Promise((r) => setTimeout(r, 40));
  }

  return { total, done };
}
