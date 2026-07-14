import type {
  AsteroidImpactInput,
  CoastalPoint,
  EarthquakeInput,
  GeoPoint,
  GridSnapshot,
  InitialDisplacement,
  LandslideInput,
  NuclearBurstInput,
  Preset,
  PropagationSnapshot,
  RunPresetResponse,
  SimulateGridResponse,
} from "../types/scenario";
import { IDEALIZED_SEA_SURFACE_HEIGHT_FIELD } from "./geodesy";

export type DemoRunupAtPointResult = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  beach_slope_deg: number;
  offshore_depth_m: number;
  slope_provenance: CoastalPoint["slope_provenance"];
  depth_provenance: CoastalPoint["depth_provenance"];
  quantitative_confidence: "low" | "medium" | "high";
  quantitative_label: "illustrative" | "screening_estimate" | "quantitative";
  range_m: number;
  offshore_amplitude_m: number;
  runup_m: number;
  arrival_time_s: number;
  has_arrived: boolean;
  inundation_extent_m: number;
};

export type DemoInspectAtPointResult = {
  range_m: number;
  offshore_amplitude_m: number;
  runup_m: number;
  arrival_time_s: number;
  has_arrived: boolean;
  inundation_extent_m: number;
};

const TNT_J_PER_KT = 4.184e12;
const G = 9.81;

