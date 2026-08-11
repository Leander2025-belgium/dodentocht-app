/**
 * app.js
 * Kernlogica van de Dodentocht 2026 Companion.
 * Vanilla JS, geen frameworks. Alles werkt offline na de eerste load.
 */

"use strict";

const STORAGE_KEY = "doto2026_state_v1";
const TOTAL_KM = 100;
const DEADLINE_HOURS = 24;

const route = new Route();
let mapView = null;

/* ==========================================================================
   STATE
   ========================================================================== */

function defaultState() {
  return {
    startTime: null,          // ISO string, null = nog niet gestart
    distanceKm: 0,
    maxDistanceKm: 0,         // hoogst bevestigde afstand (voorkomt terugspringen)
    lastFixTime: null,        // ISO string van laatste geldige GPS-fix
    gpsIndexHint: null,       // index in route.points, voor snelle projectie

    paused: false,
    pauseStart: null,         // ISO string
    totalPauseMs: 0,
    autoPauseCandidateSince: null,

    speedSamples: [],         // [{t, km}] rollend venster voor tempo/snelheid

    checkpointLog: {},        // id -> { arrival: iso, pauseStartedAt: iso|null, pauseMs: number, departed: iso|null }

    settings: {
      powerSaving: false,
      remindersEnabled: false,
      notificationsEnabled: false,
      wakeLock: false,
    },

    reminders: {
      lastDrinkAtMinute: 0,   // wandeltijd in minuten bij laatste drinkherinnering
      lastEatAtMinute: 0,
      lastFootCheckKm: 0,
    },

    alertsFired: {},          // km-string -> true

    checklistHistory: [],     // [{t, answers, severe}]
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed);
  } catch (e) {
    console.warn("Kon opgeslagen status niet lezen, start opnieuw.", e);
    return defaultState();
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Opslaan mislukt", e);
    }
  }, 150);
}

/* ==========================================================================
   INDEXEDDB — opslag voor de (mogelijk grote) GPX-route, zodat de app
   volledig offline blijft werken na de eerste keer laden.
   ========================================================================== */

const IDB_NAME = "doto2026";
const IDB_STORE = "files";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
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

/* ==========================================================================
   ROUTE LADEN
   ========================================================================== */

async function initRoute() {
  // 1) Probeer een eerder lokaal opgeslagen GPX (werkt volledig offline).
  try {
    const cached = await idbGet("route_gpx_text");
    if (cached) {
      route.loadFromGpxText(cached);
      setGpxStatus(`Route geladen uit lokale opslag (${route.totalKm.toFixed(1)} km).`, "ok");
      afterRouteLoaded();
      return;
    }
  } catch (e) { /* IndexedDB niet beschikbaar of leeg, ga verder */ }

  // 2) Probeer het meegeleverde route.gpx bestand naast de app te laden.
  try {
    const res = await fetch("route.gpx", { cache: "force-cache" });
    if (res.ok) {
      const text = await res.text();
      route.loadFromGpxText(text);
      await idbSet("route_gpx_text", text);
      setGpxStatus(`Route geladen (${route.totalKm.toFixed(1)} km).`, "ok");
      afterRouteLoaded();
      return;
    }
  } catch (e) { /* geen netwerk of bestand ontbreekt, ga verder */ }

  setGpxStatus(
    "Geen route.gpx gevonden. Kies hieronder (of op het tabblad Correctie) het officiële GPX-bestand van de organisatie.",
    "err"
  );
}

async function handleGpxFile(file) {
  try {
    const text = await file.text();
    route.loadFromGpxText(text);
    await idbSet("route_gpx_text", text);
    setGpxStatus(`Route geladen uit bestand (${route.totalKm.toFixed(1)} km).`, "ok");
    afterRouteLoaded();
  } catch (e) {
    setGpxStatus("Kon dit bestand niet lezen als GPX-route.", "err");
  }
}

