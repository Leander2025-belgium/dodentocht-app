"use strict";

const STORAGE_KEY = "doto2026_state_v2";
const IDB_NAME = "doto2026";
const IDB_STORE = "files";
const TOTAL_KM = 100;
const DEADLINE_HOURS = 24;

const route = new Route();
let mapView = null;
let watchId = null;
let wakeLockSentinel = null;
let saveTimer = null;
let pendingBackwardFixes = 0;
let pendingForwardJump = null;
let currentStatusLevel = "green";

const MIN_ACCEPT_ACCURACY_M = 80;
const BACKWARD_TOLERANCE_M = 30;
const FORWARD_JUMP_LIMIT_M = 450;
const OFF_ROUTE_WARN_M = 70;

function defaultState() {
  return {
    startTime: null,
    distanceKm: 0,
    maxDistanceKm: 0,
    lastFixTime: null,
    lastRawPosition: null,
    gpsIndexHint: null,

    paused: false,
    pauseStart: null,
    totalPauseMs: 0,

    speedSamples: [],
    checkpointLog: {},

    settings: {
      powerSaving: false,
      remindersEnabled: false,
      notificationsEnabled: false,
      wakeLock: false
    },

    reminders: {
      lastDrinkAtMinute: 0,
      lastEatAtMinute: 0,
      lastFootCheckKm: 0
    },

    alertsFired: {},
    checklistHistory: []
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();

    const parsed = JSON.parse(raw);
    const merged = {
      ...defaultState(),
      ...parsed,
      settings: { ...defaultState().settings, ...(parsed.settings || {}) },
      reminders: { ...defaultState().reminders, ...(parsed.reminders || {}) }
    };

    return merged;
  } catch {
    return defaultState();
  }
}

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("Opslaan mislukt", err);
    }
  }, 100);
}

function nowIso() {
  return new Date().toISOString();
}

function fmtClock(date) {
  return date.toLocaleTimeString("nl-BE", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function checkpointDateForClock(clock, referenceDate = new Date()) {
  if (!clock) return null;
  const [h, m] = clock.split(":").map(Number);
  const d = new Date(referenceDate);
  d.setHours(h, m, 0, 0);
  if (h < 21) d.setDate(d.getDate() + 1);
  return d;
}

function formatTimeUntil(date) {
  if (!date) return null;
  const diff = date.getTime() - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (diff >= 0) return h > 0 ? `${h}u ${String(m).padStart(2,"0")}m tot sluiting` : `${m} min tot sluiting`;
  return h > 0 ? `${h}u ${String(m).padStart(2,"0")}m gesloten` : `${m} min gesloten`;
}

function checkpointDisplayName(cp) {
  return cp?.location ? `${cp.name} · ${cp.location}` : (cp?.name || "—");
}

function fmtHM(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

function walkingElapsedMs() {
  if (!state.startTime) return 0;

  let total = Date.now() - new Date(state.startTime).getTime();
  let pause = state.totalPauseMs;

  if (state.paused && state.pauseStart) {
    pause += Date.now() - new Date(state.pauseStart).getTime();
  }

  return Math.max(0, total - pause);
}

function totalElapsedMs() {
  if (!state.startTime) return 0;
  return Math.max(0, Date.now() - new Date(state.startTime).getTime());
}

function scheduleHoursForKm(km) {
  const earlySpeed = PACE_PLAN?.early?.targetKmh || 4.6;
  if (km <= 50) return km / earlySpeed;

  const first50 = 50 / earlySpeed;
  const secondHalfSpeed = 50 / Math.max(1, DEADLINE_HOURS - first50);
  return first50 + (km - 50) / secondHalfSpeed;
}

/* IndexedDB */

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);

    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* Route */

async function initRoute() {
  try {
    const cached = await idbGet("route_gpx_text");
    if (cached) {
      route.loadFromGpxText(cached);
      setGpxStatus(`Route geladen uit lokale opslag · ${route.totalKm.toFixed(1)} km`, "ok");
      afterRouteLoaded();
      return;
    }
  } catch {}

  try {
    const res = await fetch("route.gpx", { cache: "force-cache" });

    if (res.ok) {
      const text = await res.text();
      route.loadFromGpxText(text);

      try { await idbSet("route_gpx_text", text); } catch {}

      setGpxStatus(`route.gpx geladen · ${route.totalKm.toFixed(1)} km`, "ok");
      afterRouteLoaded();
      return;
    }
  } catch {}

  setGpxStatus("Geen route.gpx gevonden. Kies hieronder handmatig een GPX-bestand.", "err");
}

async function handleGpxFile(file) {
  try {
    const text = await file.text();
    route.loadFromGpxText(text);
    await idbSet("route_gpx_text", text);
    setGpxStatus(`GPX geladen · ${route.totalKm.toFixed(1)} km`, "ok");
    afterRouteLoaded();
    showToast("Route succesvol geladen.");
  } catch (err) {
    console.warn(err);
    setGpxStatus("Dit bestand kon niet als GPX-route worden gelezen.", "err");
  }
}

function setGpxStatus(text, type = "") {
  const el = document.getElementById("gpxStatus");
  if (!el) return;

  el.textContent = text;
  el.className = `inline-status ${type}`.trim();
}

function afterRouteLoaded() {
  if (mapView) {
    mapView.renderRoute();
    mapView.setReached(new Set(Object.keys(state.checkpointLog).map(Number)));
    mapView.updateProgress(state.distanceKm, null);
  }

  renderCheckpointList();
  renderDashboard();
}

/* Navigation */

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.toggle("active", screen.id === `screen-${name}`);
  });

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.screen === name);
  });

  if (name === "checkpoints") renderCheckpointList();
  if (name === "more") populateCorrectionForm();

  if (name === "map" && mapView) {
    requestAnimationFrame(() => {
      mapView.invalidateSize();
      if (mapView.followMode && mapView.userLatLon) {
        mapView.setFollowMode(true);
      }
    });
  }
}