const DEMO_PRESETS: Preset[] = [
  {
    id: "chicxulub",
    name: "Chicxulub Impact",
    date: "66 Ma",
    blurb: "14-km asteroid into a shallow Yucatan sea. End-Cretaceous extinction event.",
    reference: "Range et al. 2022, AGU Advances, doi:10.1029/2021AV000627",
    reference_url: "https://doi.org/10.1029/2021AV000627",
    camera_view: { heading_deg: 0, pitch_deg: -55, range_m: 5_000_000 },
    source: {
      kind: "Asteroid",
      source: {
        diameter_m: 14_000,
        density_kg_m3: 3000,
        velocity_m_s: 20_000,
        angle_deg: 60,
        water_depth_m: 1500,
        location: { lat_deg: 21.4, lon_deg: -89.5, depth_m: 1500 },
      },
    },
  },
  {
    id: "eltanin",
    name: "Eltanin Impact",
    date: "2.51 Ma",
    blurb: "~1 km asteroid into the deep South Pacific.",
    reference: "Gersonde et al. 1997, Nature 390:357; Ward & Asphaug 2002",
    reference_url: "https://www.nature.com/articles/37044",
    camera_view: { heading_deg: 0, pitch_deg: -60, range_m: 6_000_000 },
    source: {
      kind: "Asteroid",
      source: {
        diameter_m: 1000,
        density_kg_m3: 3000,
        velocity_m_s: 20_000,
        angle_deg: 45,
        water_depth_m: 4500,
        location: { lat_deg: -57.7, lon_deg: -90.8, depth_m: 4500 },
      },
    },
  },
  {
    id: "tohoku_2011",
    name: "Tohoku Earthquake & Tsunami",
    date: "2011-03-11",
    blurb: "M_w 9.1 megathrust off Sanriku coast. 40 m maximum runup at Miyako.",
    reference: "Mori et al. 2011, GRL; Fujii & Satake 2013",
    reference_url: "https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2011GL049210",
    camera_view: { heading_deg: 345, pitch_deg: -72, range_m: 4_800_000 },
    source: {
      kind: "Earthquake",
      source: {
        mw: 9.1,
        depth_m: 30_000,
        strike_deg: 195,
        dip_deg: 12,
        rake_deg: 85,
        slip_m: 30,
        fault_length_m: 500_000,
        fault_width_m: 200_000,
        water_depth_m: 1500,
        location: { lat_deg: 38.297, lon_deg: 142.372, depth_m: 1500 },
      },
    },
  },
  {
    id: "indian_ocean_2004",
    name: "Indian Ocean Earthquake & Tsunami",
    date: "2004-12-26",
    blurb: "M_w 9.2 Sumatra-Andaman megathrust. 30 m runup across the Indian Ocean.",
    reference: "Synolakis et al. 2005, PNAS; Lay et al. 2005 Science",
    reference_url: "https://www.science.org/doi/10.1126/science.1112250",
    camera_view: { heading_deg: 330, pitch_deg: -40, range_m: 3_000_000 },
    source: {
      kind: "Earthquake",
      source: {
        mw: 9.2,
        depth_m: 30_000,
        strike_deg: 329,
        dip_deg: 8,
        rake_deg: 110,
        slip_m: 20,
        fault_length_m: 1_300_000,
        fault_width_m: 200_000,
        water_depth_m: 3500,
        location: { lat_deg: 3.316, lon_deg: 95.854, depth_m: 3500 },
      },
    },
  },
  {
    id: "lituya_bay_1958",
    name: "Lituya Bay Megatsunami",
    date: "1958-07-09",
    blurb: "30 M m³ rockslide into Gilbert Inlet. World-record 524 m runup.",
    reference: "Fritz, Hager & Minor 2001, Sci. Tsunami Hazards 19:3",
    reference_url: "http://library.lanl.gov/tsunami/ts193.pdf",
    camera_view: { heading_deg: 60, pitch_deg: -30, range_m: 50_000 },
    source: {
      kind: "Landslide",
      source: {
        kind: "Subaerial",
        volume_m3: 30_000_000,
        density_kg_m3: 2600,
        drop_height_m: 900,
        slope_deg: 40,
        water_depth_m: 120,
        water_body_width_m: 1300,
        location: { lat_deg: 58.637, lon_deg: -137.57, depth_m: 120 },
      },
    },
  },
  {
    id: "krakatoa_1883",
    name: "Krakatoa Caldera Collapse",
    date: "1883-08-27",
    blurb: "VEI 6 eruption and caldera collapse in the Sunda Strait.",
    reference: "Choi et al. 2003; Maeno & Imamura 2011",
    reference_url: "http://www.tsunamisociety.org/213choi.pdf",
    camera_view: { heading_deg: 0, pitch_deg: -45, range_m: 1_500_000 },
    source: {
      kind: "Landslide",
      source: {
        kind: "Submarine",
        volume_m3: 1.2e10,
        density_kg_m3: 2500,
        drop_height_m: 400,
        slope_deg: 30,
        water_depth_m: 250,
        water_body_width_m: 8000,
        location: { lat_deg: -6.102, lon_deg: 105.423, depth_m: 250 },
      },
    },
  },
  {
    id: "storegga",
    name: "Storegga Submarine Slide",
    date: "~8150 BP",
    blurb: "3000 km³ submarine landslide off Norway; 20+ m tsunami in Scotland.",
    reference: "Bondevik et al. 2005; Kim et al. 2019",
    reference_url: "https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2018JC014893",
    camera_view: { heading_deg: 220, pitch_deg: -50, range_m: 3_000_000 },
    source: {
      kind: "Landslide",
      source: {
        kind: "Submarine",
        volume_m3: 3e12,
        density_kg_m3: 1800,
        drop_height_m: 800,
        slope_deg: 3,
        water_depth_m: 1000,
        water_body_width_m: 300_000,
        location: { lat_deg: 64.5, lon_deg: 3.5, depth_m: 1000 },
      },
    },
  },
  {
    id: "hunga_tonga_2022",
    name: "Hunga Tonga Volcanic Tsunami",
    date: "2022-01-15",
    blurb: "Submarine volcanic tsunami plus atmospheric Lamb-wave coupling.",
    reference: "Carvajal et al. 2022; Matoza et al. 2022",
    reference_url: "https://www.science.org/doi/10.1126/science.abo4364",
    controversy_note:
      "Atmospheric Lamb-wave coupling is modelled as an optional IC injection in the Wave propagation panel.",
    camera_view: { heading_deg: 0, pitch_deg: -50, range_m: 2_500_000 },
    source: {
      kind: "Landslide",
      source: {
        kind: "Submarine",
        volume_m3: 1.9e10,
        density_kg_m3: 2200,
        drop_height_m: 700,
        slope_deg: 35,
        water_depth_m: 1500,
        water_body_width_m: 5000,
        location: { lat_deg: -20.55, lon_deg: -175.39, depth_m: 1500 },
      },
    },
  },
  {
    id: "cumbre_vieja_scenario",
    name: "Cumbre Vieja Flank Collapse (Hypothetical)",
    date: "-",
    blurb: "Contested Ward-Day 2001 flank-collapse scenario for La Palma.",
    reference: "Ward & Day 2001; Lovholt et al. 2008",
    reference_url: "https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2001GL013110",
    is_speculative: true,
    controversy_note: "Disputed worst case; later dispersive models are far lower.",
    camera_view: { heading_deg: 270, pitch_deg: -55, range_m: 5_500_000 },
    source: {
      kind: "Landslide",
      source: {
        kind: "Submarine",
        volume_m3: 5e11,
        density_kg_m3: 2700,
        drop_height_m: 4000,
        slope_deg: 20,
        water_depth_m: 2500,
        water_body_width_m: 30_000,
        location: { lat_deg: 28.57, lon_deg: -17.87, depth_m: 0 },
      },
    },
  },
  {
    id: "poseidon_realistic",
    name: "Poseidon Torpedo (Realistic Yield)",
    date: "-",
    blurb: "Conservative 2-Mt underwater detonation: meters, not 500 m.",
    reference: "Hambling 2022; DNA-TR-96-77; Glasstone & Dolan 1977",
    reference_url:
      "https://www.forbes.com/sites/davidhambling/2022/05/04/russias-poseidon-2km-tsunami-apocalypse-weapon-just-propaganda/",
    is_speculative: true,
    controversy_note: "Hypothetical weapon system; yield estimate, not historical event.",
    camera_view: { heading_deg: 0, pitch_deg: -40, range_m: 1_000_000 },
    source: {
      kind: "Nuclear",
      source: {
        yield_kt: 2000,
        burst_mode: "DeepOptimal",
        burst_depth_m: 300,
        water_depth_m: 4000,
        location: { lat_deg: 50, lon_deg: -10, depth_m: 4000 },
      },
    },
  },
  {
    id: "poseidon_propaganda",
    name: "Poseidon Torpedo (Russian Claim - Exaggerated)",
    date: "-",
    blurb: "100-Mt propaganda-grade claim shown beside the realistic mode.",
    reference: "Russian state TV 2022; Hambling 2022; Glasstone & Dolan 1977",
    reference_url:
      "https://www.forbes.com/sites/davidhambling/2022/05/04/russias-poseidon-2km-tsunami-apocalypse-weapon-just-propaganda/",
    is_speculative: true,
    controversy_note: "Propaganda-grade yield; Western analysts call the 100-Mt claim unrealistic.",
    camera_view: { heading_deg: 0, pitch_deg: -40, range_m: 1_000_000 },
    source: {
      kind: "Nuclear",
      source: {
        yield_kt: 100_000,
        burst_mode: "DeepOptimal",
        burst_depth_m: 600,
        water_depth_m: 4000,
        location: { lat_deg: 50, lon_deg: -10, depth_m: 4000 },
      },
    },
  },
];