function setGpxStatus(msg, kind) {
  const el = document.getElementById("gpxStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = "gpx-status" + (kind ? " " + kind : "");
}

function afterRouteLoaded() {
  renderCheckpointList();
  renderDashboard();
  document.getElementById("mapEmpty").style.display = "none";
  if (mapView) {
    mapView.computeBounds();
    mapView.resize();
    mapView.draw();
  }
}

/* ==========================================================================
   NAVIGATIE TUSSEN SCHERMEN
   ========================================================================== */

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.screen === name);
  });
  if (name === "checkpoints") renderCheckpointList();
  if (name === "correction") populateCorrectionForm();
  if (name === "map" && mapView) {
    // canvas had tot nu toe display:none, dus pas nu de echte afmetingen kennen
    requestAnimationFrame(() => { mapView.resize(); mapView.draw(); });
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

/* ==========================================================================
   TIJD- EN AFSTANDSHULPFUNCTIES
   ========================================================================== */

function nowIso() { return new Date().toISOString(); }

/** Wandeltijd (excl. pauzes) in milliseconden sinds start. */
function walkingElapsedMs() {
  if (!state.startTime) return 0;
  let elapsed = Date.now() - new Date(state.startTime).getTime();
  let pauseMs = state.totalPauseMs;
  if (state.paused && state.pauseStart) {
    pauseMs += Date.now() - new Date(state.pauseStart).getTime();
  }
  return Math.max(0, elapsed - pauseMs);
}

function totalElapsedMs() {
  if (!state.startTime) return 0;
  return Math.max(0, Date.now() - new Date(state.startTime).getTime());
}

function fmtHM(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function fmtClock(date) {
  return date.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });
}

/** Persoonlijk schema: verwachte wandeltijd (uren) om een gegeven km te bereiken. */
function scheduleHoursForKm(km) {
  if (km <= 50) return km / PACE_PLAN.early.targetKmh;
  const t50 = 50 / PACE_PLAN.early.targetKmh;
  const phase2Speed = 50 / (DEADLINE_HOURS - t50); // resterende 50 km in resterende tijd tot 24u
  return t50 + (km - 50) / phase2Speed;
}

/* ==========================================================================
   GPS
   ========================================================================== */

let watchId = null;

function startGps() {
  if (!("geolocation" in navigator)) {
    showToast("Dit toestel ondersteunt geen GPS-locatie.");
    return;
  }
  stopGps();
  const opts = state.settings.powerSaving
    ? { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 }
    : { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 };
  watchId = navigator.geolocation.watchPosition(onGpsFix, onGpsError, opts);
  setStatusPill("gps-active");
}

function stopGps() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function recalibrateGps() {
  // Herstart de watch en laat de projectie opnieuw een volledige scan doen
  // in plaats van rond een oud hint-punt te blijven zoeken.
  state.gpsIndexHint = null;
  startGps();
  showToast("GPS wordt herkalibreerd…");
}

const MIN_ACCEPT_ACCURACY_M = 60; // negeer fixes die te onnauwkeurig zijn
const BACKWARD_TOLERANCE_M = 20;  // kleine ruis naar achter wordt genegeerd
const JUMP_REJECT_M = 300;        // sprong groter dan dit in één fix wordt genegeerd (tenzij bevestigd)

let pendingBackStreak = 0;

function onGpsFix(pos) {
  if (!route.loaded) return; // nog geen route om tegen te projecteren

  const { latitude, longitude, accuracy, speed } = pos.coords;
  if (accuracy && accuracy > MIN_ACCEPT_ACCURACY_M) return; // te onnauwkeurig, negeer

  const proj = route.projectDistanceKm(latitude, longitude, state.gpsIndexHint);
  if (!proj) return;

  const currentMaxM = state.maxDistanceKm * 1000;
  const newM = proj.km * 1000;
  const deltaM = newM - currentMaxM;

  if (deltaM >= -BACKWARD_TOLERANCE_M && deltaM <= JUMP_REJECT_M) {
    // normale voorwaartse (of licht ruisende) update: accepteren
    applyConfirmedDistance(Math.max(state.distanceKm, proj.km), proj.index);
    pendingBackStreak = 0;
  } else if (deltaM < -BACKWARD_TOLERANCE_M) {
    // mogelijke terugloop (bv. rond een obstakel): pas na herhaalde bevestiging accepteren
    pendingBackStreak++;
    if (pendingBackStreak >= 3) {
      applyConfirmedDistance(proj.km, proj.index);
      pendingBackStreak = 0;
    }
  } else if (deltaM > JUMP_REJECT_M) {
    // te grote sprong in één keer: negeer als eenmalige uitschieter
    pendingBackStreak = 0;
  }

  trackSpeedSample(state.distanceKm);
  autoPauseDetection();

  if (mapView) mapView.setUserPosition(latitude, longitude);
}