/* GPS */

function startGps() {
  if (!("geolocation" in navigator)) {
    showToast("GPS wordt niet ondersteund op dit toestel.");
    return;
  }

  stopGps();

  const options = state.settings.powerSaving
    ? {
        enableHighAccuracy: false,
        maximumAge: 12000,
        timeout: 20000
      }
    : {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000
      };

  watchId = navigator.geolocation.watchPosition(
    onGpsFix,
    onGpsError,
    options
  );

  setGpsStatus("gps-active");
}

function stopGps() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function recalibrateGps() {
  state.gpsIndexHint = null;
  pendingBackwardFixes = 0;
  pendingForwardJump = null;
  startGps();
  showToast("GPS wordt herkalibreerd…");
}

function onGpsFix(pos) {
  const { latitude, longitude, accuracy } = pos.coords;

  state.lastRawPosition = {
    lat: latitude,
    lon: longitude,
    accuracy: accuracy || null,
    t: Date.now()
  };

  if (!route.loaded) {
    if (mapView) mapView.setUserPosition(latitude, longitude, accuracy || 15, null);
    return;
  }

  if (accuracy && accuracy > MIN_ACCEPT_ACCURACY_M) {
    setGpsStatus("gps-weak");
    return;
  }

  const projection = route.projectDistanceKm(
    latitude,
    longitude,
    state.gpsIndexHint
  );

  if (!projection) return;

  const previousM = state.distanceKm * 1000;
  const candidateM = projection.km * 1000;
  const deltaM = candidateM - previousM;

  let accept = false;

  if (deltaM >= -BACKWARD_TOLERANCE_M && deltaM <= FORWARD_JUMP_LIMIT_M) {
    accept = true;
    pendingBackwardFixes = 0;
    pendingForwardJump = null;
  } else if (deltaM < -BACKWARD_TOLERANCE_M) {
    pendingBackwardFixes += 1;
    if (pendingBackwardFixes >= 3) {
      accept = true;
      pendingBackwardFixes = 0;
    }
  } else if (deltaM > FORWARD_JUMP_LIMIT_M) {
    if (
      pendingForwardJump &&
      Math.abs(pendingForwardJump.km - projection.km) < 0.08
    ) {
      accept = true;
      pendingForwardJump = null;
    } else {
      pendingForwardJump = {
        km: projection.km,
        t: Date.now()
      };
    }
  }

  if (accept) {
    applyConfirmedProjection(projection);
  }

  if (mapView) {
    mapView.setUserPosition(
      latitude,
      longitude,
      accuracy || 15,
      projection
    );
  }

  trackSpeedSample(state.distanceKm);
  setGpsStatus("gps-active");
}

