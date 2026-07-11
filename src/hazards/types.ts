// Cataclysm — unified multi-hazard type layer.
//
// Every hazard (asteroid impact, nuclear detonation, earthquake, landslide,
// tsunami source) resolves to a common `HazardResult` the Cesium globe can
// render as concentric effect rings plus a structured readout. Individual
// engines keep their rich domain-specific result types; this layer is the
// lowest common denominator the UI depends on so new hazards can be added
// without touching the renderer.

export type HazardKind = "asteroid" | "nuclear" | "earthquake" | "landslide" | "tsunami";

export interface GeoPoint {
  lat: number; // degrees
  lon: number; // degrees
}

/** A single concentric effect zone drawn on the globe, radius in METERS. */
export interface EffectRing {
  label: string;
  radiusM: number;
  color: string; // hex or rgba the Cesium layer applies with its own alpha
  category: string; // grouping key: "blast" | "thermal" | "radiation" | "crater" | ...
  description?: string;
}

/** A labelled scalar for the results readout. */
export interface ReadoutItem {
  label: string;
  value: string; // already formatted for display
  hint?: string;
}

/** Optional casualty estimate (nuclear/impact over populated areas). */
export interface CasualtyEstimate {
  deaths: number;
  injuries: number;
  populationDensity: number; // people/km^2 assumed
}

/** The renderer-facing product of running any hazard. */
export interface HazardResult {
  kind: HazardKind;
  center: GeoPoint;
  rings: EffectRing[]; // sorted largest-first by the engine
  readout: ReadoutItem[];
  casualties?: CasualtyEstimate;
  /** Engine-specific rich result, retained for panels/exports. */
  detail?: unknown;
}

/** A hazard engine: pure input -> HazardResult. No DOM, no Cesium. */
export interface HazardEngine<TInput> {
  kind: HazardKind;
  label: string;
  /** Compute effects for the given input at a location. Pure. */
  run(input: TInput, center: GeoPoint): HazardResult;
}