function applyConfirmedDistance(km, index) {
  state.distanceKm = Math.max(0, Math.min(TOTAL_KM, km));
  state.maxDistanceKm = Math.max(state.maxDistanceKm, state.distanceKm);
  state.gpsIndexHint = index;
  state.lastFixTime = nowIso();
  saveState();
}

function onGpsError(err) {
  // Stil falen naar de UI toe; de statuspil toont "geen GPS-signaal".
  setStatusPill("gps-lost");
}

function trackSpeedSample(km) {
  const t = Date.now();
  state.speedSamples.push({ t, km });
  const cutoff = t - 3 * 60 * 1000; // laatste 3 minuten
  state.speedSamples = state.speedSamples.filter((s) => s.t >= cutoff);
}

function currentSpeedKmh() {
  const samples = state.speedSamples;
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dtH = (last.t - first.t) / 3600000;
  if (dtH <= 0) return null;
  const dKm = last.km - first.km;
  const kmh = dKm / dtH;
  return kmh >= 0 && kmh < 12 ? kmh : null; // filter onrealistische pieken
}

/* ---------------- Automatische pauzedetectie ---------------- */

function autoPauseDetection() {
  if (state.paused) return; // al manueel gepauzeerd
  const speed = currentSpeedKmh();
  const stillMoving = speed === null || speed > 1.0;

  if (!stillMoving) {
    if (!state.autoPauseCandidateSince) state.autoPauseCandidateSince = Date.now();
    const stillMs = Date.now() - state.autoPauseCandidateSince;
    if (stillMs > 5 * 60 * 1000) {
      startPause(true);
      state.autoPauseCandidateSince = null;
    }
  } else {
    state.autoPauseCandidateSince = null;
  }
}

/* ==========================================================================
   START / PAUZE
   ========================================================================== */

function startTocht() {
  if (state.startTime) return;
  state.startTime = nowIso();
  saveState();
  startGps();
  document.getElementById("startBtn").style.display = "none";
  document.getElementById("pauseToggleBtn").style.display = "block";
  showToast("Tocht gestart. Succes!");
}

function startPause(auto) {
  if (state.paused) return;
  state.paused = true;
  state.pauseStart = nowIso();
  saveState();
  updatePauseButton();
  if (auto) showToast("Automatisch gepauzeerd (geen beweging gedetecteerd).");
}

function endPause() {
  if (!state.paused) return;
  const startedAt = new Date(state.pauseStart).getTime();
  state.totalPauseMs += Date.now() - startedAt;
  state.paused = false;
  state.pauseStart = null;
  saveState();
  updatePauseButton();
}

function updatePauseButton() {
  const btn = document.getElementById("pauseToggleBtn");
  btn.textContent = state.paused ? "Pauze beëindigen" : "Pauze starten";
}

/* ==========================================================================
   CONTROLEPOSTEN
   ========================================================================== */

function getNextCheckpoint() {
  return CHECKPOINTS.find((cp) => cp.km > state.distanceKm + 0.02) || null;
}

function getCurrentCheckpointIndex() {
  let idx = 0;
  for (let i = 0; i < CHECKPOINTS.length; i++) {
    if (CHECKPOINTS[i].km <= state.distanceKm + 0.02) idx = i;
  }
  return idx;
}

function checkCheckpointArrivals() {
  CHECKPOINTS.forEach((cp) => {
    if (cp.km === 0) return;
    const already = state.checkpointLog[cp.id];
    if (!already && state.distanceKm >= cp.km - 0.05) {
      state.checkpointLog[cp.id] = { arrival: nowIso(), pauseStartedAt: null, pauseMs: 0, departed: null };
      saveState();
      onCheckpointReached(cp);
    }
  });
}

function onCheckpointReached(cp) {
  showToast(`Controlepost bereikt: ${cp.name}`);
  if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
  renderCheckpointList();
  updateMapReachedSet();
}

function updateMapReachedSet() {
  if (!mapView) return;
  mapView.setReached(new Set(Object.keys(state.checkpointLog).map(Number)));
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
  if (!log || !log.pauseStartedAt) return;
  log.pauseMs += Date.now() - new Date(log.pauseStartedAt).getTime();
  log.pauseStartedAt = null;
  log.departed = nowIso();
  saveState();
  renderCheckpointList();
}