function applyConfirmedProjection(projection) {
  const candidate = Math.max(0, Math.min(TOTAL_KM, projection.km));

  state.distanceKm = candidate;
  state.maxDistanceKm = Math.max(state.maxDistanceKm, candidate);
  state.gpsIndexHint = projection.index;
  state.lastFixTime = nowIso();

  saveState();
}

function onGpsError(err) {
  console.warn("GPS fout", err);
  setGpsStatus("gps-lost");
}

function setGpsStatus(mode) {
  const label = document.getElementById("statusLabel");
  const dot = document.getElementById("statusDot");

  if (mode === "gps-active") label.textContent = "GPS actief";
  else if (mode === "gps-weak") label.textContent = "GPS onnauwkeurig";
  else if (mode === "gps-lost") label.textContent = "Geen GPS-signaal";
  else label.textContent = "Klaar om te starten";

  dot.className = `status-dot ${currentStatusLevel}`;
}

function trackSpeedSample(km) {
  const t = Date.now();

  state.speedSamples.push({ t, km });

  const cutoff = t - 3 * 60 * 1000;
  state.speedSamples = state.speedSamples.filter(sample => sample.t >= cutoff);
}

function currentSpeedKmh() {
  const samples = state.speedSamples;

  if (samples.length < 2) return null;

  const first = samples[0];
  const last = samples[samples.length - 1];

  const hours = (last.t - first.t) / 3600000;
  if (hours <= 0) return null;

  const kmh = (last.km - first.km) / hours;
  if (kmh < 0 || kmh > 10) return null;

  return kmh;
}

/* Start & pause */

function startTocht() {
  if (state.startTime) return;

  state.startTime = nowIso();
  saveState();

  startGps();
  renderDashboard();
  showToast("Tocht gestart. Rustig beginnen.");
}

function startPause() {
  if (state.paused || !state.startTime) return;

  state.paused = true;
  state.pauseStart = nowIso();
  saveState();

  renderDashboard();
}

function endPause() {
  if (!state.paused || !state.pauseStart) return;

  state.totalPauseMs += Date.now() - new Date(state.pauseStart).getTime();
  state.paused = false;
  state.pauseStart = null;

  saveState();
  renderDashboard();
}

/* Checkpoints */

function getNextCheckpoint() {
  return CHECKPOINTS.find(cp => cp.km > state.distanceKm + 0.02) || null;
}

function getCurrentCheckpointIndex() {
  let idx = 0;

  for (let i = 0; i < CHECKPOINTS.length; i++) {
    if (CHECKPOINTS[i].km <= state.distanceKm + 0.02) idx = i;
  }

  return idx;
}

function checkCheckpointArrivals() {
  CHECKPOINTS.forEach(cp => {
    if (cp.km === 0) return;

    if (!state.checkpointLog[cp.id] && state.distanceKm >= cp.km - 0.05) {
      state.checkpointLog[cp.id] = {
        arrival: nowIso(),
        pauseStartedAt: null,
        pauseMs: 0,
        departed: null
      };

      saveState();
      showToast(`Controlepost bereikt: ${cp.name}`);

      if (navigator.vibrate) navigator.vibrate([70, 50, 70]);

      renderCheckpointList();
      mapView?.setReached(new Set(Object.keys(state.checkpointLog).map(Number)));
    }
  });
}

function cpPauseStart(cpId) {
  const log = state.checkpointLog[cpId];
  if (!log || log.pauseStartedAt) return;

  log.pauseStartedAt = nowIso();
  saveState();
  renderCheckpointList();
}

