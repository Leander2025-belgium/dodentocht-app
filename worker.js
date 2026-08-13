"use strict";

const CODE_PATTERN = /^[A-Z2-9]{8,16}$/;
const MAX_BODY_BYTES = 16 * 1024;
const VIEWER_ACTIVE_MS = 20_000;
const DEFAULT_TTL_HOURS = 48;
let schemaPromise;

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};

export async function handleRequest(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);

  if (origin && !allowedOrigins.has(origin)) {
    return json({ error: "Herkomst niet toegestaan" }, 403, corsHeaders(origin, false));
  }

  const cors = corsHeaders(origin, true);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  if (url.pathname === "/health") {
    try {
      await ensureSchema(env);
      await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: true, service: "dodentocht-live-api" }, 200, cors);
    } catch {
      return json({ ok: false, error: "Database niet beschikbaar" }, 503, cors);
    }
  }

  const match = url.pathname.match(
    /^\/api\/dodentocht\/live\/([A-Za-z2-9]{8,16})(?:\/(start|stop|update|viewer-heartbeat|presence))?\/?$/
  );

  if (!match) return json({ error: "Route niet gevonden" }, 404, cors);

  const code = normalizeCode(match[1]);
  const action = match[2] || "snapshot";
  if (!code) return json({ error: "Ongeldige livecode" }, 400, cors);

  try {
    await ensureSchema(env);

    if (request.method === "POST" && action === "start") {
      return startSession(env, code, cors);
    }

    if (request.method === "POST" && action === "stop") {
      return stopSession(env, code, cors);
    }

    if (request.method === "POST" && action === "update") {
      const body = await readJsonBody(request);
      return updateSession(env, code, sanitizeSnapshot(body), cors);
    }

    if (request.method === "POST" && action === "viewer-heartbeat") {
      return recordViewerHeartbeat(env, code, cors);
    }

    if (request.method === "GET" && action === "presence") {
      return getPresence(env, code, cors);
    }

    if (request.method === "GET" && action === "snapshot") {
      return getSnapshot(env, code, cors);
    }

    return json({ error: "Methode niet toegestaan" }, 405, cors, {
      Allow: action === "snapshot" || action === "presence" ? "GET, OPTIONS" : "POST, OPTIONS"
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: error.message }, error.status, cors);
    }

    console.error("Live API-fout", error);
    return json({ error: "Interne serverfout" }, 500, cors);
  }
}

async function startSession(env, code, cors) {
  const now = Date.now();
  await deleteExpiredSessions(env);
  await env.DB.prepare(`
    INSERT INTO live_sessions
      (code, active, started_at, updated_at, last_viewer_at, snapshot)
    VALUES (?, 1, ?, ?, NULL, NULL)
    ON CONFLICT(code) DO UPDATE SET
      active = 1,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at,
      last_viewer_at = NULL,
      snapshot = NULL
  `).bind(code, now, now).run();

  return json({ ok: true }, 200, cors);
}

async function stopSession(env, code, cors) {
  await env.DB.prepare("DELETE FROM live_sessions WHERE code = ?")
    .bind(code)
    .run();
  return json({ ok: true }, 200, cors);
}

async function updateSession(env, code, snapshot, cors) {
  const now = Date.now();
  const result = await env.DB.prepare(`
    UPDATE live_sessions
    SET snapshot = ?, updated_at = ?
    WHERE code = ? AND active = 1
  `).bind(JSON.stringify({ ...snapshot, receivedAt: now }), now, code).run();

  if (!result.meta?.changes) {
    return json({ error: "Geen actieve live sessie" }, 409, cors);
  }

  return json({ ok: true, receivedAt: now }, 200, cors);
}

async function getSnapshot(env, code, cors) {
  const session = await env.DB.prepare(`
    SELECT snapshot
    FROM live_sessions
    WHERE code = ? AND active = 1 AND snapshot IS NOT NULL
  `).bind(code).first();

  if (!session) return json({ error: "Geen actieve live sessie" }, 404, cors);

  let snapshot;
  try {
    snapshot = JSON.parse(session.snapshot);
  } catch {
    throw new ApiError(500, "Livegegevens zijn beschadigd");
  }

  return json({ active: true, snapshot }, 200, cors);
}

async function recordViewerHeartbeat(env, code, cors) {
  const result = await env.DB.prepare(`
    UPDATE live_sessions
    SET last_viewer_at = ?
    WHERE code = ? AND active = 1
  `).bind(Date.now(), code).run();

  if (!result.meta?.changes) {
    return json({ error: "Geen actieve live sessie" }, 404, cors);
  }

  return json({ ok: true }, 200, cors);
}

async function getPresence(env, code, cors) {
  const session = await env.DB.prepare(`
    SELECT last_viewer_at
    FROM live_sessions
    WHERE code = ? AND active = 1
  `).bind(code).first();

  return json({
    viewerActive: Boolean(
      session?.last_viewer_at &&
      Date.now() - Number(session.last_viewer_at) < VIEWER_ACTIVE_MS
    )
  }, 200, cors);
}

async function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS live_sessions (
          code TEXT PRIMARY KEY,
          active INTEGER NOT NULL DEFAULT 1,
          started_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_viewer_at INTEGER,
          snapshot TEXT
        )
      `),
      env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_live_sessions_updated_at
        ON live_sessions(updated_at)
      `)
    ]).catch(error => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

async function deleteExpiredSessions(env) {
  const ttlHours = clampNumber(Number(env.SESSION_TTL_HOURS), 1, 168, DEFAULT_TTL_HOURS);
  const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;
  await env.DB.prepare("DELETE FROM live_sessions WHERE updated_at < ?")
    .bind(cutoff)
    .run();
}

async function readJsonBody(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "Content-Type moet application/json zijn");
  }

  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "Aanvraag is te groot");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "Aanvraag is te groot");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Ongeldige JSON");
  }
}

export function sanitizeSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, "Ongeldige livegegevens");
  }

  const next = input.nextCheckpoint && typeof input.nextCheckpoint === "object"
    ? {
        name: cleanText(input.nextCheckpoint.name, 80),
        location: cleanText(input.nextCheckpoint.location, 80),
        km: optionalNumber(input.nextCheckpoint.km, 0, 100)
      }
    : null;

  const lat = input.position?.lat;
  const lon = input.position?.lon;
  const position = Number.isFinite(lat) && Number.isFinite(lon)
    ? {
        lat: clampNumber(lat, -90, 90, null),
        lon: clampNumber(lon, -180, 180, null),
        accuracy: optionalNumber(input.position.accuracy, 0, 10_000),
        timestamp: optionalNumber(input.position.timestamp, 0, Number.MAX_SAFE_INTEGER)
      }
    : null;

  return {
    timestamp: clampNumber(Number(input.timestamp), 0, Number.MAX_SAFE_INTEGER, Date.now()),
    distanceKm: optionalNumber(input.distanceKm, 0, 100),
    speedKmh: optionalNumber(input.speedKmh, 0, 50),
    elapsedMs: optionalNumber(input.elapsedMs, 0, 7 * 24 * 60 * 60 * 1000),
    nextCheckpoint: next,
    battery: optionalNumber(input.battery, 0, 100),
    position
  };
}

export function normalizeCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function parseAllowedOrigins(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map(origin => origin.trim())
      .filter(Boolean)
  );
}

function corsHeaders(origin, allowed) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };

  if (origin && allowed) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body, status, cors = {}, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...cors,
      ...extraHeaders
    }
  });
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function optionalNumber(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  return clampNumber(Number(value), min, max, null);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
