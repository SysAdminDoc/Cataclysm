import type { AsteroidDetail, HazardResult } from "../hazards";
import type { DirectScenarioTemplate } from "./scenario-library";
import type { InitialDisplacement, Preset } from "../types/scenario";
import { APP_VERSION, DEFAULT_BATHYMETRY_SOURCE, EDUCATIONAL_LIMITATION } from "./model-provenance";

export type EvidenceTone = "reference" | "speculative" | "validated" | "limited";

export type TrustCitation = {
  label: string;
  url?: string | null;
};

export type TrustEvidence = {
  id: string;
  title: string;
  sourceTitle: string;
  model: string;
  version: string;
  confidence: string;
  tone: EvidenceTone;
  assumptions: string[];
  limitations: string[];
  citations: TrustCitation[];
};

export type EvidenceLayerId =
  | "source"
  | "analytical-wavefront"
  | "swe-field"
  | "maximum-field"
  | "arrival-isochrones"
  | "coastal-runup"
  | "humanitarian-facilities"
  | "usgs-official"
  | "dart-observations"
  | "hazard-rings"
  | "fallout-plume";

type ScenarioKind = Preset["source"]["kind"] | null;

const MODEL_VERSION = `Cataclysm v${APP_VERSION}`;

const SOURCE_MODELS: Record<NonNullable<ScenarioKind>, {
  model: string;
  assumptions: string[];
  citation: string;
}> = {
  Earthquake: {
    model: "Okada rectangular-fault dislocation",
    assumptions: ["Fault geometry and slip initialize vertical seafloor displacement.", "The initial sea surface follows the modelled seabed displacement."],
    citation: "Okada 1985, Bulletin of the Seismological Society of America 75:1135–1154",
  },
  Asteroid: {
    model: "Ward–Asphaug impact-cavity source",
    assumptions: ["A water impact creates a transient cavity whose collapse launches the initial wave.", "Far-field analytical attenuation uses the Ward–Asphaug 5/6 exponent."],
    citation: "Ward & Asphaug 2000, Icarus 145:64–78",
  },
  Nuclear: {
    model: "Glasstone–Dolan / Le Méhauté underwater source",
    assumptions: ["Only the modelled underwater coupling contributes to the initial water displacement.", "Burst mode, depth, yield, and water depth are treated as exact scenario inputs."],
    citation: "Glasstone & Dolan 1977; Le Méhauté & Wang 1996; DNA-TR-96-77",
  },
  Landslide: {
    model: "Fritz–Hager / Watts landslide source",
    assumptions: ["Slide volume, slope, density, and drop geometry control the initial impulse.", "Subaerial and submarine slides use distinct empirical source relations."],
    citation: "Fritz, Hager & Minor 2001; Heller & Hager 2010; Watts et al. 2005",
  },
  Meteotsunami: {
    model: "Translating Gaussian atmospheric-pressure forcing",
    assumptions: ["The pressure gradient is applied to depth-averaged momentum at every solver step.", "The source follows a straight, constant-speed finite track; wind stress and later seiche response are excluded."],
    citation: "NOAA NOS CO-OPS 079; Anarde et al. 2020, doi:10.1029/2020JC016347",
  },
};

function contextId(preset: Preset | null, initial?: InitialDisplacement | null): string {
  return preset ? `preset:${preset.id}` : `custom:${slug(initial?.label ?? "scenario")}`;
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "scenario";
}

function kindFromPreset(preset: Preset | null, kind?: ScenarioKind): ScenarioKind {
  return preset?.source.kind ?? kind ?? null;
}

function sourceModel(kind: ScenarioKind) {
  return kind ? SOURCE_MODELS[kind] : {
    model: "Cataclysm custom source model",
    assumptions: ["All source parameters are supplied by the user.", "No historical calibration is inferred for a custom source."],
    citation: "Custom scenario inputs; no preset citation",
  };
}

function presetCitation(preset: Preset | null, fallback: string): TrustCitation[] {
  return [{ label: preset?.reference ?? fallback, url: preset?.reference_url ?? null }];
}