function cpPauseEnd(cpId) {
  const log = state.checkpointLog[cpId];
  if (!log?.pauseStartedAt) return;

  log.pauseMs += Date.now() - new Date(log.pauseStartedAt).getTime();
  log.pauseStartedAt = null;
  log.departed = nowIso();

  saveState();
  renderCheckpointList();
}

/* Alerts */

function checkDistanceAlerts() {
  if (!state.settings.remindersEnabled) return;

  DISTANCE_ALERTS.forEach(alert => {
    const key = String(alert.km);

    if (!state.alertsFired[key] && state.distanceKm >= alert.km) {
      state.alertsFired[key] = true;
      saveState();
      notify(alert.message);
    }
  });
}

function checkPeriodicReminders() {
  if (!state.settings.remindersEnabled || !state.startTime || state.paused) return;

  const walkMin = walkingElapsedMs() / 60000;

  if (walkMin - state.reminders.lastDrinkAtMinute >= 30) {
    state.reminders.lastDrinkAtMinute = walkMin;
    notify("Drinkmoment: neem enkele slokken.");
  }

  if (walkMin - state.reminders.lastEatAtMinute >= 65) {
    state.reminders.lastEatAtMinute = walkMin;
    notify("Eetmoment: neem iets kleins.");
  }

  if (state.distanceKm - state.reminders.lastFootCheckKm >= 15) {
    state.reminders.lastFootCheckKm = state.distanceKm;
    notify("Voetcheck: controleer hotspots en sokken.");
  }

  saveState();
}

function notify(message) {
  showToast(message);

  if (
    state.settings.notificationsEnabled &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    try {
      new Notification("Dodentocht", {
        body: message,
        icon: "icon-192.png"
      });
    } catch {}
  }

  if (navigator.vibrate) navigator.vibrate(50);
}

function showToast(message) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;

  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;

  stack.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 3900);
}

/* Status */

function computeStatus() {
  const walkMs = walkingElapsedMs();
  const elapsedH = walkMs / 3600000;
  const remainingKm = Math.max(0, TOTAL_KM - state.distanceKm);

  if (!state.startTime) {
    return {
      level: "green",
      title: "Klaar voor de start",
      text: "Start rustig en laat het tempo vanzelf komen.",
      marginMin: null,
      etaDate: null
    };
  }

  if (state.distanceKm < 1 || elapsedH < 0.25) {
    return {
      level: "green",
      title: "Rustig op gang",
      text: "Nog niets forceren.",
      marginMin: null,
      etaDate: null
    };
  }

  const overallSpeed = state.distanceKm / Math.max(.01, elapsedH);
  const etaHours = remainingKm / Math.max(.3, overallSpeed);
  const etaDate = new Date(Date.now() + etaHours * 3600000);
  const deadline = new Date(
    new Date(state.startTime).getTime() + DEADLINE_HOURS * 3600000
  );

  const marginMin = (deadline.getTime() - etaDate.getTime()) / 60000;

  if (marginMin > 90) {
    return {
      level: "green",
      title: "Comfortabel op schema",
      text: "Houd dit ritme vast zonder te versnellen.",
      marginMin,
      etaDate
    };
  }

  if (marginMin > 0) {
    return {
      level: "orange",
      title: "Marge wordt kleiner",
      text: "Beperk lange pauzes en blijf rustig bewegen.",
      marginMin,
      etaDate
    };
  }

  return {
    level: "red",
    title: "Weinig tijdsmarge",
    text: "Focus op de volgende post en vermijd extra stilstand.",
    marginMin,
    etaDate
  };
}

/* Render */