/* ==========================================================================
   AFSTANDSMELDINGEN & HERINNERINGEN
   ========================================================================== */

function checkDistanceAlerts() {
  if (!state.settings.remindersEnabled) return;
  DISTANCE_ALERTS.forEach((alert) => {
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
    notify("Tijd om te drinken.");
    saveState();
  }
  if (walkMin - state.reminders.lastEatAtMinute >= 65) {
    state.reminders.lastEatAtMinute = walkMin;
    notify("Tijd om iets te eten.");
    saveState();
  }
  if (state.distanceKm - state.reminders.lastFootCheckKm >= 15) {
    state.reminders.lastFootCheckKm = state.distanceKm;
    notify("Voetcheck: even controleren.");
    saveState();
  }
}

function notify(message) {
  showToast(message);
  if (state.settings.notificationsEnabled && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Dodentocht", { body: message, icon: "icon-192.png", silent: false });
    } catch (e) { /* sommige browsers vereisen een service worker registratie */ }
  }
  if (navigator.vibrate) navigator.vibrate([50]);
}

let toastTimer = null;
function showToast(message) {
  const stack = document.getElementById("toastStack");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* ==========================================================================
   STATUS (groen / oranje / rood)
   ========================================================================== */

function computeStatus() {
  const elapsedH = walkingElapsedMs() / 3600000;
  const remainingKm = Math.max(0, TOTAL_KM - state.distanceKm);

  if (!state.startTime || state.distanceKm < 1 || elapsedH < 0.25) {
    return { level: "green", title: "Opwarmen", text: "Houd je eigen ritme." };
  }

  const overallSpeed = state.distanceKm / elapsedH;
  const etaHoursFromNow = overallSpeed > 0.3 ? remainingKm / overallSpeed : 99;
  const etaDate = new Date(Date.now() + etaHoursFromNow * 3600000);
  const deadline = new Date(new Date(state.startTime).getTime() + DEADLINE_HOURS * 3600000);
  const marginMin = (deadline.getTime() - etaDate.getTime()) / 60000;

  let level, title, text;
  if (marginMin > 90) {
    level = "green"; title = "Comfortabel op schema"; text = "Houd je eigen ritme.";
  } else if (marginMin > 0) {
    level = "orange"; title = "Marge wordt kleiner"; text = "Beperk lange pauzes.";
  } else {
    level = "red"; title = "Focus op de volgende post"; text = "Blijf rustig bewegen, stap voor stap.";
  }

  return { level, title, text, etaDate, marginMin, overallSpeed, requiredSpeed: remainingKm / Math.max(0.01, (deadline - Date.now()) / 3600000) };
}

function setStatusPill(mode) {
  const label = document.getElementById("statusLabel");
  const dot = document.getElementById("statusDot");
  if (mode === "gps-active") { label.textContent = "GPS actief"; }
  else if (mode === "gps-lost") { label.textContent = "Geen GPS-signaal"; }
  dot.className = "status-dot " + (currentStatusLevel || "");
}

let currentStatusLevel = "";

/* ==========================================================================
   RENDER — DASHBOARD
   ========================================================================== */

function renderDashboard() {
  document.getElementById("distanceValue").textContent = state.distanceKm.toFixed(1);
  const remaining = Math.max(0, TOTAL_KM - state.distanceKm);
  document.getElementById("remainingLabel").textContent = `${remaining.toFixed(1)} km te gaan`;
  document.getElementById("progressFill").style.width = `${Math.min(100, (state.distanceKm / TOTAL_KM) * 100)}%`;

  const elapsedH = walkingElapsedMs() / 3600000;
  const avgPace = elapsedH > 0.02 ? state.distanceKm / elapsedH : null;
  document.getElementById("paceValue").textContent = avgPace ? avgPace.toFixed(1) : "–";

  const speed = currentSpeedKmh();
  document.getElementById("speedValue").textContent = speed !== null ? speed.toFixed(1) : "–";

  document.getElementById("elapsedValue").textContent = fmtHM(walkingElapsedMs());
  document.getElementById("pauseValue").textContent = `${Math.round(state.totalPauseMs / 60000)} min pauze`;

  const status = computeStatus();
  currentStatusLevel = status.level;
  setStatusPill(watchId !== null ? "gps-active" : "gps-lost");

  if (status.etaDate) {
    document.getElementById("etaValue").textContent = fmtClock(status.etaDate);
    const marginTxt = status.marginMin >= 0
      ? `${Math.round(status.marginMin)} min marge`
      : `${Math.round(-status.marginMin)} min te kort`;
    document.getElementById("marginValue").textContent = marginTxt;
  } else {
    document.getElementById("etaValue").textContent = "–:–";
    document.getElementById("marginValue").textContent = "–";
  }

  const banner = document.getElementById("statusBanner");
  banner.className = "glass card status-banner " + status.level;
  document.getElementById("statusBannerTitle").textContent = status.title;
  document.getElementById("statusBannerText").textContent = status.text;

  const next = getNextCheckpoint();
  if (next) {
    const toGo = Math.max(0, next.km - state.distanceKm);
    document.getElementById("nextCpName").textContent = next.name;
    document.getElementById("nextCpDist").textContent = `${toGo.toFixed(1)} km`;
    const schedH = scheduleHoursForKm(next.km);
    const scheduleEta = state.startTime
      ? new Date(new Date(state.startTime).getTime() + schedH * 3600000)
      : null;
    let meta = `Km ${next.km} · pauze ${next.rest} min`;
    if (avgPace && toGo > 0) {
      const etaNext = new Date(Date.now() + (toGo / Math.max(0.3, avgPace)) * 3600000);
      meta += ` · aankomst ± ${fmtClock(etaNext)}`;
    }
    document.getElementById("nextCpMeta").textContent = meta;
  } else {
    document.getElementById("nextCpName").textContent = "Finish bereikt";
    document.getElementById("nextCpDist").textContent = "🏁";
    document.getElementById("nextCpMeta").textContent = "Proficiat!";
  }

  document.getElementById("startBtn").style.display = state.startTime ? "none" : "block";
  document.getElementById("pauseToggleBtn").style.display = state.startTime ? "block" : "none";
  updatePauseButton();
}

/* ==========================================================================
   RENDER — CONTROLEPOSTEN
   ========================================================================== */

function renderCheckpointList() {
  const list = document.getElementById("checkpointList");
  list.innerHTML = "";
  const currentIdx = getCurrentCheckpointIndex();

  CHECKPOINTS.forEach((cp, i) => {
    const log = state.checkpointLog[cp.id];
    const reached = !!log || cp.km === 0 && state.startTime;
    const isCurrent = i === currentIdx && cp.km !== 0;

    const el = document.createElement("div");
    el.className = "cp-item" + (reached ? " reached" : "") + (isCurrent ? " current" : "");

    const toGo = Math.max(0, cp.km - state.distanceKm);
    const schedH = scheduleHoursForKm(cp.km);
    const schedDate = state.startTime
      ? new Date(new Date(state.startTime).getTime() + schedH * 3600000)
      : null;

    let arrivalTxt = "";
    if (log) {
      arrivalTxt = `Aangekomen ${fmtClock(new Date(log.arrival))}`;
    } else if (schedDate) {
      arrivalTxt = `Verwacht ± ${fmtClock(schedDate)}`;
    }

    el.innerHTML = `
      <div class="cp-top">
        <span class="cp-name">${cp.name}</span>
        <span class="cp-km">${cp.km} km</span>
      </div>
      <div class="cp-row"><span>${arrivalTxt || "—"}</span><span>${cp.km > 0 ? toGo.toFixed(1) + " km te gaan" : ""}</span></div>
      ${cp.supplies.length ? `<div class="cp-supplies">Bevoorrading: ${cp.supplies.join(", ")}</div>` : ""}
      ${cp.rest ? `<div class="cp-row"><span>Geplande pauze</span><span>${cp.rest} min</span></div>` : ""}
    `;

    if (cp.km > 0) {
      const pauseRow = document.createElement("div");
      pauseRow.className = "cp-pause-row";
      const startBtn = document.createElement("button");
      startBtn.className = "pill-btn small ghost";
      startBtn.textContent = "Pauze start";
      startBtn.disabled = !log || !!log.pauseStartedAt;
      startBtn.addEventListener("click", () => cpPauseStart(cp.id));

      const endBtn = document.createElement("button");
      endBtn.className = "pill-btn small ghost";
      endBtn.textContent = "Pauze einde";
      endBtn.disabled = !log || !log.pauseStartedAt;
      endBtn.addEventListener("click", () => cpPauseEnd(cp.id));

      pauseRow.appendChild(startBtn);
      pauseRow.appendChild(endBtn);
      el.appendChild(pauseRow);

      if (log && (log.pauseStartedAt || log.pauseMs > 0)) {
        const timerEl = document.createElement("div");
        timerEl.className = "cp-pause-timer";
        const liveMs = log.pauseStartedAt ? Date.now() - new Date(log.pauseStartedAt).getTime() : 0;
        timerEl.textContent = fmtHM(log.pauseMs + liveMs) + " pauze";
        el.appendChild(timerEl);
      }
    }

    list.appendChild(el);
  });
}

/* ==========================================================================
   MANUELE CORRECTIE
   ========================================================================== */

function populateCorrectionForm() {
  const sel = document.getElementById("corrCp");
  sel.innerHTML = CHECKPOINTS.map((cp) => `<option value="${cp.km}">${cp.name} (${cp.km} km)</option>`).join("");
  document.getElementById("corrKm").value = state.distanceKm.toFixed(1);
  if (state.startTime) {
    const d = new Date(state.startTime);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById("corrStart").value = local;
  }
  document.getElementById("corrPause").value = Math.round(state.totalPauseMs / 60000);
}

function applyCorrection() {
  const km = parseFloat(document.getElementById("corrKm").value);
  const startVal = document.getElementById("corrStart").value;
  const pauseMin = parseFloat(document.getElementById("corrPause").value);

  if (Number.isFinite(km)) {
    state.distanceKm = Math.max(0, Math.min(TOTAL_KM, km));
    state.maxDistanceKm = state.distanceKm;
    if (route.loaded) {
      const p = route.pointAtDistance(state.distanceKm);
      const proj = p ? route.projectDistanceKm(p.lat, p.lon, null) : null;
      state.gpsIndexHint = proj ? proj.index : null;
    }
  }
  if (startVal) {
    state.startTime = new Date(startVal).toISOString();
  }
  if (Number.isFinite(pauseMin)) {
    state.totalPauseMs = Math.max(0, pauseMin) * 60000;
  }

  saveState();
  renderDashboard();
  renderCheckpointList();
  showToast("Correctie toegepast.");
}

/* ==========================================================================
   VOET- & LICHAAMSCHECK
   ========================================================================== */

const CHECKLIST_QUESTIONS = [
  { id: "blaar", label: "Blaar / hotspot", severe: false },
  { id: "nat", label: "Natte sokken", severe: false },
  { id: "pijn", label: "Pijn", severe: false },
  { id: "misselijk", label: "Misselijkheid", severe: true },
  { id: "duizelig", label: "Duizeligheid", severe: true },
  { id: "gedronken", label: "Genoeg gedronken", invert: true, severe: false },
  { id: "gegeten", label: "Genoeg gegeten", invert: true, severe: false },
];

function renderChecklist() {
  const wrap = document.getElementById("checklistItems");
  wrap.innerHTML = CHECKLIST_QUESTIONS.map(
    (q) => `
    <label class="checklist-row">
      <span>${q.label}</span>
      <input type="checkbox" data-id="${q.id}" />
    </label>`
  ).join("");
  document.getElementById("checklistWarning").style.display = "none";
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
  document.querySelectorAll("#checklistItems input[type=checkbox]").forEach((cb) => {
    answers[cb.dataset.id] = cb.checked;
    const q = CHECKLIST_QUESTIONS.find((qq) => qq.id === cb.dataset.id);
    if (q && q.severe && cb.checked) severe = true;
  });

  if (severe) {
    document.getElementById("checklistWarning").style.display = "block";
    return; // laat de waarschuwing zien, gebruiker sluit zelf na het lezen
  }

  state.checklistHistory.push({ t: nowIso(), answers, severe });
  saveState();
  closeChecklist();
  showToast("Check opgeslagen.");
}

/* ==========================================================================
   INSTELLINGEN
   ========================================================================== */

function applySettingsToUI() {
  document.getElementById("powerSavingToggle").checked = state.settings.powerSaving;
  document.getElementById("remindersToggle").checked = state.settings.remindersEnabled;
  document.getElementById("wakeLockToggle").checked = state.settings.wakeLock;
}

function exportData() {
  const payload = {
    exportedAt: nowIso(),
    state,
    checkpoints: CHECKPOINTS,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dodentocht2026-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function resetTocht() {
  if (!confirm("Weet je zeker dat je alle voortgang wilt wissen?")) return;
  const settings = state.settings;
  state = defaultState();
  state.settings = settings;
  saveState();
  stopGps();
  renderDashboard();
  renderCheckpointList();
  showToast("Tocht gereset.");
}

/* ==========================================================================
   WAKE LOCK & FULLSCREEN
   ========================================================================== */

let wakeLockSentinel = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
  } catch (e) { /* kan geweigerd worden, bv. lage batterij; stil negeren */ }
}
function releaseWakeLock() {
  if (wakeLockSentinel) { wakeLockSentinel.release().catch(() => {}); wakeLockSentinel = null; }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.settings.wakeLock) requestWakeLock();
});

