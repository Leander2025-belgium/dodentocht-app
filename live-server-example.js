/**
 * Dodentocht live tracking voorbeeld voor Express.
 * Voeg dit toe aan je bestaande Node/Express-server.
 *
 * In productie: zet rate limiting, HTTPS, auth/secret management en persistence aan.
 */

const liveSessions = new Map();
const LIVE_CODE_PATTERN = /^[A-Z2-9]{8}$/;

app.param("code", (req, res, next, code) => {
  if (!LIVE_CODE_PATTERN.test(String(code).toUpperCase())) {
    return res.status(400).json({ error: "Ongeldige livecode" });
  }
  req.params.code = String(code).toUpperCase();
  next();
});

function getSession(code) {
  if (!liveSessions.has(code)) {
    liveSessions.set(code, {
      active: false,
      snapshot: null,
      lastViewerHeartbeat: 0
    });
  }
  return liveSessions.get(code);
}

app.post("/api/dodentocht/live/:code/start", (req, res) => {
  const s = getSession(req.params.code);
  s.active = true;
  res.json({ ok: true });
});

app.post("/api/dodentocht/live/:code/stop", (req, res) => {
  liveSessions.delete(req.params.code);
  res.json({ ok: true });
});

app.post("/api/dodentocht/live/:code/update", (req, res) => {
  const s = getSession(req.params.code);
  if (!s.active) return res.status(409).json({ error: "Live delen staat uit" });

  const body = req.body || {};
  const position = body.position &&
    Number.isFinite(body.position.lat) &&
    Number.isFinite(body.position.lon)
      ? {
          lat: body.position.lat,
          lon: body.position.lon,
          accuracy: Number.isFinite(body.position.accuracy) ? body.position.accuracy : null,
          timestamp: Number.isFinite(body.position.timestamp) ? body.position.timestamp : null
        }
      : null;

  s.snapshot = {
    timestamp: Number.isFinite(body.timestamp) ? body.timestamp : Date.now(),
    distanceKm: Number.isFinite(body.distanceKm) ? Math.max(0, Math.min(100, body.distanceKm)) : null,
    speedKmh: Number.isFinite(body.speedKmh) ? Math.max(0, Math.min(50, body.speedKmh)) : null,
    elapsedMs: Number.isFinite(body.elapsedMs) ? Math.max(0, body.elapsedMs) : null,
    nextCheckpoint: body.nextCheckpoint || null,
    battery: Number.isFinite(body.battery) ? Math.max(0, Math.min(100, body.battery)) : null,
    position,
    receivedAt: Date.now()
  };

  res.json({ ok: true });
});

app.get("/api/dodentocht/live/:code", (req, res) => {
  res.set("Cache-Control", "no-store");
  const s = getSession(req.params.code);
  if (!s.active || !s.snapshot) {
    return res.status(404).json({ error: "Geen actieve live sessie" });
  }

  res.json({
    active: true,
    snapshot: s.snapshot
  });
});

app.post("/api/dodentocht/live/:code/viewer-heartbeat", (req, res) => {
  const s = getSession(req.params.code);
  s.lastViewerHeartbeat = Date.now();
  res.json({ ok: true });
});

app.get("/api/dodentocht/live/:code/presence", (req, res) => {
  res.set("Cache-Control", "no-store");
  const s = getSession(req.params.code);
  res.json({
    viewerActive: Date.now() - s.lastViewerHeartbeat < 20000
  });
});