function renderDashboard() {
  const distance = Math.max(0, Math.min(TOTAL_KM, state.distanceKm));

  document.body.classList.toggle("deep-zone", distance >= 75 && distance < 95);
  document.body.classList.toggle("finish-zone", distance >= 95);
  const remaining = Math.max(0, TOTAL_KM - distance);
  const progress = Math.min(100, distance);

  document.getElementById("distanceValue").textContent = distance.toFixed(1);
  document.getElementById("remainingLabel").textContent = `${remaining.toFixed(1)} km resterend`;
  document.getElementById("progressPercent").textContent = `${progress.toFixed(0)}%`;
  document.getElementById("progressFill").style.width = `${progress}%`;
  document.getElementById("elapsedCompact").textContent = `${fmtHM(walkingElapsedMs())} onderweg`;

  const elapsedH = walkingElapsedMs() / 3600000;
  const avgSpeed = elapsedH > 0.03 ? distance / elapsedH : null;
  const liveSpeed = currentSpeedKmh();

  document.getElementById("paceValue").textContent =
    avgSpeed ? avgSpeed.toFixed(1) : "—";

  document.getElementById("speedValue").textContent =
    liveSpeed !== null ? liveSpeed.toFixed(1) : "—";

  const status = computeStatus();
  currentStatusLevel = status.level;

  const statusBanner = document.getElementById("statusBanner");
  statusBanner.className = `status-card glass ${status.level}`;

  document.getElementById("statusBannerIcon").textContent =
    status.level === "green" ? "✓" : status.level === "orange" ? "!" : "×";

  document.getElementById("statusBannerTitle").textContent = status.title;
  document.getElementById("statusBannerText").textContent = status.text;

  document.getElementById("heroStatusText").textContent =
    state.paused ? "Pauze actief" : status.title;

  if (status.etaDate) {
    document.getElementById("etaValue").textContent = fmtClock(status.etaDate);

    const marginText =
      status.marginMin >= 0
        ? `${Math.round(status.marginMin)} min marge`
        : `${Math.round(Math.abs(status.marginMin))} min boven 24u`;

    document.getElementById("marginValue").textContent = marginText;
  } else {
    document.getElementById("etaValue").textContent = "—:—";
    document.getElementById("marginValue").textContent = "Nog geen betrouwbare ETA";
  }

  const next = getNextCheckpoint();

  if (next) {
    const toGo = Math.max(0, next.km - distance);
    const prevIndex = Math.max(0, CHECKPOINTS.indexOf(next) - 1);
    const prevKm = CHECKPOINTS[prevIndex]?.km || 0;
    const legLength = Math.max(.01, next.km - prevKm);
    const legDone = Math.max(0, distance - prevKm);
    const legProgress = Math.min(100, legDone / legLength * 100);

    document.getElementById("nextCpName").textContent = checkpointDisplayName(next);
    document.getElementById("nextCpDist").textContent = `${toGo.toFixed(1)} km`;
    document.getElementById("nextCpProgress").style.width = `${legProgress}%`;

    let nextEtaText = `km ${next.km.toFixed(1)} · open ${next.opens} · sluit ${next.closes}`;

    if (avgSpeed && avgSpeed > .5) {
      const nextEta = new Date(Date.now() + toGo / avgSpeed * 3600000);
      nextEtaText += ` · aankomst ± ${fmtClock(nextEta)}`;
    }

    const closeDate = state.startTime ? checkpointDateForClock(next.closes, new Date(state.startTime)) : null;
    const untilClose = closeDate ? formatTimeUntil(closeDate) : null;
    if (untilClose) nextEtaText += ` · ${untilClose}`;

    document.getElementById("nextCpMeta").textContent = nextEtaText;

    document.getElementById("mapNextName").textContent = checkpointDisplayName(next);
    document.getElementById("mapNextDistance").textContent = `${toGo.toFixed(1)} km`;

    const walkMinutes = avgSpeed && avgSpeed > .5
      ? Math.round(toGo / avgSpeed * 60)
      : null;

    const closeDateMap = state.startTime ? checkpointDateForClock(next.closes, new Date(state.startTime)) : null;
    const untilCloseMap = closeDateMap ? formatTimeUntil(closeDateMap) : null;

    document.getElementById("mapNextMeta").textContent =
      walkMinutes
        ? `± ${walkMinutes} min · sluit ${next.closes}${untilCloseMap ? ` · ${untilCloseMap}` : ""}`
        : `sluit ${next.closes}${untilCloseMap ? ` · ${untilCloseMap}` : ""}`;
  } else {
    document.getElementById("nextCpName").textContent = "Finish";
    document.getElementById("nextCpDist").textContent = "🏁";
    document.getElementById("nextCpMeta").textContent = "Bornem · 100 km";
    document.getElementById("nextCpProgress").style.width = "100%";

    document.getElementById("mapNextName").textContent = "Finish";
    document.getElementById("mapNextDistance").textContent = "0.0 km";
    document.getElementById("mapNextMeta").textContent = "Bornem";
  }

  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseToggleBtn");

  startBtn.hidden = !!state.startTime;
  pauseBtn.hidden = !state.startTime;
  pauseBtn.textContent = state.paused ? "Pauze beëindigen" : "Pauze starten";

  setGpsStatus(
    !state.startTime ? "idle" : watchId !== null ? "gps-active" : "gps-lost"
  );

  mapView?.updateProgress(distance, null);
}

