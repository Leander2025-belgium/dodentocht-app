"use strict";

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return deg * Math.PI / 180;
}

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

class Route {
  constructor() {
    this.points = [];
    this.cumDist = [];
    this.totalDistM = 0;
    this.loaded = false;
  }

  loadFromGpxText(gpxText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(gpxText, "application/xml");

    if (xml.querySelector("parsererror")) {
      throw new Error("Ongeldig GPX-bestand.");
    }

    let nodes = xml.querySelectorAll("trkpt");
    if (!nodes.length) nodes = xml.querySelectorAll("rtept");

    if (!nodes.length) {
      throw new Error("Geen track- of routepunten gevonden.");
    }

    const pts = [];
    nodes.forEach(node => {
      const lat = Number(node.getAttribute("lat"));
      const lon = Number(node.getAttribute("lon"));
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        pts.push({ lat, lon });
      }
    });

    if (pts.length < 2) {
      throw new Error("Te weinig geldige routepunten.");
    }

    this._buildFromPoints(pts);
    return this;
  }

  _buildFromPoints(pts) {
    this.points = pts;
    this.cumDist = new Array(pts.length).fill(0);

    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += haversine(
        pts[i - 1].lat,
        pts[i - 1].lon,
        pts[i].lat,
        pts[i].lon
      );
      this.cumDist[i] = total;
    }

    this.totalDistM = total;
    this.loaded = pts.length > 1;
  }

  pointAtDistance(km) {
    if (!this.loaded) return null;

    const targetM = Math.max(0, Math.min(this.totalDistM, km * 1000));

    let lo = 0;
    let hi = this.cumDist.length - 1;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cumDist[mid] < targetM) lo = mid + 1;
      else hi = mid;
    }

    const i = Math.max(1, lo);
    const startM = this.cumDist[i - 1];
    const endM = this.cumDist[i];
    const segmentM = endM - startM || 1;
    const t = Math.max(0, Math.min(1, (targetM - startM) / segmentM));

    const a = this.points[i - 1];
    const b = this.points[i];

    return {
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      index: i - 1,
      t
    };
  }

  projectDistanceKm(lat, lon, prevIndexHint = null) {
    if (!this.loaded) return null;

    let searchStart = 0;
    let searchEnd = this.points.length - 1;

    if (Number.isInteger(prevIndexHint)) {
      const windowSize = 500;
      searchStart = Math.max(0, prevIndexHint - windowSize);
      searchEnd = Math.min(this.points.length - 1, prevIndexHint + windowSize);
    }

    let best = this._scanSegments(lat, lon, searchStart, searchEnd);

    const nearWindowEdge =
      Number.isInteger(prevIndexHint) &&
      (best.index <= searchStart + 2 || best.index >= searchEnd - 2);

    if (nearWindowEdge || best.offsetM > 120) {
      const full = this._scanSegments(lat, lon, 0, this.points.length - 1);
      if (full.offsetM < best.offsetM) best = full;
    }

    const segStart = this.cumDist[best.index];
    const segEnd = this.cumDist[best.index + 1];
    const distM = segStart + (segEnd - segStart) * best.t;

    return {
      km: distM / 1000,
      index: best.index,
      offsetM: best.offsetM,
      t: best.t,
      snapped: best.snapped
    };
  }

  _scanSegments(lat, lon, start, end) {
    let bestDist = Infinity;
    let bestIndex = start;
    let bestT = 0;
    let snapped = null;

    for (let i = start; i < end; i++) {
      const d = this._distToSegment(lat, lon, this.points[i], this.points[i + 1]);
      if (d.dist < bestDist) {
        bestDist = d.dist;
        bestIndex = i;
        bestT = d.t;
        snapped = d.snapped;
      }
    }

    return {
      offsetM: bestDist,
      index: bestIndex,
      t: bestT,
      snapped
    };
  }

  _distToSegment(lat, lon, a, b) {
    const latRef = toRad((a.lat + b.lat) / 2);
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(latRef);

    const px = (lon - a.lon) * mPerDegLon;
    const py = (lat - a.lat) * mPerDegLat;
    const bx = (b.lon - a.lon) * mPerDegLon;
    const by = (b.lat - a.lat) * mPerDegLat;

    const lenSq = bx * bx + by * by || 1e-9;
    let t = (px * bx + py * by) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const cx = bx * t;
    const cy = by * t;
    const dx = px - cx;
    const dy = py - cy;

    return {
      dist: Math.hypot(dx, dy),
      t,
      snapped: {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t
      }
    };
  }

  sliceToDistance(km) {
    if (!this.loaded) return [];
    const p = this.pointAtDistance(km);
    if (!p) return [];

    const out = this.points
      .slice(0, p.index + 1)
      .map(pt => [pt.lat, pt.lon]);

    out.push([p.lat, p.lon]);
    return out;
  }

  get totalKm() {
    return this.totalDistM / 1000;
  }
}
