import { beforeEach, describe, expect, it } from "vitest";
import {
  LAYER_STORAGE_KEY,
  buildLayerScenarioKey,
  defaultLayerState,
  layerExportRecords,
  loadScenarioLayerState,
  moveLayer,
  saveScenarioLayerState,
  updateLayerSetting,
} from "../layer-controller";

describe("scenario layer controller state", () => {
  beforeEach(() => localStorage.clear());

  it("keeps scenario state isolated, normalized, and durable", () => {
    let tohoku = defaultLayerState("tsunami");
    tohoku = updateLayerSetting(tohoku, "swe-field", { visible: false, opacity: 0.42 });
    tohoku = moveLayer(tohoku, "tsunami", "swe-field", -1);
    saveScenarioLayerState("preset:tohoku-2011", "tsunami", tohoku, localStorage, 10);

    const restored = loadScenarioLayerState("preset:tohoku-2011", "tsunami", localStorage);
    expect(restored["swe-field"]).toMatchObject({ visible: false, opacity: 0.42, order: 4 });
    expect(loadScenarioLayerState("preset:lisbon-1755", "tsunami", localStorage)["swe-field"])
      .toMatchObject({ visible: true, opacity: 0.9, order: 5 });
  });

  it("fails closed to defaults for malformed or out-of-range persisted input", () => {
    localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify({
      version: 1,
      scenarios: [{
        scenarioKey: "preset:test",
        domain: "tsunami",
        updatedAt: 1,
        layers: [
          { id: "swe-field", visible: true, opacity: 4, order: -100 },
          { id: "not-a-layer", visible: true, opacity: 1, order: 0 },
        ],
      }],
    }));

    const restored = loadScenarioLayerState("preset:test", "tsunami", localStorage);
    expect(restored["swe-field"].opacity).toBe(1);
    expect(restored["swe-field"].order).toBe(0);
    expect(restored.source.visible).toBe(true);
  });

  it("exports deterministic render order, visibility, and opacity metadata", () => {
    const state = updateLayerSetting(defaultLayerState("nuclear"), "fallout-plume", {
      visible: false,
      opacity: 0.55,
    });
    expect(layerExportRecords(state, "nuclear")).toEqual([
      { id: "fallout-plume", visible: false, opacityPct: 55, order: 0 },
      { id: "hazard-rings", visible: true, opacityPct: 100, order: 1 },
      { id: "source", visible: true, opacityPct: 100, order: 2 },
    ]);
  });

  it("uses stable bounded keys without storing custom scenario contents", () => {
    expect(buildLayerScenarioKey("tsunami", "tohoku-2011", {})).toBe("tsunami:id:tohoku-2011");
    expect(buildLayerScenarioKey("tsunami", null, { location: { lat: 38.3, lon: 142.4 } }))
      .toMatch(/^tsunami:custom:[0-9a-f]{8}$/);
  });
});