function renderCheckpointList() {
  const list = document.getElementById("checkpointList");
  if (!list) return;

  list.innerHTML = "";

  const currentIndex = getCurrentCheckpointIndex();
  const reachedCount = Object.keys(state.checkpointLog).length;

  document.getElementById("checkpointHeaderValue").textContent =
    `${Math.min(reachedCount, 13)} / 13`;

  CHECKPOINTS.forEach((cp, i) => {
    const log = state.checkpointLog[cp.id];
    const reached = !!log || (cp.km === 0 && !!state.startTime);
    const current = i === currentIndex + 1 || (i === currentIndex && !reached);

    const card = document.createElement("div");
    card.className =
      `cp-item${reached ? " reached" : ""}${current ? " current" : ""}`;

    const toGo = Math.max(0, cp.km - state.distanceKm);

    let arrival = "Nog niet bereikt";

    if (cp.km === 0 && state.startTime) {
      arrival = `Gestart ${fmtClock(new Date(state.startTime))}`;
    } else if (log?.arrival) {
      arrival = `Aangekomen ${fmtClock(new Date(log.arrival))}`;
    } else if (state.startTime) {
      const scheduleDate = new Date(
        new Date(state.startTime).getTime() +
        scheduleHoursForKm(cp.km) * 3600000
      );
      arrival = `Richttijd ${fmtClock(scheduleDate)}`;
    }

    card.innerHTML = `
      <div class="cp-top">
        <div class="cp-name">${escapeHtml(checkpointDisplayName(cp))}</div>
        <div class="cp-km">${cp.km.toFixed(1)} km</div>
      </div>

      <div class="cp-row">
        <span>${arrival}</span>
        <span>${cp.km > state.distanceKm ? `${toGo.toFixed(1)} km` : "✓"}</span>
      </div>

      <div class="cp-row cp-hours">
        <span>Open ${cp.opens}</span>
        <span>Sluit ${cp.closes}</span>
      </div>

      ${cp.supplies.length
        ? `<div class="cp-supplies">${cp.supplies.map(escapeHtml).join(" · ")}</div>`
        : ""}

      ${cp.rest
        ? `<div class="cp-row"><span>Geplande pauze</span><span>${cp.rest} min</span></div>`
        : ""}
    `;

    if (cp.km > 0 && cp.km < 100) {
      const row = document.createElement("div");
      row.className = "cp-pause-row";

      const start = document.createElement("button");
      start.className = "small-button";
      start.textContent = "Pauze start";
      start.disabled = !log || !!log.pauseStartedAt;
      start.addEventListener("click", () => cpPauseStart(cp.id));

      const end = document.createElement("button");
      end.className = "small-button";
      end.textContent = "Pauze einde";
      end.disabled = !log || !log.pauseStartedAt;
      end.addEventListener("click", () => cpPauseEnd(cp.id));

      row.append(start, end);
      card.appendChild(row);

      if (log && (log.pauseStartedAt || log.pauseMs > 0)) {
        const liveMs = log.pauseStartedAt
          ? Date.now() - new Date(log.pauseStartedAt).getTime()
          : 0;

        const timer = document.createElement("div");
        timer.className = "cp-pause-timer";
        timer.textContent = `${fmtHM(log.pauseMs + liveMs)} pauze`;

        card.appendChild(timer);
      }
    }

    list.appendChild(card);
  });
}

