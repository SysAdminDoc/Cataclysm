import test from "node:test";
import assert from "node:assert/strict";
import { browserNetworkOrigins, patternCoversOrigin, verifyNetworkTrust } from "./verify-network-trust.mjs";

test("live network trust declaration matches every reachable application origin", () => {
  assert.deepEqual(verifyNetworkTrust(), []);
});

test("origin scanner exposes an undeclared telemetry reference", () => {
  const origins = browserNetworkOrigins('fetch("https://telemetry.example/collect")');
  assert.deepEqual(origins, ["https://telemetry.example"]);
  assert.equal(patternCoversOrigin("https://*.cesium.com", origins[0]), false);
});

test("wildcard declarations cover subdomains but not the provider apex", () => {
  assert.equal(patternCoversOrigin("https://*.cesium.com", "https://assets.cesium.com"), true);
  assert.equal(patternCoversOrigin("https://*.cesium.com", "https://cesium.com"), false);
});
