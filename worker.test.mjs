import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCode,
  parseAllowedOrigins,
  sanitizeSnapshot
} from "../src/worker.js";

test("livecodes zijn hoofdlettergevoelig noch gemakkelijk te raden", () => {
  assert.equal(normalizeCode("abcd2345efgh"), "ABCD2345EFGH");
  assert.equal(normalizeCode("kort"), null);
  assert.equal(normalizeCode("INVALID01"), null);
});

test("toegestane herkomsten worden exact gelezen", () => {
  const origins = parseAllowedOrigins(
    "https://leander2025-belgium.github.io, http://localhost:8080"
  );
  assert.equal(origins.has("https://leander2025-belgium.github.io"), true);
  assert.equal(origins.has("https://example.com"), false);
});

test("livegegevens worden begrensd en opgeschoond", () => {
  const snapshot = sanitizeSnapshot({
    timestamp: 123,
    distanceKm: 150,
    speedKmh: -4,
    elapsedMs: 10_000,
    battery: 120,
    nextCheckpoint: {
      name: "Weert",
      location: "Kerk",
      km: 8.3
    },
    position: {
      lat: 51.09,
      lon: 4.24,
      accuracy: 12,
      timestamp: 456
    }
  });

  assert.equal(snapshot.distanceKm, 100);
  assert.equal(snapshot.speedKmh, 0);
  assert.equal(snapshot.battery, 100);
  assert.deepEqual(snapshot.position, {
    lat: 51.09,
    lon: 4.24,
    accuracy: 12,
    timestamp: 456
  });
});

test("ontbrekende sensorwaarden blijven leeg", () => {
  const snapshot = sanitizeSnapshot({
    timestamp: 123,
    distanceKm: 1.2,
    speedKmh: null,
    elapsedMs: null,
    battery: null,
    position: null
  });

  assert.equal(snapshot.speedKmh, null);
  assert.equal(snapshot.elapsedMs, null);
  assert.equal(snapshot.battery, null);
  assert.equal(snapshot.position, null);
});