/* Correction */

function populateCorrectionForm() {
  const cpSelect = document.getElementById("corrCp");

  cpSelect.innerHTML = CHECKPOINTS
    .map(cp => `<option value="${cp.km}">${escapeHtml(cp.name)} · ${cp.km.toFixed(1)} km</option>`)
    .join("");

  document.getElementById("corrKm").value = state.distanceKm.toFixed(1);
  document.getElementById("corrPause").value = Math.round(state.totalPauseMs / 60000);

  if (state.startTime) {
    const date = new Date(state.startTime);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

    document.getElementById("corrStart").value = local;
  }
}

function applyCorrection() {
  const km = Number(document.getElementById("corrKm").value);
  const start = document.getElementById("corrStart").value;
  const pauseMin = Number(document.getElementById("corrPause").value);

  if (Number.isFinite(km)) {
    state.distanceKm = Math.max(0, Math.min(TOTAL_KM, km));
    state.maxDistanceKm = state.distanceKm;

    if (route.loaded) {
      const pt = route.pointAtDistance(state.distanceKm);
      state.gpsIndexHint = pt?.index ?? null;
    }
  }

  if (start) {
    state.startTime = new Date(start).toISOString();
  }

  if (Number.isFinite(pauseMin)) {
    state.totalPauseMs = Math.max(0, pauseMin) * 60000;
  }

  saveState();
  renderDashboard();
  renderCheckpointList();

  showToast("Correctie toegepast.");
}

/* Checklist */

const CHECKLIST_QUESTIONS = [
  { id: "blaar", label: "Blaar of hotspot", severe: false },
  { id: "nat", label: "Natte sokken", severe: false },
  { id: "pijn", label: "Ongewone of toenemende pijn", severe: true },
  { id: "misselijk", label: "Misselijkheid", severe: true },
  { id: "duizelig", label: "Duizeligheid", severe: true },
  { id: "gedronken", label: "Genoeg gedronken", severe: false },
  { id: "gegeten", label: "Genoeg gegeten", severe: false }
];

function renderChecklist() {
  const wrap = document.getElementById("checklistItems");

  wrap.innerHTML = CHECKLIST_QUESTIONS.map(q => `
    <label class="checklist-row">
      <span>${escapeHtml(q.label)}</span>
      <input type="checkbox" data-id="${q.id}" />
    </label>
  `).join("");

  document.getElementById("checklistWarning").hidden = true;
}

function openChecklist() {
  renderChecklist();
  document.getElementById("checklistModal").classList.add("open");
}

function closeChecklist() {
  document.getElementById("checklistModal").classList.remove("open");
}

function saveChecklist() {
  const answers = {};
  let severe = false;

  document.querySelectorAll("#checklistItems input[type=checkbox]").forEach(cb => {
    answers[cb.dataset.id] = cb.checked;

    const question = CHECKLIST_QUESTIONS.find(q => q.id === cb.dataset.id);
    if (question?.severe && cb.checked) severe = true;
  });

  state.checklistHistory.push({
    t: nowIso(),
    km: state.distanceKm,
    answers,
    severe
  });

  saveState();

  if (severe) {
    document.getElementById("checklistWarning").hidden = false;
    return;
  }

  closeChecklist();
  showToast("Check opgeslagen.");
}

/* Settings */

function applySettingsToUI() {
  document.getElementById("powerSavingToggle").checked = state.settings.powerSaving;
  document.getElementById("remindersToggle").checked = state.settings.remindersEnabled;
  document.getElementById("wakeLockToggle").checked = state.settings.wakeLock;
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;

  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
  } catch {}
}

function releaseWakeLock() {
  if (!wakeLockSentinel) return;

  wakeLockSentinel.release().catch(() => {});
  wakeLockSentinel = null;
}

