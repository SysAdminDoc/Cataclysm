import type {
  CoastalPoint,
  GeoPoint,
  GridSnapshot,
  InitialDisplacement,
  Preset,
  RunPresetResponse,
  SimulateGridResponse,
} from "../types/scenario";
import {
  browserAttenuation,
  browserInitial,
  browserInspect,
  browserRunup,
  browserWavefront,
  type BrowserSourceInput,
} from "./browser-physics";
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
  governing_model: string;
  citations: string[];
  assumptions: string[];
  confidence: "screening_estimate";
  unknowns: string[];
};

const G = 9.81;

const DEMO_PRESETS: Preset[] = [
  {
    id: "lake_superior_meteotsunami_2025",
    name: "Lake Superior Meteotsunami",
    date: "2025-06-21",
    blurb: "A west-to-east pressure disturbance over Lake Superior; NOAA GLERL measured a 19.3-inch meteotsunami rise at Point Iroquois.",
    reference: "NOAA GLERL, June 21 2025 Storm Causes Significant Meteotsunami and Seiche on Lake Superior (2025-07-18)",
    reference_url: "https://www.glerl.noaa.gov/blog/2025/07/18/june-21-2025-storm-causes-significant-meteotsunami-and-seiche-on-lake-superior/",
    is_speculative: true,
    controversy_note: "Educational pressure-only reconstruction: representative parameters, not a calibrated NOAA hindcast.",
    camera_view: { heading_deg: 90, pitch_deg: -60, range_m: 900_000 },
    source: {
      kind: "Meteotsunami",
      source: {
        peak_pressure_pa: 300,
        speed_m_s: 39,
        heading_deg: 90,
        along_track_sigma_m: 40_000,
        cross_track_sigma_m: 120_000,
        track_length_m: 560_000,
        water_depth_m: 155,
        location: { lat_deg: 47.1, lon_deg: -92.1, depth_m: 155 },
      },
    },
  },
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

export function listDemoPresets(): Preset[] {
  return DEMO_PRESETS.map((p) => ({ ...p }));
}

export async function runDemoPreset(presetId: string, timeS: number): Promise<RunPresetResponse> {
  const preset = DEMO_PRESETS.find((p) => p.id === presetId) ?? DEMO_PRESETS[0];
  const initial = await browserInitial(preset.source);
  initial.camera_view = preset.camera_view;
  const meanDepthM = Math.max(initial.center.depth_m ?? 0, 50);
  const wavefront = preset.source.kind === "Meteotsunami"
    ? { time_s: timeS, ranges_m: [], amplitudes_m: [] }
    : await browserWavefront({
        initial_amplitude_m: initial.peak_amplitude_m,
        cavity_radius_m: initial.cavity_radius_m,
        decay_alpha: preset.source.kind === "Asteroid" ? 5 / 6 : 0.5,
        mean_depth_m: meanDepthM,
        time_s: timeS,
        n_samples: 48,
      });
  return {
    preset,
    initial,
    wavefront,
  };
}

export function demoInitialForScenario(input: BrowserSourceInput): Promise<InitialDisplacement> {
  return browserInitial(input);
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
    run_id: "demo-browser",
    lifecycle: "completed",
    emitted_snapshots: nSnapshots,
    cancelled: false,
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
      warnings: ["Browser preview SWE fields remain illustrative; source and screening physics use Rust/WASM."],
      failure: null,
    },
  };
}

export async function demoRunupAtPoints(req: {
  source: GeoPoint;
  initial_amplitude_m: number;
  cavity_radius_m: number;
  is_impact: boolean;
  mean_depth_m: number;
  time_s: number;
  points: CoastalPoint[];
}): Promise<DemoRunupAtPointResult[]> {
  const screened = await browserRunup({
    ...req,
    points: req.points.map((point) => ({
      lat: point.lat,
      lon: point.lon,
      beach_slope_deg: point.beach_slope_deg,
      offshore_depth_m: point.offshore_depth_m,
    })),
  });
  return req.points.map((p, index) => {
    const result = screened[index];
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
      ...result,
    };
  });
}

