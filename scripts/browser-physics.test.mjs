import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const wasmPath = new URL("../public/physics/cataclysm_browser_physics.wasm", import.meta.url);

async function physicsCaller() {
  const bytes = await readFile(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const wasm = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return (request) => {
    const input = encoder.encode(JSON.stringify(request));
    const pointer = wasm.cataclysm_alloc(input.byteLength);
    try {
      new Uint8Array(wasm.memory.buffer, pointer, input.byteLength).set(input);
      wasm.cataclysm_compute(pointer, input.byteLength);
      const output = new Uint8Array(
        wasm.memory.buffer,
        wasm.cataclysm_result_ptr(),
        wasm.cataclysm_result_len(),
      ).slice();
      const response = JSON.parse(decoder.decode(output));
      assert.equal(response.ok, true, response.error);
      return response.value;
    } finally {
      wasm.cataclysm_dealloc(pointer, input.byteLength);
    }
  };
}

test("browser WASM returns the shared Rust asteroid source fixture", async () => {
  const call = await physicsCaller();
  const initial = call({
    operation: "initial",
    input: {
      kind: "Asteroid",
      source: {
        diameter_m: 1000,
        density_kg_m3: 3000,
        velocity_m_s: 20000,
        angle_deg: 45,
        water_depth_m: 4500,
        location: { lat_deg: 35, lon_deg: -45, depth_m: 4500 },
      },
    },
  });
  assert.equal(initial.peak_amplitude_m, 2250);
  assert.equal(initial.cavity_radius_m, 12380.569816177842);
  assert.equal(initial.source_energy_j, 314159265358979300000);
  assert.equal(initial.source_geometry.kind, "cavity_ring");
});

test("browser WASM attenuation matches the desktop Rust screening fixture", async () => {
  const call = await physicsCaller();
  const samples = call({
    operation: "attenuation",
    initial_amplitude_m: 10,
    cavity_radius_m: 2000,
    decay_alpha: 5 / 6,
    max_range_m: 100000,
    n_samples: 3,
  });
  assert.deepEqual(samples, [
    { range_m: 2000, amplitude_m: 10 },
    { range_m: 51000, amplitude_m: 0.6727956625937952 },
    { range_m: 100000, amplitude_m: 0.38387662073329687 },
  ]);
});

test("browser WASM runup and inspect route through the same point screening", async () => {
  const call = await physicsCaller();
  const common = {
    source: { lat_deg: 21.4, lon_deg: -89.5, depth_m: 1500 },
    initial_amplitude_m: 2250,
    cavity_radius_m: 12380.569816177842,
    is_impact: true,
    mean_depth_m: 4000,
    time_s: 50000,
  };
  const point = { lat: 19.43, lon: -99.13, beach_slope_deg: 1, offshore_depth_m: 50 };
  const [runup] = call({ operation: "runup", ...common, points: [point] });
  const inspect = call({
    operation: "inspect",
    ...common,
    click_lat: point.lat,
    click_lon: point.lon,
    beach_slope_deg: point.beach_slope_deg,
    offshore_depth_m: point.offshore_depth_m,
  });
  assert.deepEqual(inspect, runup);
  assert.ok(runup.runup_m > 0);
  assert.ok(runup.arrival_time_s > 0);
});
