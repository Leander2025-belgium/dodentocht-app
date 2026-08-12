const LIVE_API_BASE = "https://YOUR-SERVER.example.com";

const params = new URLSearchParams(location.search);
const code = params.get("code") || "";

let map;
let marker;
let ageTimer;
let lastTimestamp = null;

function initMap() {
  map = L.map("viewerMap", { zoomControl: true }).setView([51.09, 4.24], 11);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

function setLiveBadge(ok, text) {
  const el = document.getElementById("liveBadge");
  el.textContent = `● ${text}`;
  el.style.color = ok ? "#bff9d0" : "#ffd0c4";
}

function renderSnapshot(data) {
  if (!data) return;

  lastTimestamp = data.timestamp || Date.now();

  document.getElementById("distanceValue").textContent =
    Number.isFinite(data.distanceKm) ? data.distanceKm.toFixed(1) : "—";

  document.getElementById("speedValue").textContent =
    Number.isFinite(data.speedKmh) ? `${data.speedKmh.toFixed(1)} km/u` : "—";

  const next = data.nextCheckpoint;
  document.getElementById("nextValue").textContent =
    next ? `${next.name}${next.location ? " · " + next.location : ""}` : "—";

  document.getElementById("batteryValue").textContent =
    Number.isFinite(data.battery) ? `${data.battery}%` : "—";

  if (data.position?.lat && data.position?.lon) {
    const latlng = [data.position.lat, data.position.lon];
    if (!marker) {
      marker = L.circleMarker(latlng, {
        radius: 9,
        color: "#fff",
        weight: 3,
        fillColor: "#4da3ff",
        fillOpacity: 1
      }).addTo(map);
      map.setView(latlng, 15);
    } else {
      marker.setLatLng(latlng);
    }
  }

  setLiveBadge(true, "Live");
  updateAge();
}

function updateAge() {
  if (!lastTimestamp) return;
  const sec = Math.max(0, Math.round((Date.now() - lastTimestamp) / 1000));
  document.getElementById("ageValue").textContent = sec < 60 ? `${sec} sec` : `${Math.floor(sec/60)} min`;
  if (sec > 45) setLiveBadge(false, "Verbinding oud");
}

async function heartbeat() {
  if (!code || LIVE_API_BASE.includes("YOUR-SERVER")) return;
  try {
    await fetch(`${LIVE_API_BASE}/api/dodentocht/live/${encodeURIComponent(code)}/viewer-heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: Date.now() })
    });
  } catch {}
}

async function refresh() {
  if (!code) {
    setLiveBadge(false, "Geen kijkcode");
    return;
  }
  if (LIVE_API_BASE.includes("YOUR-SERVER")) {
    setLiveBadge(false, "Server nog niet ingesteld");
    return;
  }

  try {
    const res = await fetch(`${LIVE_API_BASE}/api/dodentocht/live/${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderSnapshot(data.snapshot);
  } catch {
    setLiveBadge(false, "Geen liveverbinding");
  }
}

initMap();
refresh();
heartbeat();
setInterval(refresh, 5000);
setInterval(heartbeat, 8000);
ageTimer = setInterval(updateAge, 1000);
