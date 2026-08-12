/**
 * Dodentocht live tracking voorbeeld voor Express.
 * Voeg dit toe aan je bestaande Node/Express-server.
 *
 * In productie: zet rate limiting, HTTPS, auth/secret management en persistence aan.
 */

const liveSessions = new Map();

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
  const s = getSession(req.params.code);
  s.active = false;
  res.json({ ok: true });
});

app.post("/api/dodentocht/live/:code/update", (req, res) => {
  const s = getSession(req.params.code);
  if (!s.active) return res.status(409).json({ error: "Live delen staat uit" });

  s.snapshot = {
    ...req.body,
    receivedAt: Date.now()
  };

  res.json({ ok: true });
});

app.get("/api/dodentocht/live/:code", (req, res) => {
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
  const s = getSession(req.params.code);
  res.json({
    viewerActive: Date.now() - s.lastViewerHeartbeat < 20000
  });
});