export function buildSourceEvidence(
  preset: Preset | null,
  initial?: InitialDisplacement | null,
  kind?: ScenarioKind,
): TrustEvidence {
  const model = sourceModel(kindFromPreset(preset, kind));
  const speculative = Boolean(preset?.is_speculative) || !preset;
  return {
    id: `scenario:${contextId(preset, initial)}`,
    title: preset?.name ?? initial?.label ?? "Custom scenario",
    sourceTitle: preset?.reference ?? "User-defined source parameters",
    model: model.model,
    version: MODEL_VERSION,
    confidence: preset?.is_speculative ? "Exploratory what-if" : preset ? "Historical/reference scenario" : "User-defined inputs",
    tone: speculative ? "speculative" : "reference",
    assumptions: model.assumptions,
    limitations: [
      ...(preset?.controversy_note ? [preset.controversy_note] : []),
      EDUCATIONAL_LIMITATION,
    ],
    citations: presetCitation(preset, model.citation),
  };
}

export function buildDirectScenarioEvidence(scenario: DirectScenarioTemplate): TrustEvidence {
  const model = scenario.domain === "asteroid"
    ? "Rust direct asteroid-hazard model"
    : "Rust direct nuclear-hazard model";
  const recorded = scenario.classification === "recorded";
  return {
    id: `scenario:${scenario.id}`,
    title: scenario.name,
    sourceTitle: scenario.reference,
    model,
    version: "direct-hazard model 1.0.0",
    confidence: scenario.confidence,
    tone: recorded ? "reference" : "speculative",
    assumptions: recorded
      ? [
          "The historical event and source inputs are distinct from Cataclysm's modeled effect reconstruction.",
          scenario.historicalContext ?? "The listed location and source inputs preserve the historical preset.",
        ]
      : [
          "The deterministic reference fixture preserves the listed source inputs and camera.",
          "The scenario is a what-if study, not a prediction that the event will occur.",
        ],
    limitations: [
      ...(scenario.limitations ?? ["Reference-fixture confidence describes reproducibility, not event likelihood."]),
      EDUCATIONAL_LIMITATION,
    ],
    citations: [{ label: scenario.reference, url: scenario.referenceUrl }],
  };
}

export function buildOutcomeEvidence(
  preset: Preset | null,
  initial: InitialDisplacement | null,
  kind: ScenarioKind,
): TrustEvidence {
  const source = sourceModel(kindFromPreset(preset, kind));
  return {
    id: `result:${contextId(preset, initial)}:outcome`,
    title: `${preset?.name ?? initial?.label ?? "Custom scenario"} outcome`,
    sourceTitle: preset?.reference ?? source.citation,
    model: `${source.model} with analytical propagation and Synolakis coastal screening`,
    version: MODEL_VERSION,
    confidence: preset?.is_speculative ? "Exploratory estimate" : preset ? "Reference inputs; modelled outcome" : "User-input estimate",
    tone: preset?.is_speculative || !preset ? "speculative" : "limited",
    assumptions: [
      "Source inputs are propagated through a first-order depth-averaged tsunami model.",
      "Named-coast results use sampled offshore depth and beach-slope records.",
    ],
    limitations: [DEFAULT_BATHYMETRY_SOURCE, EDUCATIONAL_LIMITATION],
    citations: [
      ...presetCitation(preset, source.citation),
      { label: "Synolakis 1987, Journal of Fluid Mechanics 185:523–545" },
    ],
  };
}

