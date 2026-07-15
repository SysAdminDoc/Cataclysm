import { describe, expect, it } from "vitest";
import type { HazardResult } from "../../hazards";
import type { InitialDisplacement, Preset } from "../../types/scenario";
import {
  buildDirectResultEvidence,
  buildLayerEvidence,
  buildOutcomeEvidence,
  buildSourceEvidence,
  evidenceIds,
} from "../trust-evidence";

const initial: InitialDisplacement = {
  center: { lat_deg: 38.3, lon_deg: 142.37, depth_m: 1_500 },
  cavity_radius_m: 1_000,
  peak_amplitude_m: 40,
  source_energy_j: 1e18,
  seismic_mw_equivalent: 9.1,
  label: "Tōhoku",
};

const preset: Preset = {
  id: "tohoku",
  name: "Tōhoku 2011",
  date: "2011-03-11",
  blurb: "Reference earthquake",
  reference: "Okada 1985; Mori et al. 2011",
  reference_url: "https://doi.org/10.1029/2021AV000627",
  source: {
    kind: "Earthquake",
    source: {
      mw: 9.1,
      depth_m: 1_500,
      strike_deg: 193,
      dip_deg: 14,
      rake_deg: 81,
      slip_m: 20,
      water_depth_m: 1_500,
      location: initial.center,
    },
  },
};

const directResult = {
  kind: "asteroid",
  authority: "rust",
  modelVersion: "asteroid-direct-1.0.0",
  center: { lat: 0, lon: 0 },
  rings: [],
  readout: [],
  detail: {},
} as unknown as HazardResult;

describe("trust evidence", () => {
  it("keeps historical and speculative source confidence visibly distinct", () => {
    const historical = buildSourceEvidence(preset, initial);
    const speculative = buildSourceEvidence({ ...preset, id: "what-if", is_speculative: true }, initial);

    expect(historical).toMatchObject({ id: "scenario:preset:tohoku", tone: "reference", confidence: "Historical/reference scenario" });
    expect(historical.citations).toEqual([{ label: preset.reference, url: preset.reference_url }]);
    expect(speculative).toMatchObject({ id: "scenario:preset:what-if", tone: "speculative", confidence: "Exploratory what-if" });
  });

  it("binds outcome and layer evidence to stable scenario identifiers", () => {
    expect(buildOutcomeEvidence(preset, initial, "Earthquake").id).toBe("result:preset:tohoku:outcome");
    expect(buildLayerEvidence("swe-field", preset, initial, "Earthquake")).toMatchObject({
      id: "layer:preset:tohoku:swe-field",
      confidence: "Numerically checked output",
    });
  });

  it("uses the Rust response model version for direct-result claims", () => {
    expect(buildDirectResultEvidence(directResult)).toMatchObject({
      id: "result:direct:asteroid:asteroid-direct-1.0.0",
      model: "Rust-authoritative direct-hazard engine",
      version: "asteroid-direct-1.0.0",
    });
  });

  it("describes waiting direct layers without pretending a result exists", () => {
    expect(buildLayerEvidence("hazard-rings", null, null, null, null, "nuclear")).toMatchObject({
      id: "layer:direct:nuclear:pending:hazard-rings",
      confidence: "Waiting for a versioned result",
    });
  });

  it("deduplicates and sorts identifiers for deterministic exports", () => {
    const source = buildSourceEvidence(preset, initial);
    const result = buildOutcomeEvidence(preset, initial, "Earthquake");
    expect(evidenceIds([result, source, source])).toEqual([result.id, source.id].sort());
  });
});
