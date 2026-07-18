import { describe, expect, it } from "vitest";
import type { Preset } from "../../types/scenario";
import { DIRECT_SCENARIOS } from "../scenario-library";
import {
  buildScenarioCatalog,
  deterministicSurprise,
  isCompleteCitedScenario,
  SCENARIO_PACKS,
  scenarioMatchesPack,
} from "../scenario-presentation";

const PRESETS: Preset[] = [
  {
    id: "tohoku_2011",
    name: "Tohoku Earthquake & Tsunami",
    date: "2011-03-11",
    blurb: "Reference megathrust event.",
    reference: "USGS and NOAA",
    reference_url: "https://www.usgs.gov/",
    source: {
      kind: "Earthquake",
      source: {
        mw: 9.1,
        depth_m: 24_000,
        strike_deg: 193,
        dip_deg: 14,
        rake_deg: 81,
        slip_m: 20,
        water_depth_m: 4_000,
        location: { lat_deg: 38.3, lon_deg: 142.37 },
      },
    },
  },
  {
    id: "chicxulub",
    name: "Chicxulub Impact",
    date: "66 Ma",
    blurb: "Reference impact event.",
    reference: "Collins et al.",
    reference_url: "https://doi.org/10.1111/j.1365-246X.2005.02638.x",
    source: {
      kind: "Asteroid",
      source: {
        diameter_m: 14_000,
        density_kg_m3: 3_000,
        velocity_m_s: 20_000,
        angle_deg: 45,
        water_depth_m: 200,
        location: { lat_deg: 21.4, lon_deg: -89.5 },
      },
    },
  },
  {
    id: "poseidon_realistic",
    name: "Poseidon claim — physics-limited",
    date: "What-if",
    blurb: "A cited claim-check scenario.",
    reference: "Glasstone and Dolan",
    reference_url: "https://www.osti.gov/biblio/6852629",
    is_speculative: true,
    source: {
      kind: "Nuclear",
      source: {
        yield_kt: 100_000,
        burst_mode: "DeepOptimal",
        burst_depth_m: 500,
        water_depth_m: 4_000,
        location: { lat_deg: 40, lon_deg: -35 },
      },
    },
  },
];

describe("scenario presentation", () => {
  it("ships every named discovery pack with catalog membership", () => {
    const catalog = buildScenarioCatalog(PRESETS, DIRECT_SCENARIOS);
    expect(SCENARIO_PACKS.map((pack) => pack.id)).toEqual([
      "start-here",
      "asteroid-scale",
      "nuclear-scale",
      "ocean-disasters",
      "fact-check",
      "near-earth",
      "scenario-duels",
    ]);
    for (const pack of SCENARIO_PACKS) {
      expect(catalog.some((entry) => scenarioMatchesPack(entry, pack.id)), pack.id).toBe(true);
    }
  });

  it("adds the complete visual facts required by discovery cards", () => {
    const [entry] = buildScenarioCatalog(PRESETS, []);
    expect(entry.presentation).toMatchObject({
      hazard: "Tsunami",
      scale: "M_w 9.1",
      runtime: "60 min",
      confidence: "Cited reference",
    });
    expect(entry.presentation.promise).toMatch(/basin-scale wave/i);
    expect(entry.presentation.thumbnail.src).toMatch(/^\/scenario-thumbnails\/.+\.webp$/);
    expect(entry.presentation.thumbnail.limitation).toMatch(/not local realism/i);
  });

  it("only surprises from complete HTTP-cited entries in stable order", () => {
    const incomplete = { ...PRESETS[0], id: "missing-url", reference_url: null };
    const catalog = buildScenarioCatalog([incomplete, ...PRESETS], DIRECT_SCENARIOS);
    const eligible = catalog.filter(isCompleteCitedScenario);
    expect(eligible.some((entry) => entry.id === "preset:missing-url")).toBe(false);
    expect(deterministicSurprise(catalog, 0)?.id).toBe(deterministicSurprise([...catalog].reverse(), 0)?.id);
    expect(deterministicSurprise(catalog, eligible.length)?.id).toBe(deterministicSurprise(catalog, 0)?.id);
  });
});