export function buildDirectResultEvidence(result: HazardResult): TrustEvidence {
  const asteroid = result.kind === "asteroid";
  const baseCitations: TrustCitation[] = asteroid
    ? [
        {
          label: "Collins, Melosh & Marcus 2005, Earth Impact Effects Program",
          url: "https://doi.org/10.1111/j.1945-5100.2005.tb00157.x",
        },
        { label: "Schmidt & Holsapple 1982, gravity-scaling crater estimates" },
      ]
    : [
        { label: "Glasstone & Dolan 1977, The Effects of Nuclear Weapons" },
        { label: "BEIR VII risk model; UN World Population Prospects 2024" },
      ];
  const aftermath = asteroid ? (result.detail as AsteroidDetail).secondaryEffects : undefined;
  const citations = [...baseCitations];
  const seen = new Set(citations.map((citation) => `${citation.label}:${citation.url ?? ""}`));
  for (const citation of aftermath?.events.flatMap((event) => event.citations) ?? []) {
    const key = `${citation.label}:${citation.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(citation);
  }
  return {
    id: `result:direct:${result.kind}:${result.modelVersion}`,
    title: asteroid ? "Asteroid direct effects" : "Nuclear direct effects",
    sourceTitle: baseCitations.map((citation) => citation.label).join("; "),
    model: "Rust-authoritative direct-hazard engine",
    version: result.modelVersion,
    confidence: "Deterministic model output",
    tone: "limited",
    assumptions: asteroid
      ? ["Material, entry angle, speed, and target type are exact scenario inputs.", "Effect rings apply published scaling relations to an idealized target."]
      : ["Yield, burst mode, population density, and shielding factors are exact scenario inputs.", "Casualty bands assume a uniform population distribution."],
    limitations: [
      "Displayed casualty ranges are order-of-magnitude bands, not statistical confidence intervals.",
      ...(aftermath ? ["Long-term climate entries are cited qualitative scenarios, not energy-only forecasts or extinction probabilities."] : []),
      EDUCATIONAL_LIMITATION,
    ],
    citations,
  };
}

export function buildLayerEvidence(
  layer: EvidenceLayerId,
  preset: Preset | null,
  initial: InitialDisplacement | null,
  kind: ScenarioKind,
  directResult?: HazardResult | null,
  directDomain?: "asteroid" | "nuclear" | null,
): TrustEvidence {
  const direct = directResult?.kind === "asteroid" || directResult?.kind === "nuclear"
    ? directResult.kind
    : directDomain;
  const context = directResult
    ? `direct:${directResult.kind}:${directResult.modelVersion}`
    : direct
      ? `direct:${direct}:pending`
    : contextId(preset, initial);
  const source = sourceModel(kindFromPreset(preset, kind));
  const common = {
    id: `layer:${context}:${layer}`,
    version: directResult?.modelVersion ?? MODEL_VERSION,
    limitations: [EDUCATIONAL_LIMITATION],
  };
  switch (layer) {
    case "source":
      return {
        ...common,
        title: "Source geometry layer",
        sourceTitle: preset?.reference ?? (direct ? "Rust direct-hazard request/response contract" : source.citation),
        model: direct ? "Rust-authoritative effect origin" : source.model,
        confidence: preset?.is_speculative || !preset ? "Scenario geometry" : "Reference geometry",
        tone: preset?.is_speculative || !preset ? "speculative" : "reference",
        assumptions: direct ? [directResult ? "The result center is returned by the Rust physics response." : "The selected target becomes authoritative only after a versioned Rust response is returned."] : source.assumptions,
        citations: directResult ? buildDirectResultEvidence(directResult).citations : direct ? [{ label: "src-tauri/src/physics/direct_hazard.rs" }] : presetCitation(preset, source.citation),
      };
    case "analytical-wavefront":
      return {
        ...common,
        title: "Analytical wavefront layer",
        sourceTitle: preset?.reference ?? source.citation,
        model: "Analytical long-wave travel and geometric attenuation",
        confidence: "First-order analytical estimate",
        tone: "limited",
        assumptions: ["Travel time uses depth-averaged long-wave speed.", "Attenuation omits detailed seafloor scattering and dispersion."],
        limitations: [DEFAULT_BATHYMETRY_SOURCE, EDUCATIONAL_LIMITATION],
        citations: presetCitation(preset, source.citation),
      };
    case "swe-field":
    case "maximum-field":
    case "arrival-isochrones":
      return {
        ...common,
        title: layer === "swe-field" ? "SWE water-field layer" : layer === "maximum-field" ? "Maximum-field layer" : "Arrival-isochrone layer",
        sourceTitle: "Cataclysm Rust shallow-water solver and run-quality record",
        model: "Finite-volume shallow-water-equation solver",
        confidence: "Numerically checked output",
        tone: "validated",
        assumptions: ["Depth-averaged hydrostatic flow is appropriate at the represented scale.", "Wet/dry cells and CFL limits follow the recorded run-quality contract."],
        limitations: [DEFAULT_BATHYMETRY_SOURCE, "Grid resolution limits small-scale inundation and harbor effects.", EDUCATIONAL_LIMITATION],
        citations: [
          { label: "Berger et al. 2011, GeoClaw depth-averaged flow methods" },
          ...(layer === "arrival-isochrones" ? [{
            label: "UNESCO-IOC Tsunami Ready map and preparedness guidance",
            url: "https://tsunami.ioc.unesco.org/en/tsunami-ready",
          }] : []),
        ],
      };
    case "coastal-runup":
      return {
        ...common,
        title: "Coastal runup layer",
        sourceTitle: "Per-point slope/depth provenance with Synolakis screening",
        model: "Synolakis 1987 closed-form runup screening",
        confidence: "Per-point provenance; screening estimate",
        tone: "limited",
        assumptions: ["Each point uses its recorded offshore depth and beach slope.", "The non-breaking solitary-wave relation is used within its model gate."],
        limitations: ["First-order screening does not resolve local structures, harbor resonance, or evacuation conditions.", EDUCATIONAL_LIMITATION],
        citations: [
          { label: "Synolakis 1987, Journal of Fluid Mechanics 185:523–545" },
          {
            label: "UNESCO-IOC Tsunami Ready map and preparedness guidance",
            url: "https://tsunami.ioc.unesco.org/en/tsunami-ready",
          },
          {
            label: "Water 2024 tsunami-map interpretation study",
            url: "https://www.mdpi.com/2073-4441/16/23/3423",
          },
        ],
      };
    case "humanitarian-facilities":
      return {
        ...common,
        title: "Humanitarian facilities layer",
        sourceTitle: "OpenStreetMap contributor data via the public Overpass API",
        model: "OSM tag selection filtered against Cataclysm inundation screening discs",
        confidence: "Community-mapped context; completeness varies",
        tone: "limited",
        assumptions: [
          "Schools, healthcare sites, and emergency-response facilities are selected from explicit OSM tags.",
          "A facility is included only when its mapped point or feature center falls inside a modeled runup disc.",
        ],
        limitations: [
          "OpenStreetMap coverage, names, locations, tags, and update times vary by region.",
          "This layer does not establish damage, operability, access, evacuation status, or emergency needs.",
          "Public-query budgets can limit the view to the 30 largest active coastal extents and 500 facilities.",
          EDUCATIONAL_LIMITATION,
        ],
        citations: [
          { label: "© OpenStreetMap contributors (ODbL)", url: "https://www.openstreetmap.org/copyright" },
          { label: "Overpass API documentation", url: "https://wiki.openstreetmap.org/wiki/Overpass_API" },
        ],
      };
    case "usgs-official":
      return {
        ...common,
        title: "USGS official-product comparison layer",
        sourceTitle: "USGS ComCat preferred ShakeMap and PAGER products",
        model: "Observed/inferred intensity contours and impact summary",
        confidence: "Official product; may be preliminary or revised",
        tone: "reference",
        assumptions: [
          "The preferred ComCat products at fetch time are shown without reinterpretation.",
          "ShakeMap MMI contours are a comparison surface, not Cataclysm solver output.",
        ],
        limitations: [
          "ShakeMap and PAGER products can change as observations and analyses are updated.",
          "PAGER estimates are not a live warning and do not replace local emergency information.",
          EDUCATIONAL_LIMITATION,
        ],
        citations: [
          { label: "USGS ShakeMap", url: "https://earthquake.usgs.gov/data/shakemap/" },
          { label: "USGS PAGER", url: "https://earthquake.usgs.gov/data/pager/" },
        ],
      };
    case "dart-observations":
      return {
        ...common,
        title: "DART observation layer",
        sourceTitle: "NOAA DART event archive bundled dataset v1",
        model: "Historical buoy observations",
        confidence: "Observed reference series",
        tone: "reference",
        assumptions: ["Observation timestamps are aligned to the bundled event origin."],
        limitations: ["Only instrumented events and bundled stations are shown; absence of a station is not evidence of no wave."],
        citations: [{ label: "NOAA NDBC/NCEI DART observations; src/data/dart_buoys.json v1" }],
      };
    case "hazard-rings":
      if (directResult) {
        return {
          ...common,
          ...buildDirectResultEvidence(directResult),
          id: common.id,
          title: "Hazard effect-ring layer",
        };
      }
      return {
        ...common,
        title: "Hazard effect-ring layer",
        sourceTitle: "Rust direct-hazard request/response contract",
        model: "Rust-authoritative direct-hazard engine",
        confidence: "Waiting for a versioned result",
        tone: "limited",
        assumptions: ["Effect thresholds are not displayed as active until the Rust engine returns them."],
        citations: [{ label: "src-tauri/src/physics/direct_hazard.rs" }],
      };
    case "fallout-plume":
      return {
        ...common,
        title: "Fallout-plume layer",
        sourceTitle: "Glasstone & Dolan fallout scaling",
        model: "Rust wind-driven fallout geometry",
        confidence: "Deterministic screening geometry",
        tone: "limited",
        assumptions: ["A single wind direction drives idealized plume geometry.", "Terrain, weather evolution, and shelter variation are not resolved."],
        limitations: ["This is an educational screening layer, not a dose forecast or emergency-planning product.", EDUCATIONAL_LIMITATION],
        citations: [{ label: "Glasstone & Dolan 1977, The Effects of Nuclear Weapons" }],
      };
  }
}

export function evidenceIds(records: Array<TrustEvidence | null | undefined>): string[] {
  return [...new Set(records.filter((record): record is TrustEvidence => Boolean(record)).map((record) => record.id))].sort();
}