const DEMO_METRICS: Record<
  string,
  Omit<InitialDisplacement, "center" | "label" | "camera_view">
> = {
  chicxulub: {
    cavity_radius_m: 50_000,
    peak_amplitude_m: 4500,
    source_energy_j: 4.2e23,
    seismic_mw_equivalent: 12.4,
    dominant_wavelength_m: 220_000,
  },
  eltanin: {
    cavity_radius_m: 4500,
    peak_amplitude_m: 240,
    source_energy_j: 1.2e20,
    seismic_mw_equivalent: 10.3,
    dominant_wavelength_m: 38_000,
  },
  tohoku_2011: {
    cavity_radius_m: 120_000,
    peak_amplitude_m: 8.2,
    source_energy_j: 2.0e18,
    seismic_mw_equivalent: 9.1,
    dominant_wavelength_m: 260_000,
  },
  indian_ocean_2004: {
    cavity_radius_m: 180_000,
    peak_amplitude_m: 6.8,
    source_energy_j: 2.8e18,
    seismic_mw_equivalent: 9.2,
    dominant_wavelength_m: 350_000,
  },
  lituya_bay_1958: {
    cavity_radius_m: 900,
    peak_amplitude_m: 172,
    source_energy_j: 6.9e17,
    seismic_mw_equivalent: 8.7,
    dominant_wavelength_m: 2600,
  },
  krakatoa_1883: {
    cavity_radius_m: 4200,
    peak_amplitude_m: 42,
    source_energy_j: 1.0e17,
    seismic_mw_equivalent: 8.1,
    dominant_wavelength_m: 14_000,
  },
  storegga: {
    cavity_radius_m: 140_000,
    peak_amplitude_m: 26,
    source_energy_j: 4.2e18,
    seismic_mw_equivalent: 9.3,
    dominant_wavelength_m: 300_000,
  },
  hunga_tonga_2022: {
    cavity_radius_m: 3800,
    peak_amplitude_m: 15,
    source_energy_j: 1.3e17,
    seismic_mw_equivalent: 8.3,
    dominant_wavelength_m: 18_000,
  },
  cumbre_vieja_scenario: {
    cavity_radius_m: 68_000,
    peak_amplitude_m: 120,
    source_energy_j: 5.3e18,
    seismic_mw_equivalent: 9.3,
    dominant_wavelength_m: 180_000,
  },
  poseidon_realistic: {
    cavity_radius_m: 1800,
    peak_amplitude_m: 18,
    source_energy_j: 8.4e15,
    seismic_mw_equivalent: 7.2,
    dominant_wavelength_m: 9000,
  },
  poseidon_propaganda: {
    cavity_radius_m: 13_000,
    peak_amplitude_m: 90,
    source_energy_j: 4.2e17,
    seismic_mw_equivalent: 8.6,
    dominant_wavelength_m: 42_000,
  },
};

