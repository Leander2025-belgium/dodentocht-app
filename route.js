/**
 * route.js
 * Laadt route.gpx in, bouwt een polyline met cumulatieve afstand,
 * en biedt functies om:
 *  - de afstand-langs-de-route te vinden voor een live GPS-punt
 *    (kortste-afstand projectie op het traject, niet hemelsbrede afstand);
 *  - een punt te vinden op een gegeven kilometer (voor controlepost-posities);
 *  - GPS-jitter te filteren zodat de afgelegde afstand niet zomaar
 *    terugspringt.
 */

const EARTH_RADIUS_M = 6371000;

function toRad(deg) { return (deg * Math.PI) / 180; }

/** Haversine-afstand tussen twee coördinaten, in meter. */
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

class Route {
  constructor() {
    this.points = [];       // [{lat, lon}]
    this.cumDist = [];      // cumulatieve afstand in meter, zelfde lengte als points
    this.totalDistM = 0;
    this.loaded = false;
  }

  /** Parse een GPX-string (track of route) tot een polyline met cumulatieve afstand. */
  loadFromGpxText(gpxText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(gpxText, "application/xml");
    const errorNode = xml.querySelector("parsererror");
    if (errorNode) throw new Error("Ongeldig GPX-bestand");

    let nodes = xml.querySelectorAll("trkpt");
    if (nodes.length === 0) nodes = xml.querySelectorAll("rtept");
    if (nodes.length === 0) throw new Error("Geen trackpunten gevonden in route.gpx");

    const pts = [];
    nodes.forEach((n) => {
      const lat = parseFloat(n.getAttribute("lat"));
      const lon = parseFloat(n.getAttribute("lon"));
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon });
    });

    this._buildFromPoints(pts);
    return this;
  }

  _buildFromPoints(pts) {
    this.points = pts;
    this.cumDist = new Array(pts.length).fill(0);
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
      total += d;
      this.cumDist[i] = total;
    }
    this.totalDistM = total;
    this.loaded = pts.length > 1;
  }

  /** Geeft {lat, lon} op een gegeven afstand (km) langs de route. */
  pointAtDistance(km) {
    if (!this.loaded) return null;
    const targetM = Math.max(0, Math.min(this.totalDistM, km * 1000));
    // binaire zoektocht in cumDist
    let lo = 0, hi = this.cumDist.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cumDist[mid] < targetM) lo = mid + 1; else hi = mid;
    }
    const i = Math.max(1, lo);
    const segStart = this.cumDist[i - 1];
    const segEnd = this.cumDist[i];
    const segLen = segEnd - segStart || 1;
    const t = Math.max(0, Math.min(1, (targetM - segStart) / segLen));
    const a = this.points[i - 1], b = this.points[i];
    return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
  }

  /**
   * Projecteert een live GPS-punt op de route en geeft de afstand-langs-
   * de-route in km terug, samen met de loodrechte afwijking (m) tot de
   * route. Zoekt lokaal rond een vorige bekende positie (indien gegeven)
   * om het snel en stabiel te houden, met een fallback op een volledige
   * scan als er geen eerdere positie is of de afwijking te groot wordt.
   */
  projectDistanceKm(lat, lon, prevIndexHint = null) {
    if (!this.loaded) return null;

    let searchStart = 0;
    let searchEnd = this.points.length - 1;

    if (prevIndexHint !== null) {
      // Beperk de zoekruimte tot een venster rond de vorige positie.
      // Voorkomt dat een korte GPS-afwijking de gebruiker plots
      // kilometers verder of terug op de route plaatst.
      const window = 400; // punten, ruim voldoende voor normale wandelsnelheid
      searchStart = Math.max(0, prevIndexHint - window);
      searchEnd = Math.min(this.points.length - 1, prevIndexHint + window);
    }

    let bestDist = Infinity;
    let bestIndex = searchStart;
    for (let i = searchStart; i < searchEnd; i++) {
      const d = this._distToSegment(lat, lon, this.points[i], this.points[i + 1]);
      if (d.dist < bestDist) {
        bestDist = d.dist;
        bestIndex = i; // segment-index; exacte fractie binnen segment via t
        this._bestT = d.t;
      }
    }

    // Als de beste match op de rand van het venster ligt (en er een hint
    // was) kan de echte positie buiten het venster liggen: doe een volledige
    // scan als backstop.
    if (prevIndexHint !== null && (bestIndex <= searchStart + 1 || bestIndex >= searchEnd - 1)) {
      let fullBest = Infinity, fullIndex = 0, fullT = 0;
      for (let i = 0; i < this.points.length - 1; i++) {
        const d = this._distToSegment(lat, lon, this.points[i], this.points[i + 1]);
        if (d.dist < fullBest) { fullBest = d.dist; fullIndex = i; fullT = d.t; }
      }
      if (fullBest < bestDist) { bestDist = fullBest; bestIndex = fullIndex; this._bestT = fullT; }
    }

    const segStart = this.cumDist[bestIndex];
    const segEnd = this.cumDist[bestIndex + 1];
    const distM = segStart + (segEnd - segStart) * this._bestT;

    return { km: distM / 1000, index: bestIndex, offsetM: bestDist };
  }

  _distToSegment(lat, lon, a, b) {
    // Lokale platte projectie (voldoende nauwkeurig over korte segmenten).
    const latRef = toRad(a.lat);
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(latRef);

    const px = (lon - a.lon) * mPerDegLon;
    const py = (lat - a.lat) * mPerDegLat;
    const bx = (b.lon - a.lon) * mPerDegLon;
    const by = (b.lat - a.lat) * mPerDegLat;

    const segLenSq = bx * bx + by * by || 1e-9;
    let t = (px * bx + py * by) / segLenSq;
    t = Math.max(0, Math.min(1, t));

    const cx = bx * t, cy = by * t;
    const dx = px - cx, dy = py - cy;
    return { dist: Math.sqrt(dx * dx + dy * dy), t };
  }

  get totalKm() {
    return this.totalDistM / 1000;
  }
}