document.getElementById("fullscreenBtn").addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});

/* ==========================================================================
   EVENT WIRING
   ========================================================================== */

document.getElementById("startBtn").addEventListener("click", startTocht);
document.getElementById("pauseToggleBtn").addEventListener("click", () => {
  state.paused ? endPause() : startPause(false);
});
document.getElementById("checklistBtn").addEventListener("click", openChecklist);
document.getElementById("recalibrateBtn").addEventListener("click", recalibrateGps);

document.getElementById("checklistCancelBtn").addEventListener("click", closeChecklist);
document.getElementById("checklistSaveBtn").addEventListener("click", saveChecklist);

document.getElementById("applyCorrectionBtn").addEventListener("click", applyCorrection);
document.getElementById("gpxFileInput").addEventListener("change", (e) => {
  if (e.target.files[0]) handleGpxFile(e.target.files[0]);
});

document.getElementById("powerSavingToggle").addEventListener("change", (e) => {
  state.settings.powerSaving = e.target.checked;
  saveState();
  if (watchId !== null) startGps(); // herstart met nieuwe instellingen
});
document.getElementById("remindersToggle").addEventListener("change", (e) => {
  state.settings.remindersEnabled = e.target.checked;
  saveState();
});
document.getElementById("wakeLockToggle").addEventListener("change", (e) => {
  state.settings.wakeLock = e.target.checked;
  saveState();
  if (e.target.checked) requestWakeLock(); else releaseWakeLock();
});
document.getElementById("notifPermBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) { showToast("Meldingen worden niet ondersteund."); return; }
  const perm = await Notification.requestPermission();
  state.settings.notificationsEnabled = perm === "granted";
  saveState();
  showToast(perm === "granted" ? "Meldingen ingeschakeld." : "Meldingen niet toegestaan.");
});
document.getElementById("exportBtn").addEventListener("click", exportData);
document.getElementById("resetBtn").addEventListener("click", resetTocht);