export function listDemoPresets(): Preset[] {
  return DEMO_PRESETS.map((p) => ({ ...p }));
}

export function runDemoPreset(presetId: string, timeS: number): RunPresetResponse {
  const preset = DEMO_PRESETS.find((p) => p.id === presetId) ?? DEMO_PRESETS[0];
  const initial = initialForPreset(preset);
  return {
    preset,
    initial,
    wavefront: makeDemoWavefront(initial, timeS, preset.source.kind === "Asteroid"),
  };
}

export function demoInitialForScenario(
  input:
    | { kind: "Asteroid"; source: AsteroidImpactInput }
    | { kind: "Nuclear"; source: NuclearBurstInput }
    | { kind: "Earthquake"; source: EarthquakeInput }
    | { kind: "Landslide"; source: LandslideInput },
): InitialDisplacement {
  if (input.kind === "Asteroid") return asteroidInitial(input.source);
  if (input.kind === "Nuclear") return nuclearInitial(input.source);
  if (input.kind === "Earthquake") return earthquakeInitial(input.source);
  return landslideInitial(input.source);
}

export function simulateDemoGrid(
  initial: InitialDisplacement,
  opts: {
    boxHalfSizeDeg?: number;
    nSnapshots?: number;
    tEndS?: number;
    includeLambWave?: boolean;
  } = {},
): SimulateGridResponse {
  const nSnapshots = opts.nSnapshots ?? 24;
  const tEndS = opts.tEndS ?? 3600;
  const box = opts.boxHalfSizeDeg ?? Math.min(18, Math.max(2, initial.cavity_radius_m / 18_000));
  return {
    snapshots: Array.from({ length: nSnapshots }, (_, i) => {
      const time_s = nSnapshots <= 1 ? 0 : (tEndS * i) / (nSnapshots - 1);
      return makeDemoSnapshot(initial, time_s, box, opts.includeLambWave === true);
    }),
    dt_s: 5,
    nx: 128,
    ny: 128,
    used_gpu: false,
    run_quality: {
      status: "pass",
      finite_fields: true,
      minimum_total_depth_m: 0,
      cfl_number: 0,
      cfl_margin: 1,
      accepted_steps: nSnapshots - 1,
      rejected_steps: 0,
      mass_drift_pct: 0,
      energy_drift_pct: 0,
      sponge_width_cells: 0,
      warnings: ["Browser preview uses illustrative fields; desktop Rust runs publish numerical-integrity metrics."],
      failure: null,
    },
  };
}

