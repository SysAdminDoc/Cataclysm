import { save } from "@tauri-apps/plugin-dialog";
import type { DirectHazardExportData, ExportResult, RunupPoint, ScreenshotMeta } from "./export";
import {
  preflightRunQuality,
  safeFilenamePart,
} from "./export";
import { buildModelProvenance } from "./model-provenance";
import { sha256Json } from "./run-identity";
import {
  api,
  isTauri,
  type GeoPackageExportRequest,
  type GeoPackageFeature,
  type GeoPackageGeometry,
  type GeoPackageLayer,
} from "./tauri";
import type { Gauge, GridSnapshot, InitialSourceGeometry, Isochrone } from "../types/scenario";

const EARTH_RADIUS_M = 6_371_000;
const POLYGON_VERTICES = 64;

export type GeoPackageBuildInput = {
  meta: ScreenshotMeta;
  gauges?: readonly Gauge[];
  gaugeSnapshots?: readonly GridSnapshot[];
  runupPoints?: readonly RunupPoint[];
  isochrones?: readonly Isochrone[] | null;
  directHazard?: DirectHazardExportData | null;
};

function normaliseLongitude(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

function localOffset(
  center: { lat: number; lon: number },
  eastM: number,
  northM: number,
): [number, number] {
  const lat = center.lat + (northM / EARTH_RADIUS_M) * (180 / Math.PI);
  const cosLat = Math.max(1e-6, Math.abs(Math.cos((center.lat * Math.PI) / 180)));
  const lon = center.lon + (eastM / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI);
  return [normaliseLongitude(lon), Math.max(-90, Math.min(90, lat))];
}

function closeRing(coordinates: Array<[number, number]>): Array<[number, number]> {
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (first && last && first[0] === last[0] && first[1] === last[1]) return coordinates;
  return first ? [...coordinates, first] : coordinates;
}

function circlePolygon(center: { lat: number; lon: number }, radiusM: number): Array<[number, number]> {
  const radius = Math.max(1, Number.isFinite(radiusM) ? radiusM : 1);
  const coordinates: Array<[number, number]> = [];
  for (let index = 0; index <= POLYGON_VERTICES; index++) {
    const angle = (index / POLYGON_VERTICES) * Math.PI * 2;
    coordinates.push(localOffset(center, Math.sin(angle) * radius, Math.cos(angle) * radius));
  }
  return closeRing(coordinates);
}

function ellipsePolygon(
  center: { lat: number; lon: number },
  alongRadiusM: number,
  acrossRadiusM: number,
  azimuthDeg: number,
): Array<[number, number]> {
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const alongRadius = Math.max(1, Math.abs(alongRadiusM));
  const acrossRadius = Math.max(1, Math.abs(acrossRadiusM));
  const coordinates: Array<[number, number]> = [];
  for (let index = 0; index <= POLYGON_VERTICES; index++) {
    const angle = (index / POLYGON_VERTICES) * Math.PI * 2;
    const along = Math.cos(angle) * alongRadius;
    const across = Math.sin(angle) * acrossRadius;
    const east = along * Math.sin(azimuth) + across * Math.cos(azimuth);
    const north = along * Math.cos(azimuth) - across * Math.sin(azimuth);
    coordinates.push(localOffset(center, east, north));
  }
  return closeRing(coordinates);
}

function okadaFaultPolygon(fault: Extract<InitialSourceGeometry, { kind: "okada" }>["fault"]): Array<[number, number]> {
  const center = { lat: fault.center_lat, lon: fault.center_lon };
  const strike = (fault.strike_deg * Math.PI) / 180;
  const dipWidth = Math.abs(fault.width_m * Math.cos((fault.dip_deg * Math.PI) / 180));
  const halfLength = Math.abs(fault.length_m) / 2;
  const halfWidth = dipWidth / 2;
  const corners = [
    [-halfLength, -halfWidth],
    [halfLength, -halfWidth],
    [halfLength, halfWidth],
    [-halfLength, halfWidth],
  ];
  return closeRing(corners.map(([along, across]) => localOffset(
    center,
    along * Math.sin(strike) + across * Math.cos(strike),
    along * Math.cos(strike) - across * Math.sin(strike),
  )));
}

function pointGeometry(lat: number, lon: number): GeoPackageGeometry {
  return { type: "Point", coordinates: [lon, lat] };
}

function polygonGeometry(coordinates: Array<[number, number]>): GeoPackageGeometry {
  return { type: "Polygon", coordinates: [closeRing(coordinates)] };
}

function addLayer(
  layers: GeoPackageLayer[],
  tableName: GeoPackageLayer["tableName"],
  description: string,
  features: GeoPackageFeature[],
): void {
  if (features.length > 0) layers.push({ tableName, description, features });
}

function buildSourceLayers(
  meta: ScreenshotMeta,
  directHazard: DirectHazardExportData | null | undefined,
): { source: GeoPackageFeature[]; footprints: GeoPackageFeature[]; faults: GeoPackageFeature[] } {
  const source: GeoPackageFeature[] = [];
  const footprints: GeoPackageFeature[] = [];
  const faults: GeoPackageFeature[] = [];
  const initial = meta.initial;
  if (initial) {
    const sourceCenter = { lat: initial.center.lat_deg, lon: initial.center.lon_deg };
    source.push({
      id: "source-center",
      name: initial.label,
      geometry: pointGeometry(initial.center.lat_deg, initial.center.lon_deg),
      properties: {
        kind: "source_center",
        label: initial.label,
        peak_amplitude_m: initial.peak_amplitude_m,
        cavity_radius_m: initial.cavity_radius_m,
        source_energy_j: initial.source_energy_j,
        seismic_mw_equivalent: initial.seismic_mw_equivalent,
        dominant_wavelength_m: initial.dominant_wavelength_m ?? null,
        recurrence_note: initial.recurrence_note ?? null,
        source_geometry: initial.source_geometry ?? null,
      },
    });
    const geometry = initial.source_geometry;
    if (geometry?.kind === "cavity_ring") {
      footprints.push({
        id: "source-cavity-ring",
        name: "Cavity/rim footprint",
        geometry: polygonGeometry(circlePolygon(sourceCenter, geometry.rim_radius_m)),
        properties: { kind: geometry.kind, rim_radius_m: geometry.rim_radius_m, rim_width_m: geometry.rim_width_m },
      });
    } else if (geometry?.kind === "landslide") {
      footprints.push({
        id: "source-landslide-footprint",
        name: "Landslide source footprint",
        geometry: polygonGeometry(ellipsePolygon(
          sourceCenter,
          geometry.longitudinal_sigma_m * 2,
          geometry.transverse_sigma_m * 2,
          geometry.axis_azimuth_deg,
        )),
        properties: { kind: geometry.kind, axis_azimuth_deg: geometry.axis_azimuth_deg, longitudinal_sigma_m: geometry.longitudinal_sigma_m, transverse_sigma_m: geometry.transverse_sigma_m },
      });
    } else if (geometry?.kind === "okada") {
      faults.push({
        id: "fault-plane",
        name: "Okada fault-plane surface projection",
        geometry: polygonGeometry(okadaFaultPolygon(geometry.fault)),
        properties: { kind: geometry.kind, fault: geometry.fault, projection: "surface projection; depth and dip retained in properties" },
      });
    } else if (geometry?.kind === "volcanic_collapse") {
      footprints.push({
        id: "source-volcanic-collapse-footprint",
        name: "Volcanic-collapse source footprint",
        geometry: polygonGeometry(ellipsePolygon(
          sourceCenter,
          geometry.footprint_length_m * 2,
          geometry.footprint_width_m * 2,
          0,
        )),
        properties: {
          kind: geometry.kind,
          collapse_kind: geometry.collapse_kind,
          footprint_length_m: geometry.footprint_length_m,
          footprint_width_m: geometry.footprint_width_m,
          collapse_duration_s: geometry.collapse_duration_s,
          signed_peak_amplitude_m: geometry.signed_peak_amplitude_m,
          limitation: "Hydrostatic source footprint; short near-field waves may require dispersive/non-hydrostatic physics",
        },
      });
    }
  } else if (directHazard) {
    source.push({
      id: "direct-effects-origin",
      name: `${directHazard.result.kind} effects origin`,
      geometry: pointGeometry(directHazard.result.center.lat, directHazard.result.center.lon),
      properties: {
        kind: "direct_effects_origin",
        hazard_kind: directHazard.result.kind,
        authority: directHazard.result.authority,
        model_version: directHazard.result.modelVersion,
        readout: directHazard.result.readout,
      },
    });
  }
  return { source, footprints, faults };
}

function buildGaugeFeatures(
  gauges: readonly Gauge[],
  snapshots: readonly GridSnapshot[],
): GeoPackageFeature[] {
  return gauges.map((gauge) => {
    const samples = snapshots.flatMap((snapshot) =>
      (snapshot.gauge_samples ?? [])
        .filter((sample) => sample.id === gauge.id)
        .map((sample) => ({ time_s: snapshot.time_s, eta_m: sample.eta_m })),
    );
    return {
      id: gauge.id,
      name: gauge.name,
      geometry: pointGeometry(gauge.lat_deg, gauge.lon_deg),
      properties: {
        kind: "swe_gauge",
        gauge_id: gauge.id,
        sample_count: samples.length,
        samples,
      },
    };
  });
}

function buildRunupFeatures(points: readonly RunupPoint[]): GeoPackageFeature[] {
  return points.map((point) => ({
    id: point.id,
    name: point.name,
    geometry: pointGeometry(point.lat, point.lon),
    properties: {
      kind: "coastal_runup",
      runup_m: point.runup_m,
      arrival_time_s: point.arrival_time_s,
      inundation_extent_m: point.inundation_extent_m,
      offshore_amplitude_m: point.offshore_amplitude_m,
      beach_slope_deg: point.beach_slope_deg,
      offshore_depth_m: point.offshore_depth_m,
      has_arrived: point.has_arrived ?? null,
      quantitative_confidence: point.quantitative_confidence,
      quantitative_label: point.quantitative_label,
      slope_provenance: point.slope_provenance,
      depth_provenance: point.depth_provenance,
    },
  }));
}

function buildIsochroneFeatures(isochrones: readonly Isochrone[] | null | undefined): GeoPackageFeature[] {
  return (isochrones ?? []).map((isochrone, index) => ({
    id: `isochrone-${index + 1}`,
    name: `Arrival isochrone T+${isochrone.time_s}s`,
    geometry: {
      type: "MultiLineString" as const,
      coordinates: isochrone.lines.map((line) => line.map(([lon, lat]) => [lon, lat] as [number, number])),
    },
    properties: { kind: "arrival_isochrone", arrival_time_s: isochrone.time_s, line_count: isochrone.lines.length },
  }));
}

function buildDirectEffectFeatures(data: DirectHazardExportData | null | undefined): GeoPackageFeature[] {
  if (!data) return [];
  const center = data.result.center;
  const rings = data.result.rings.map((ring, index) => ({
    id: `effect-ring-${index + 1}`,
    name: ring.label,
    geometry: polygonGeometry(circlePolygon(center, ring.radiusM)),
    properties: {
      kind: "effect_ring",
      category: ring.category,
      radius_m: ring.radiusM,
      color: ring.color,
      description: ring.description ?? null,
      authority: data.result.authority,
      model_version: data.result.modelVersion,
    },
  }));
  const polygons = (data.polygons ?? []).map((polygon, index) => ({
    id: `hazard-polygon-${index + 1}`,
    name: polygon.label,
    geometry: polygonGeometry(polygon.points.map((point) => [point.lon, point.lat])),
    properties: { kind: "hazard_polygon", color: polygon.color, authority: data.result.authority, model_version: data.result.modelVersion },
  }));
  return [...rings, ...polygons];
}

export async function buildGeoPackageRequest(input: GeoPackageBuildInput): Promise<GeoPackageExportRequest> {
  const provenance = buildModelProvenance(input.meta);
  const sourceLayers = buildSourceLayers(input.meta, input.directHazard);
  const layers: GeoPackageLayer[] = [];
  addLayer(layers, "source_geometry", "Scenario source locations and direct-effect origins", sourceLayers.source);
  addLayer(layers, "source_footprints", "Source-specific footprint geometry", sourceLayers.footprints);
  addLayer(layers, "fault_geometry", "Okada fault-plane surface projection", sourceLayers.faults);
  addLayer(layers, "gauges", "Finite-volume solver gauge locations and bounded samples", buildGaugeFeatures(input.gauges ?? [], input.gaugeSnapshots ?? []));
  addLayer(layers, "runup", "Coastal runup screening points and measurement provenance", buildRunupFeatures(input.runupPoints ?? []));
  addLayer(layers, "arrival_isochrones", "Maximum-field first-arrival contours", buildIsochroneFeatures(input.isochrones));
  addLayer(layers, "direct_effect_polygons", "Direct-effect thresholds and supplied hazard polygons", buildDirectEffectFeatures(input.directHazard));

  const sourceDigest = await sha256Json({
    schemaVersion: 1,
    scenario: provenance.scenarioName,
    scenarioType: provenance.scenarioType,
    initial: input.meta.initial ?? null,
    directHazard: input.directHazard?.result ?? null,
    solverMode: provenance.solverMode,
  });
  const dataDigest = await sha256Json({ schemaVersion: 1, layers });
  const citations = [
    provenance.citationReference,
    ...(provenance.citationUrl ? [provenance.citationUrl] : []),
    ...provenance.evidenceIds,
  ];
  return {
    schemaVersion: 1,
    title: `Cataclysm — ${provenance.scenarioName}`.slice(0, 256),
    metadata: {
      scenario: provenance.scenarioName,
      scenarioType: provenance.scenarioType,
      generatedAt: provenance.generatedAt,
      horizontalCrs: "EPSG:4326",
      horizontalDatum: "WGS 84",
      verticalDatum: provenance.heightField.vertical_datum,
      horizontalUnits: "degrees",
      verticalUnits: provenance.heightField.unit,
      displayUnitSystem: provenance.unitSystem,
      qualityStatus: provenance.runQuality?.status ?? "not_applicable",
      quality: provenance.runQuality ?? { status: "not_applicable", limitation: provenance.limitation },
      solverMode: provenance.solverMode,
      limitation: provenance.limitation,
      citationReference: provenance.citationReference,
      citationUrl: provenance.citationUrl,
      citations,
      evidenceIds: provenance.evidenceIds,
      appVersion: provenance.appVersion,
      assetRegistryVersion: provenance.assetRegistryVersion,
      bathymetryAssetId: provenance.bathymetryAssetId,
      bathymetrySource: provenance.bathymetrySource,
      sourceDigest,
      dataDigest,
      provenance,
    },
    layers,
  };
}

export async function exportGeoPackage(
  input: GeoPackageBuildInput,
): Promise<ExportResult<{
  destination: string;
  bytes: number;
  layers: number;
  features: number;
  vertices: number;
}>> {
  if (!isTauri()) {
    return {
      ok: false,
      code: "data",
      message: "GeoPackage export is available in the desktop app so SQLite can publish a standards-compliant file.",
      retryable: false,
    };
  }
  const quality = preflightRunQuality(input.meta);
  if (!quality.ok) return { ok: false, code: "preflight", message: quality.reason, retryable: false };
  try {
    const request = await buildGeoPackageRequest(input);
    if (request.layers.length === 0) {
      return { ok: false, code: "data", message: "No bounded GIS layers are available for GeoPackage export.", retryable: true };
    }
    const destination = await save({
      defaultPath: `cataclysm-${safeFilenamePart(input.meta.fileId ?? input.meta.preset?.id ?? "custom-scenario")}-gis.gpkg`,
      filters: [{ name: "OGC GeoPackage", extensions: ["gpkg"] }],
    });
    if (!destination) return { ok: false, code: "cancelled", message: "GeoPackage export was cancelled.", retryable: true };
    const response = await api.saveGeoPackage(request, destination);
    return {
      ok: true,
      destination: response.destination,
      bytes: response.bytes,
      layers: response.layers,
      features: response.features,
      vertices: response.vertices,
    };
  } catch (error) {
    console.error("[export] GeoPackage export failed", error);
    return {
      ok: false,
      code: "filesystem",
      message: `GeoPackage export failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    };
  }
}
