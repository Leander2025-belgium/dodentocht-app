"use strict";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

class MapView {
  constructor(elId, route, checkpoints) {
    this.route = route;
    this.checkpoints = checkpoints;

    this.userLatLon = null;
    this.userAccuracyM = null;
    this.routeProjection = null;

    this.followMode = false;
    this.reachedIds = new Set();

    this.routeLine = null;
    this.walkedLine = null;
    this.userMarker = null;
    this.accuracyCircle = null;
    this.nextMarker = null;
    this.cpMarkers = new Map();

    this.map = L.map(elId, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true
    }).setView([51.09, 4.24], 12);

    L.tileLayer(TILE_URL, {
      minZoom: 9,
      maxZoom: 19,
      attribution: OSM_ATTRIBUTION,
      updateWhenIdle: true,
      keepBuffer: 3
    }).addTo(this.map);

    this.map.on("dragstart zoomstart", () => {
      if (this.followMode) {
        this.followMode = false;
        document.getElementById("mapFollowBtn")?.classList.remove("active");
      }
    });
  }

  renderRoute() {
    if (!this.route.loaded) return;

    const latlngs = this.route.points.map(p => [p.lat, p.lon]);

    if (this.routeLine) this.map.removeLayer(this.routeLine);

    this.routeLine = L.polyline(latlngs, {
      color: "#d9dde6",
      weight: 5,
      opacity: 0.48,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(this.map);

    this.cpMarkers.forEach(marker => this.map.removeLayer(marker));
    this.cpMarkers.clear();

    this.checkpoints.forEach(cp => {
      if (cp.km <= 0 || cp.km >= 100) return;

      const pt = this.route.pointAtDistance(cp.km);
      if (!pt) return;

      const reached = this.reachedIds.has(cp.id);
      const marker = L.circleMarker([pt.lat, pt.lon], {
        radius: reached ? 6 : 7,
        color: "#090b0f",
        weight: 2,
        fillColor: reached ? "#4ade80" : "#ff8a32",
        fillOpacity: 1
      });

      marker.bindPopup(
        `<strong>${escapeHtml(cp.name)}</strong><br>${cp.km.toFixed(1)} km`
      );

      marker.addTo(this.map);
      this.cpMarkers.set(cp.id, marker);
    });

    document.getElementById("mapEmpty").style.display = "none";
    this.fitFullRoute();
    this.updateProgress(0, null);
  }

  fitFullRoute() {
    this.followMode = false;
    document.getElementById("mapFollowBtn")?.classList.remove("active");

    if (this.routeLine) {
      this.map.fitBounds(this.routeLine.getBounds(), {
        paddingTopLeft: [24, 30],
        paddingBottomRight: [24, 160],
        animate: true
      });
    }
  }

  invalidateSize() {
    this.map.invalidateSize({ animate: false });
  }

  setFollowMode(enabled) {
    this.followMode = !!enabled;
    document.getElementById("mapFollowBtn")?.classList.toggle("active", this.followMode);

    if (this.followMode && this.userLatLon) {
      this._followUser(true);
    }
  }

  setUserPosition(lat, lon, accuracyM, projection) {
    this.userLatLon = { lat, lon };
    this.userAccuracyM = accuracyM || null;
    this.routeProjection = projection || null;

    const latlng = [lat, lon];

    if (!this.userMarker) {
      const icon = L.divIcon({
        className: "",
        html: '<div class="user-location-marker"></div>',
        iconSize: [19, 19],
        iconAnchor: [9.5, 9.5]
      });

      this.userMarker = L.marker(latlng, {
        icon,
        interactive: false,
        zIndexOffset: 1000
      }).addTo(this.map);

      this.accuracyCircle = L.circle(latlng, {
        radius: Math.max(5, accuracyM || 10),
        color: "#60a9ff",
        weight: 1,
        opacity: 0.24,
        fillColor: "#60a9ff",
        fillOpacity: 0.08,
        interactive: false
      }).addTo(this.map);
    } else {
      this.userMarker.setLatLng(latlng);
      this.accuracyCircle.setLatLng(latlng);
      this.accuracyCircle.setRadius(Math.max(5, accuracyM || 10));
    }

    if (projection) {
      this.updateProgress(projection.km, projection);
    }

    if (this.followMode) {
      this._followUser(false);
    }
  }

  _followUser(forceZoom) {
    if (!this.userLatLon) return;

    const target = [this.userLatLon.lat, this.userLatLon.lon];
    const zoom = forceZoom ? Math.max(this.map.getZoom(), 16) : this.map.getZoom();

    if (forceZoom) {
      this.map.setView(target, zoom, { animate: true });
    } else {
      this.map.panTo(target, { animate: true, duration: 0.35 });
    }
  }

  updateProgress(distanceKm, projection = null) {
    if (!this.route.loaded) return;

    const walked = this.route.sliceToDistance(distanceKm);

    if (this.walkedLine) {
      this.map.removeLayer(this.walkedLine);
      this.walkedLine = null;
    }

    if (walked.length > 1) {
      this.walkedLine = L.polyline(walked, {
        color: "#ff5a36",
        weight: 6,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(this.map);
    }

    this._updateNextCheckpointMarker(distanceKm);
    this._updateOffRouteUI(projection);
  }

  _updateNextCheckpointMarker(distanceKm) {
    const next = this.checkpoints.find(cp => cp.km > distanceKm + 0.02);

    if (this.nextMarker) {
      this.map.removeLayer(this.nextMarker);
      this.nextMarker = null;
    }

    if (!next || next.km >= 100) return;

    const pt = this.route.pointAtDistance(next.km);
    if (!pt) return;

    this.nextMarker = L.circleMarker([pt.lat, pt.lon], {
      radius: 11,
      color: "rgba(255,255,255,.92)",
      weight: 3,
      fillColor: "#ffb52e",
      fillOpacity: 1
    }).addTo(this.map);

    this.nextMarker.bindPopup(
      `<strong>Volgende: ${escapeHtml(next.name)}</strong><br>${next.km.toFixed(1)} km`
    );
  }

  _updateOffRouteUI(projection) {
    const banner = document.getElementById("offRouteBanner");
    const text = document.getElementById("offRouteText");
    if (!banner || !text) return;

    const offset = projection?.offsetM ?? 0;

    if (offset > 70) {
      banner.hidden = false;
      text.textContent = `Je bent ongeveer ${Math.round(offset)} m van het parcours.`;
    } else {
      banner.hidden = true;
    }
  }

  setReached(idsSet) {
    this.reachedIds = idsSet;

    this.cpMarkers.forEach((marker, id) => {
      const reached = idsSet.has(id);
      marker.setStyle({
        radius: reached ? 6 : 7,
        fillColor: reached ? "#4ade80" : "#ff8a32"
      });
    });
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