export function demoRunupAtPoints(req: {
  source: GeoPoint;
  initial_amplitude_m: number;
  cavity_radius_m: number;
  is_impact: boolean;
  mean_depth_m: number;
  time_s: number;
  points: CoastalPoint[];
}): DemoRunupAtPointResult[] {
  const c = Math.sqrt(G * Math.max(req.mean_depth_m, 50));
  const alpha = req.is_impact ? 5 / 6 : 0.5;
  return req.points.map((p) => {
    const range_m = Math.max(1, haversineM(req.source.lat_deg, req.source.lon_deg, p.lat, p.lon));
    const arrival_time_s = range_m / c;
    const attenuation = Math.pow(Math.max(req.cavity_radius_m, 1000) / range_m, alpha);
    const offshore = Math.max(0, req.initial_amplitude_m * attenuation * 0.32);
    const slope = Math.max(0.001, Math.tan((p.beach_slope_deg * Math.PI) / 180));
    const runup_m = Math.min(750, offshore * (offshore > 25 ? 1.4 : 2.6));
    return {
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      beach_slope_deg: p.beach_slope_deg,
      offshore_depth_m: p.offshore_depth_m,
      slope_provenance: p.slope_provenance,
      depth_provenance: p.depth_provenance,
      quantitative_confidence:
        p.slope_provenance.confidence === "low" || p.depth_provenance.confidence === "low"
          ? "low"
          : p.slope_provenance.confidence === "medium" || p.depth_provenance.confidence === "medium"
            ? "medium"
            : "high",
      quantitative_label:
        p.slope_provenance.placeholder || p.depth_provenance.placeholder
          ? "illustrative"
          : p.slope_provenance.confidence === "high" && p.depth_provenance.confidence === "high"
            ? "quantitative"
            : "screening_estimate",
      range_m,
      offshore_amplitude_m: offshore,
      runup_m,
      arrival_time_s,
      has_arrived: req.time_s >= arrival_time_s,
      inundation_extent_m: Math.min(60_000, runup_m / slope),
    };
  });
}

/** Browser-preview approximation of the Rust `attenuation_curve` command.
 *  Same shape (metres in, metres out); desktop builds never call this. */
export function demoAttenuationCurve(
  initialAmplitudeM: number,
  cavityRadiusM: number,
  decayAlpha: number,
  maxRangeM: number,
  nSamples: number,
): Array<{ range_m: number; amplitude_m: number }> {
  const startRangeM = Math.max(cavityRadiusM, 1000);
  const samples: Array<{ range_m: number; amplitude_m: number }> = [];
  for (let i = 0; i < nSamples; i++) {
    const frac = i / (nSamples - 1);
    const range_m = startRangeM + frac * (maxRangeM - startRangeM);
    const amplitude_m =
      range_m <= cavityRadiusM
        ? initialAmplitudeM
        : initialAmplitudeM * Math.pow(cavityRadiusM / range_m, decayAlpha);
    samples.push({ range_m, amplitude_m });
  }
  return samples;
}