/** Browser adapter for the shared Rust `attenuation_curve` implementation. */
export function demoAttenuationCurve(
  initialAmplitudeM: number,
  cavityRadiusM: number,
  decayAlpha: number,
  maxRangeM: number,
  nSamples: number,
): Promise<Array<{ range_m: number; amplitude_m: number }>> {
  return browserAttenuation({
    initial_amplitude_m: initialAmplitudeM,
    cavity_radius_m: cavityRadiusM,
    decay_alpha: decayAlpha,
    max_range_m: maxRangeM,
    n_samples: nSamples,
  });
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

export async function demoInspectAtPoint(req: {
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
}): Promise<DemoInspectAtPointResult> {
  const result = await browserInspect(req);
  return {
    ...result,
    governing_model: req.is_impact
      ? "impact-far-field + synolakis-runup"
      : "nuclear-far-field + synolakis-runup",
    citations: [
      req.is_impact
        ? "Ward & Asphaug (2000), Asteroid impact tsunami"
        : "Glasstone & Dolan (1977), The Effects of Nuclear Weapons",
      "Synolakis (1987), The runup of solitary waves",
    ],
    assumptions: [
      `Uniform mean ocean depth of ${req.mean_depth_m.toFixed(0)} m`,
      `Nominal ${req.beach_slope_deg.toFixed(1)}° beach slope and ${req.offshore_depth_m.toFixed(0)} m offshore depth`,
      "Radial far-field attenuation over a spherical-Earth distance",
    ],
    confidence: "screening_estimate",
    unknowns: [
      "Local bathymetry, shoreline geometry, reflection, and dispersion are not resolved",
      "An absent or small estimate is not an emergency-safety determination",
    ],
  };
}

type DemoFieldTileLayout = {
  column_offset: number;
  column_count: number;
  bbox: [number, number, number, number];
};

function alignDemoGridWest(west: number, nx: number, dlon: number): number {
  const width = nx * dlon;
  while (west + width <= -180) west += 360;
  while (west >= 180) west -= 360;
  const boundary = west < -180 ? -180 : west + width > 180 ? 180 : null;
  if (boundary !== null) {
    const columns = Math.max(1, Math.min(nx - 1, Math.round((boundary - west) / dlon)));
    west = boundary - columns * dlon;
  }
  return west;
}

function demoFieldTiles(
  west: number,
  south: number,
  nx: number,
  ny: number,
  dlon: number,
  dlat: number,
): DemoFieldTileLayout[] {
  const north = south + ny * dlat;
  const maximumColumns = Math.max(
    1,
    south === -90 || north === 90 || Math.max(Math.abs(south), Math.abs(north)) >= 60
      ? Math.floor(15 / dlon)
      : nx,
  );
  const normalize = (longitude: number, east: boolean) => {
    const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
    return east && Math.abs(wrapped + 180) <= 1e-9 ? 180 : wrapped;
  };
  const tiles: DemoFieldTileLayout[] = [];
  let columnOffset = 0;
  while (columnOffset < nx) {
    const unwrappedWest = west + columnOffset * dlon;
    const branchEast = 180 + Math.floor((unwrappedWest + 180) / 360) * 360;
    const columnsToDateline = Math.max(1, Math.round((branchEast - unwrappedWest) / dlon));
    const columnCount = Math.min(nx - columnOffset, maximumColumns, columnsToDateline);
    const unwrappedEast = unwrappedWest + columnCount * dlon;
    tiles.push({
      column_offset: columnOffset,
      column_count: columnCount,
      bbox: [normalize(unwrappedWest, false), south, normalize(unwrappedEast, true), north],
    });
    columnOffset += columnCount;
  }
  return tiles;
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
  const forcing = initial.meteotsunami_forcing;
  const amp = forcing
    ? Math.max(0.001, initial.peak_amplitude_m)
    : Math.max(1, Math.min(160, initial.peak_amplitude_m));
  let etaMin = Infinity;
  let etaMax = -Infinity;

  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const dx = (x + 0.5) / nx - 0.5;
      const dy = (y + 0.5) / ny - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      let eta: number;
      if (forcing) {
        const widthM = 2 * boxHalfSizeDeg * 111_320;
        const eastM = dx * widthM * Math.cos(initial.center.lat_deg * Math.PI / 180);
        const northM = -dy * widthM;
        const heading = forcing.heading_deg * Math.PI / 180;
        const travelledM = Math.min(forcing.track_length_m, forcing.speed_m_s * timeS);
        const alongM = eastM * Math.sin(heading) + northM * Math.cos(heading) - travelledM;
        const acrossM = eastM * Math.cos(heading) - northM * Math.sin(heading);
        const footprint = Math.exp(-0.5 * (
          (alongM / forcing.along_track_sigma_m) ** 2
          + (acrossM / forcing.cross_track_sigma_m) ** 2
        ));
        const wake = Math.exp(-0.5 * (
          ((alongM + 2.2 * forcing.along_track_sigma_m) / forcing.along_track_sigma_m) ** 2
          + (acrossM / forcing.cross_track_sigma_m) ** 2
        ));
        // Illustrative browser playback: inverted-barometer depression plus a
        // small trailing free-wave crest. The desktop uses the actual SWE
        // pressure-gradient source and remains the quantitative path.
        eta = amp * (-footprint + 0.65 * wake);
      } else {
        const crest = Math.exp(-((r - ring) ** 2) / 0.0016);
        const trough = Math.exp(-((r - ring * 0.76) ** 2) / 0.0022);
        const lamb = includeLambWave ? Math.exp(-((r - ring * 1.12) ** 2) / 0.004) * 0.28 : 0;
        eta = amp * (crest - trough * 0.42 + lamb) * (1 - r * 0.35);
      }
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
  const widthDeg = boxHalfSizeDeg * 2;
  const dlon = widthDeg / nx;
  const south = Math.max(-90, initial.center.lat_deg - boxHalfSizeDeg);
  const north = Math.min(90, initial.center.lat_deg + boxHalfSizeDeg);
  const dlat = (north - south) / ny;
  const west = alignDemoGridWest(initial.center.lon_deg - boxHalfSizeDeg, nx, dlon);
  const layouts = demoFieldTiles(west, south, nx, ny, dlon, dlat);
  const fieldTiles = layouts.length > 1 ? layouts.map((layout) => {
    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = layout.column_count;
    tileCanvas.height = ny;
    const tileContext = tileCanvas.getContext("2d");
    if (!tileContext) throw new Error("Canvas 2D context unavailable");
    tileContext.drawImage(
      canvas,
      layout.column_offset,
      0,
      layout.column_count,
      ny,
      0,
      0,
      layout.column_count,
      ny,
    );
    return {
      ...layout,
      eta_png_b64: tileCanvas.toDataURL("image/png").split(",", 2)[1] ?? "",
    };
  }) : undefined;
  return {
    time_s: timeS,
    bbox: [west, south, west + widthDeg, north],
    nx,
    ny,
    height_field: { ...IDEALIZED_SEA_SURFACE_HEIGHT_FIELD },
    eta_min_m: etaMin,
    eta_max_m: etaMax,
    eta_abs_max_m: etaAbsMax,
    eta_png_b64: canvas.toDataURL("image/png").split(",", 2)[1] ?? "",
    field_tiles: fieldTiles,
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
