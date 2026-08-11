/**
 * map.js
 * Tekent de volledige route + controleposten + live positie op een
 * <canvas>, zonder externe kaarttegels. Dit werkt daardoor volledig
 * offline, wat cruciaal is tijdens de tocht zelf.
 *
 * Ondersteunt pinch-to-zoom en slepen om in te zoomen op een stuk route,
 * plus een knop om terug naar het volledige overzicht te gaan.
 */

"use strict";

class MapView {
  constructor(canvas, route, checkpoints) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.route = route;
    this.checkpoints = checkpoints;

    this.dpr = window.devicePixelRatio || 1;
    this.bounds = null;      // {minLat,maxLat,minLon,maxLon}
    this.baseTransform = null; // fit-to-screen transform
    this.scale = 1;          // extra zoomfactor bovenop baseTransform
    this.offsetX = 0;        // extra pan bovenop baseTransform (canvas px)
    this.offsetY = 0;

    this.userLatLon = null;  // {lat, lon}
    this.reachedIds = new Set();
    this.followMode = false;

    this._wireGestures();
    window.addEventListener("resize", () => this.resize());
  }

  /* ---------------- Projectie ---------------- */

  computeBounds() {
    if (!this.route.loaded) return;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    this.route.points.forEach((p) => {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    });
    this.bounds = { minLat, maxLat, minLon, maxLon };
    this.latMid = (minLat + maxLat) / 2;
    this.lonScale = Math.cos((this.latMid * Math.PI) / 180); // corrigeert breedtegraad-vervorming
  }

  /** Zet lat/lon om naar "wereld"-pixels vóór zoom/pan (equirectangulair, breedtegraad-gecorrigeerd). */
  project(lat, lon) {
    const x = (lon - this.bounds.minLon) * this.lonScale;
    const y = this.bounds.maxLat - lat; // y groeit naar beneden op canvas
    return { x, y };
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.cssW = w;
    this.cssH = h;
    this.fitToRoute();
  }

  /** Berekent de basistransform die de volledige route in het canvas past. */
  fitToRoute() {
    if (!this.route.loaded || !this.bounds) return;
    const worldW = (this.bounds.maxLon - this.bounds.minLon) * this.lonScale || 0.0001;
    const worldH = (this.bounds.maxLat - this.bounds.minLat) || 0.0001;
    const padding = 36;
    const availW = this.cssW - padding * 2;
    const availH = this.cssH - padding * 2;
    const scale = Math.min(availW / worldW, availH / worldH);

    const drawnW = worldW * scale;
    const drawnH = worldH * scale;
    const offX = (this.cssW - drawnW) / 2;
    const offY = (this.cssH - drawnH) / 2;

    this.baseTransform = { scale, offX, offY };
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /** Wereld-coördinaat -> uiteindelijke canvas (CSS) pixel, incl. zoom/pan van de gebruiker. */
  toScreen(lat, lon) {
    const p = this.project(lat, lon);
    const bt = this.baseTransform;
    const x = p.x * bt.scale * this.scale + bt.offX * this.scale + this.offsetX;
    const y = p.y * bt.scale * this.scale + bt.offY * this.scale + this.offsetY;
    return { x, y };
  }

  /* ---------------- Tekenen ---------------- */

  draw() {
    const ctx = this.ctx;
    const w = this.cssW, h = this.cssH;
    if (!w || !h) return;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, w, h);

    if (!this.route.loaded || !this.baseTransform) {
      ctx.restore();
      return;
    }

    // Routelijn
    ctx.beginPath();
    this.route.points.forEach((p, i) => {
      const s = this.toScreen(p.lat, p.lon);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.strokeStyle = "rgba(245,246,247,0.55)";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // Afgelegd deel van de route, geaccentueerd
    if (this.userLatLon) {
      ctx.beginPath();
      const proj = this.route.projectDistanceKm(this.userLatLon.lat, this.userLatLon.lon, null);
      const cutIndex = proj ? proj.index : 0;
      for (let i = 0; i <= cutIndex && i < this.route.points.length; i++) {
        const p = this.route.points[i];
        const s = this.toScreen(p.lat, p.lon);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      }
      ctx.strokeStyle = "#4ade9a";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // Start & finish
    this._drawDot(this.route.points[0], "#f5f6f7", 6);
    this._drawDot(this.route.points[this.route.points.length - 1], "#f5f6f7", 6);

    // Controleposten
    this.checkpoints.forEach((cp) => {
      if (cp.km === 0 || cp.km === 100) return;
      const pt = this.route.pointAtDistance(cp.km);
      if (!pt) return;
      const reached = this.reachedIds.has(cp.id);
      this._drawDot(pt, reached ? "#4ade9a" : "#f5b942", reached ? 5 : 6);
    });

    // Live positie
    if (this.userLatLon) {
      const s = this.toScreen(this.userLatLon.lat, this.userLatLon.lon);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(74,222,154,0.22)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#4ade9a";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#06140d";
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawDot(latlonPoint, color, r) {
    const s = this.toScreen(latlonPoint.lat, latlonPoint.lon);
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0a0a0e";
    ctx.stroke();
  }

  /* ---------------- Publieke updates ---------------- */

  setUserPosition(lat, lon) {
    this.userLatLon = { lat, lon };
    if (this.followMode) this.centerOn(lat, lon);
  }

  setReached(idsSet) {
    this.reachedIds = idsSet;
  }

  centerOn(lat, lon) {
    if (!this.baseTransform) return;
    const p = this.project(lat, lon);
    const bt = this.baseTransform;
    const targetX = p.x * bt.scale * this.scale + bt.offX * this.scale;
    const targetY = p.y * bt.scale * this.scale + bt.offY * this.scale;
    this.offsetX = this.cssW / 2 - targetX;
    this.offsetY = this.cssH / 2 - targetY;
  }

  resetView() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.followMode = false;
  }

  /* ---------------- Touch: pan & pinch-zoom ---------------- */

  _wireGestures() {
    const el = this.canvas;
    let mode = null;
    let lastX = 0, lastY = 0;
    let lastDist = 0;

    const dist = (t0, t1) => Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);

    el.addEventListener("touchstart", (e) => {
      this.followMode = false;
      if (e.touches.length === 1) {
        mode = "pan";
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        mode = "pinch";
        lastDist = dist(e.touches[0], e.touches[1]);
      }
    }, { passive: true });

    el.addEventListener("touchmove", (e) => {
      if (mode === "pan" && e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastX;
        const dy = e.touches[0].clientY - lastY;
        this.offsetX += dx;
        this.offsetY += dy;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
        this.draw();
      } else if (mode === "pinch" && e.touches.length === 2) {
        const d = dist(e.touches[0], e.touches[1]);
        const factor = d / (lastDist || d);
        this.scale = Math.max(0.6, Math.min(12, this.scale * factor));
        lastDist = d;
        this.draw();
      }
    }, { passive: true });

    el.addEventListener("touchend", () => { mode = null; }, { passive: true });
  }
}