export function sampleGaugesFromDemo(
  initial: InitialDisplacement,
  gauges: import("../types/scenario").Gauge[],
  nSnapshots: number,
  tEndS: number,
): import("../types/scenario").GaugeTimeSeries[] {
  const isImpact = true;
  const depth = initial.center.depth_m ?? 4000;
  const c = Math.sqrt(G * Math.max(depth, 50));
  const alpha = isImpact ? 5 / 6 : 0.5;

  return gauges.map((gauge) => {
    const range_m = Math.max(1, haversineM(
      initial.center.lat_deg,
      initial.center.lon_deg,
      gauge.lat_deg,
      gauge.lon_deg,
    ));
    const attenuation = Math.pow(
      Math.max(initial.cavity_radius_m, 1000) / range_m,
      alpha,
    );
    const arrivalS = range_m / c;
    const samples: import("../types/scenario").GaugeSample[] = [];
    for (let i = 0; i < nSnapshots; i++) {
      const time_s = nSnapshots <= 1 ? 0 : (tEndS * i) / (nSnapshots - 1);
      let eta_m = 0;
      if (time_s >= arrivalS) {
        const elapsed = time_s - arrivalS;
        const decay = Math.exp(-elapsed / (tEndS * 0.4));
        eta_m = initial.peak_amplitude_m * attenuation * 0.32 * decay;
      }
      samples.push({ time_s, eta_m });
    }
    return { gauge, samples };
  });
}

export function demoInspectAtPoint(req: {
  source: GeoPoint;
  initial_amplitude_m: number;
  cavity_radius_m: number;
  is_impact: boolean;
  mean_depth_m: number;
  time_s: number;
  click_lat: number;
  click_lon: number;
  beach_slope_deg: number;
  offshore_depth_m: number;
}): DemoInspectAtPointResult {
  const range_m = Math.max(1, haversineM(req.source.lat_deg, req.source.lon_deg, req.click_lat, req.click_lon));
  const c = Math.sqrt(G * Math.max(req.mean_depth_m, 50));
  const alpha = req.is_impact ? 5 / 6 : 0.5;
  const attenuation = Math.pow(Math.max(req.cavity_radius_m, 1000) / range_m, alpha);
  const offshore = Math.max(0, req.initial_amplitude_m * attenuation * 0.32);
  const slope = Math.max(0.001, Math.tan((req.beach_slope_deg * Math.PI) / 180));
  const runup_m = Math.min(750, offshore * (offshore > 25 ? 1.4 : 2.6));
  const arrival_time_s = range_m / c;
  return {
    range_m,
    offshore_amplitude_m: offshore,
    runup_m,
    arrival_time_s,
    has_arrived: req.time_s >= arrival_time_s,
    inundation_extent_m: Math.min(60_000, runup_m / slope),
  };
}

function initialForPreset(preset: Preset): InitialDisplacement {
  const metrics = DEMO_METRICS[preset.id] ?? DEMO_METRICS.chicxulub;
  const sourceGeometry = (() => {
    switch (preset.source.kind) {
      case "Asteroid": return asteroidInitial(preset.source.source).source_geometry;
      case "Nuclear": return nuclearInitial(preset.source.source).source_geometry;
      case "Earthquake": return earthquakeInitial(preset.source.source).source_geometry;
      case "Landslide": return landslideInitial(preset.source.source).source_geometry;
    }
  })();
  return {
    ...metrics,
    center: sourceLocation(preset),
    label: preset.name,
    camera_view: preset.camera_view,
    source_geometry: sourceGeometry,
  };
}

function sourceLocation(preset: Preset): GeoPoint {
  return preset.source.source.location;
}