document.getElementById("mapResetBtn").addEventListener("click", () => {
  if (!mapView) return;
  mapView.resetView();
  document.getElementById("mapFollowBtn").classList.remove("active");
  mapView.draw();
});
document.getElementById("mapFollowBtn").addEventListener("click", (e) => {
  if (!mapView) return;
  mapView.followMode = !mapView.followMode;
  e.currentTarget.classList.toggle("active", mapView.followMode);
  if (mapView.followMode && mapView.userLatLon) {
    mapView.centerOn(mapView.userLatLon.lat, mapView.userLatLon.lon);
  }
  mapView.draw();
});

/* ==========================================================================
   HOOFDLUS
   ========================================================================== */

function tick() {
  checkCheckpointArrivals();
  checkDistanceAlerts();
  checkPeriodicReminders();
  renderDashboard();
  if (document.getElementById("screen-checkpoints").classList.contains("active")) {
    renderCheckpointList();
  }
  if (document.getElementById("screen-map").classList.contains("active") && mapView) {
    mapView.draw();
  }
}

setInterval(tick, 1000);

/* ==========================================================================
   OPSTARTEN
   ========================================================================== */

async function boot() {
  populateCorrectionForm();
  applySettingsToUI();

  mapView = new MapView(document.getElementById("routeCanvas"), route, CHECKPOINTS);

  await initRoute();
  updateMapReachedSet();

  if (state.startTime) {
    startGps();
    if (state.settings.wakeLock) requestWakeLock();
  }
  renderDashboard();
  renderCheckpointList();

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js"); } catch (e) { /* offline-first blijft werken zonder */ }
  }
}

boot();