function exportData() {
  const payload = {
    exportedAt: nowIso(),
    state,
    routeLoaded: route.loaded,
    routeKm: route.totalKm,
    checkpoints: CHECKPOINTS
  };

  const blob = new Blob(
    [JSON.stringify(payload, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `dodentocht-2026-${new Date().toISOString().slice(0,10)}.json`;

  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function resetTocht() {
  if (!confirm("Alle voortgang van deze tocht wissen?")) return;

  const settings = { ...state.settings };
  state = defaultState();
  state.settings = settings;

  saveState();
  stopGps();

  renderDashboard();
  renderCheckpointList();

  if (route.loaded) {
    mapView?.updateProgress(0, null);
  }

  showToast("Tocht gereset.");
}

/* Events */

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

document.getElementById("fullscreenBtn").addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

document.getElementById("startBtn").addEventListener("click", startTocht);

document.getElementById("pauseToggleBtn").addEventListener("click", () => {
  state.paused ? endPause() : startPause();
});

document.getElementById("checklistBtn").addEventListener("click", openChecklist);
document.getElementById("recalibrateBtn").addEventListener("click", recalibrateGps);

document.getElementById("checklistCancelBtn").addEventListener("click", closeChecklist);
document.getElementById("checklistSaveBtn").addEventListener("click", saveChecklist);

document.getElementById("applyCorrectionBtn").addEventListener("click", applyCorrection);

document.getElementById("corrCp").addEventListener("change", e => {
  document.getElementById("corrKm").value = Number(e.target.value).toFixed(1);
});

document.getElementById("gpxFileInput").addEventListener("change", e => {
  const file = e.target.files?.[0];
  if (file) handleGpxFile(file);
});

document.getElementById("powerSavingToggle").addEventListener("change", e => {
  state.settings.powerSaving = e.target.checked;
  saveState();

  if (watchId !== null) startGps();
});

document.getElementById("remindersToggle").addEventListener("change", e => {
  state.settings.remindersEnabled = e.target.checked;
  saveState();
});

document.getElementById("wakeLockToggle").addEventListener("change", e => {
  state.settings.wakeLock = e.target.checked;
  saveState();

  if (e.target.checked) requestWakeLock();
  else releaseWakeLock();
});

document.getElementById("notifPermBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showToast("Browsermeldingen worden niet ondersteund.");
    return;
  }

  const permission = await Notification.requestPermission();
  state.settings.notificationsEnabled = permission === "granted";

  saveState();

  showToast(
    permission === "granted"
      ? "Meldingen toegestaan."
      : "Meldingen niet toegestaan."
  );
});

document.getElementById("exportBtn").addEventListener("click", exportData);
document.getElementById("resetBtn").addEventListener("click", resetTocht);

document.getElementById("mapResetBtn").addEventListener("click", () => {
  mapView?.fitFullRoute();
});

document.getElementById("mapFollowBtn").addEventListener("click", () => {
  if (!mapView) return;

  mapView.setFollowMode(!mapView.followMode);

  if (mapView.followMode && !mapView.userLatLon) {
    showToast("Nog geen GPS-positie ontvangen.");
  }
});

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    state.settings.wakeLock
  ) {
    requestWakeLock();
  }
});

/* Loop + boot */

function tick() {
  checkCheckpointArrivals();
  checkDistanceAlerts();
  checkPeriodicReminders();

  renderDashboard();

  if (document.getElementById("screen-checkpoints").classList.contains("active")) {
    renderCheckpointList();
  }
}

setInterval(tick, 1000);

async function boot() {
  applySettingsToUI();
  populateCorrectionForm();

  mapView = new MapView("leafletMap", route, CHECKPOINTS);

  await initRoute();

  mapView.setReached(
    new Set(Object.keys(state.checkpointLog).map(Number))
  );

  if (state.startTime) {
    startGps();

    if (state.settings.wakeLock) {
      requestWakeLock();
    }
  } else {
    setGpsStatus("idle");
  }

  renderDashboard();
  renderCheckpointList();

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch (err) {
      console.warn("Service worker registratie mislukt", err);
    }
  }
}

boot();