function asteroidInitial(input: AsteroidImpactInput): InitialDisplacement {
  const radius = Math.max(1000, input.diameter_m * 3.5);
  const mass = (Math.PI / 6) * input.density_kg_m3 * input.diameter_m ** 3;
  const energy = 0.5 * mass * input.velocity_m_s ** 2;
  const angle = Math.max(0.1, Math.sin((input.angle_deg * Math.PI) / 180));
  return {
    center: input.location,
    cavity_radius_m: radius,
    peak_amplitude_m: Math.min(5000, Math.max(1, input.diameter_m * 0.32 * angle)),
    source_energy_j: energy,
    seismic_mw_equivalent: energyToMw(energy),
    dominant_wavelength_m: radius * 4.4,
    label: "Custom asteroid impact",
    source_geometry: {
      kind: "cavity_ring",
      rim_radius_m: radius,
      rim_width_m: Math.max(1, radius * 0.2),
    },
  };
}

function nuclearInitial(input: NuclearBurstInput): InitialDisplacement {
  const energy = input.yield_kt * TNT_J_PER_KT;
  const yieldSqrt = Math.sqrt(Math.max(input.yield_kt, 0.001));
  const radius = Math.max(600, yieldSqrt * 190);
  return {
    center: input.location,
    cavity_radius_m: radius,
    peak_amplitude_m: Math.max(0.2, yieldSqrt * 0.55),
    source_energy_j: energy,
    seismic_mw_equivalent: energyToMw(energy),
    dominant_wavelength_m: Math.max(1800, yieldSqrt * 900),
    label: "Custom nuclear source",
    source_geometry: {
      kind: "cavity_ring",
      rim_radius_m: radius,
      rim_width_m: Math.max(1, radius * 0.2),
    },
  };
}

function earthquakeInitial(input: EarthquakeInput): InitialDisplacement {
  const energy = 10 ** (1.5 * input.mw + 4.8);
  const length = input.fault_length_m && input.fault_length_m > 0 ? input.fault_length_m : 10 ** (-2.44 + 0.59 * input.mw) * 1000;
  const width = input.fault_width_m && input.fault_width_m > 0 ? input.fault_width_m : 10 ** (0.32 * input.mw - 1.01) * 1000;
  return {
    center: input.location,
    cavity_radius_m: Math.max(20_000, length * 0.28),
    peak_amplitude_m: Math.max(0.2, Math.min(16, input.slip_m * Math.sin((input.dip_deg * Math.PI) / 180) * 0.45)),
    source_energy_j: energy,
    seismic_mw_equivalent: input.mw,
    dominant_wavelength_m: Math.max(60_000, length * 0.55),
    label: "Custom earthquake source",
    source_geometry: input.slip_m > 0 ? {
      kind: "okada",
      fault: {
        center_lat: input.location.lat_deg,
        center_lon: input.location.lon_deg,
        depth_m: input.depth_m,
        length_m: length,
        width_m: width,
        strike_deg: input.strike_deg,
        dip_deg: input.dip_deg,
        rake_deg: input.rake_deg,
        slip_m: input.slip_m,
      },
    } : null,
  };
}

function landslideInitial(input: LandslideInput): InitialDisplacement {
  const energy = input.volume_m3 * input.density_kg_m3 * G * Math.max(input.drop_height_m, 1);
  const scale = Math.cbrt(Math.max(input.volume_m3, 1));
  const radius = Math.max(500, scale * 2.2);
  return {
    center: input.location,
    cavity_radius_m: radius,
    peak_amplitude_m: Math.max(0.5, Math.min(350, scale * Math.sin((input.slope_deg * Math.PI) / 180) * 0.09)),
    source_energy_j: energy,
    seismic_mw_equivalent: energyToMw(energy),
    dominant_wavelength_m: Math.max(1200, input.water_body_width_m),
    label: "Custom landslide source",
    source_geometry: {
      kind: "landslide",
      axis_azimuth_deg: 0,
      longitudinal_sigma_m: radius,
      transverse_sigma_m: Math.max(1, Math.min(radius, input.water_body_width_m * 0.5)),
    },
  };
}

function makeDemoWavefront(
  initial: InitialDisplacement,
  timeS: number,
  isImpact: boolean,
): PropagationSnapshot {
  const depth = Math.max(initial.center.depth_m ?? 4000, 50);
  const c = Math.sqrt(G * depth);
  const maxRange = Math.max(initial.cavity_radius_m * 1.5, c * Math.max(timeS, 60));
  const alpha = isImpact ? 5 / 6 : 0.5;
  const ranges_m: number[] = [];
  const amplitudes_m: number[] = [];
  for (let i = 0; i < 48; i += 1) {
    const t = (i + 1) / 48;
    const r = maxRange * t;
    const envelope = Math.exp(-((t - 0.82) ** 2) / 0.045);
    ranges_m.push(r);
    amplitudes_m.push(
      initial.peak_amplitude_m *
        Math.pow(Math.max(initial.cavity_radius_m, 1000) / Math.max(r, 1000), alpha) *
        envelope,
    );
  }
  return { time_s: timeS, ranges_m, amplitudes_m };
}

function makeDemoSnapshot(
  initial: InitialDisplacement,
  timeS: number,
  boxHalfSizeDeg: number,
  includeLambWave: boolean,
): GridSnapshot {
  const nx = 128;
  const ny = 128;
  const canvas = document.createElement("canvas");
  canvas.width = nx;
  canvas.height = ny;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const img = ctx.createImageData(nx, ny);
  const progress = Math.max(0.05, timeS / 3600);
  const ring = Math.min(0.78, 0.08 + progress * 0.68);
  const amp = Math.max(1, Math.min(160, initial.peak_amplitude_m));
  let etaMin = Infinity;
  let etaMax = -Infinity;

  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const dx = (x + 0.5) / nx - 0.5;
      const dy = (y + 0.5) / ny - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const crest = Math.exp(-((r - ring) ** 2) / 0.0016);
      const trough = Math.exp(-((r - ring * 0.76) ** 2) / 0.0022);
      const lamb = includeLambWave ? Math.exp(-((r - ring * 1.12) ** 2) / 0.004) * 0.28 : 0;
      const eta = amp * (crest - trough * 0.42 + lamb) * (1 - r * 0.35);
      etaMin = Math.min(etaMin, eta);
      etaMax = Math.max(etaMax, eta);
      const px = (y * nx + x) * 4;
      const opacity = Math.min(230, Math.max(0, Math.abs(eta) / amp * 255));
      if (eta >= 0) {
        img.data[px] = 243;
        img.data[px + 1] = 139;
        img.data[px + 2] = 168;
      } else {
        img.data[px] = 116;
        img.data[px + 1] = 199;
        img.data[px + 2] = 236;
      }
      img.data[px + 3] = opacity;
    }
  }

  ctx.putImageData(img, 0, 0);
  const etaAbsMax = Math.max(Math.abs(etaMin), Math.abs(etaMax));
  return {
    time_s: timeS,
    bbox: [
      initial.center.lon_deg - boxHalfSizeDeg,
      initial.center.lat_deg - boxHalfSizeDeg,
      initial.center.lon_deg + boxHalfSizeDeg,
      initial.center.lat_deg + boxHalfSizeDeg,
    ],
    nx,
    ny,
    height_field: { ...IDEALIZED_SEA_SURFACE_HEIGHT_FIELD },
    eta_min_m: etaMin,
    eta_max_m: etaMax,
    eta_abs_max_m: etaAbsMax,
    eta_png_b64: canvas.toDataURL("image/png").split(",", 2)[1] ?? "",
  };
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6_371_000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function energyToMw(energyJ: number): number {
  return Number.isFinite(energyJ) && energyJ > 0
    ? (Math.log10(energyJ) - 4.8) / 1.5
    : 0;
}
