import { ResourceScope } from "./resources";
import type { ResourceCounts, ResourceLease } from "./types";
import type {
  AnalyticalGeoPosition,
  DartBuoyDescriptor,
  IsochroneLabelDescriptor,
  IsochronePolylineDescriptor,
  TsunamiAnalyticalEntityDescriptor,
  TsunamiAnalyticalEntityHost,
  WavefrontRingDescriptor,
} from "./tsunami-analytical-host";

export type AnalyticalWavefront = Readonly<{
  time_s: number;
  ranges_m: readonly number[];
  amplitudes_m: readonly number[];
}>;

export type AnalyticalIsochrone = Readonly<{
  time_s: number;
  lines: readonly (readonly (readonly [number, number])[])[];
}>;

export type AnalyticalDartBuoy = Readonly<{
  id: number;
  lat: number;
  lon: number;
}>;

export type TsunamiAnalyticalInput = Readonly<{
  source_center: Readonly<{ lat_deg: number; lon_deg: number }> | null;
  wavefront: AnalyticalWavefront | null;
  isochrones: readonly AnalyticalIsochrone[];
  dart_buoys: readonly AnalyticalDartBuoy[];
}>;

export type AnalyticalOperationCounts = Readonly<{
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  invalid_inputs: number;
}>;

export type TsunamiAnalyticalDiagnostics = Readonly<{
  generation: number;
  revision: number;
  destroyed: boolean;
  wavefront_time_s: number | null;
  isochrone_levels: number;
  active: Readonly<{
    wavefront_rings: number;
    isochrone_polylines: number;
    isochrone_labels: number;
    dart_buoys: number;
    total_entities: number;
  }>;
  last_update: AnalyticalOperationCounts;
  cumulative: AnalyticalOperationCounts;
  resources: ResourceCounts;
}>;

type OwnedEntity<Handle> = {
  handle: Handle;
  descriptor: TsunamiAnalyticalEntityDescriptor;
  signature: string;
  lease: ResourceLease;
};

type DesiredBuild = {
  entities: TsunamiAnalyticalEntityDescriptor[];
  invalidInputs: number;
  wavefrontTimeS: number | null;
  isochroneLevels: number;
};

const ZERO_OPERATIONS: AnalyticalOperationCounts = Object.freeze({
  created: 0,
  updated: 0,
  removed: 0,
  unchanged: 0,
  invalid_inputs: 0,
});

function position(lat_deg: number, lon_deg: number): AnalyticalGeoPosition {
  return Object.freeze({ lat_deg, lon_deg, height_m: 0 });
}

function validCoordinate(lat_deg: number, lon_deg: number): boolean {
  return Number.isFinite(lat_deg)
    && Number.isFinite(lon_deg)
    && lat_deg >= -90
    && lat_deg <= 90
    && lon_deg >= -180
    && lon_deg <= 180;
}

function clampedPosition(lon_deg: number, lat_deg: number): AnalyticalGeoPosition {
  return position(
    Math.max(-90, Math.min(90, lat_deg)),
    Math.max(-180, Math.min(180, lon_deg)),
  );
}

function signature(descriptor: TsunamiAnalyticalEntityDescriptor): string {
  return JSON.stringify(descriptor);
}

function freezeOperations(value: AnalyticalOperationCounts): AnalyticalOperationCounts {
  return Object.freeze({ ...value });
}

/** Stable entity lifecycle for analytical tsunami overlays; contains no solver physics. */
export class TsunamiAnalyticalController<Handle = unknown> {
  readonly #host: TsunamiAnalyticalEntityHost<Handle>;
  readonly #scope: ResourceScope;
  #owned = new Map<string, OwnedEntity<Handle>>();
  #revision = 0;
  #destroyed = false;
  #wavefrontTimeS: number | null = null;
  #isochroneLevels = 0;
  #lastUpdate: AnalyticalOperationCounts = ZERO_OPERATIONS;
  #cumulative: AnalyticalOperationCounts = ZERO_OPERATIONS;

  constructor(host: TsunamiAnalyticalEntityHost<Handle>, generation: number) {
    this.#host = host;
    this.#scope = new ResourceScope(generation);
  }

  get diagnostics(): TsunamiAnalyticalDiagnostics {
    let wavefrontRings = 0;
    let isochronePolylines = 0;
    let isochroneLabels = 0;
    let dartBuoys = 0;
    for (const { descriptor } of this.#owned.values()) {
      if (descriptor.kind === "wavefront_ring") wavefrontRings += 1;
      else if (descriptor.kind === "isochrone_polyline") isochronePolylines += 1;
      else if (descriptor.kind === "isochrone_label") isochroneLabels += 1;
      else dartBuoys += 1;
    }
    return Object.freeze({
      generation: this.#scope.generation,
      revision: this.#revision,
      destroyed: this.#destroyed,
      wavefront_time_s: this.#wavefrontTimeS,
      isochrone_levels: this.#isochroneLevels,
      active: Object.freeze({
        wavefront_rings: wavefrontRings,
        isochrone_polylines: isochronePolylines,
        isochrone_labels: isochroneLabels,
        dart_buoys: dartBuoys,
        total_entities: this.#owned.size,
      }),
      last_update: this.#lastUpdate,
      cumulative: this.#cumulative,
      resources: this.#scope.snapshotCounts(),
    });
  }

  update(input: TsunamiAnalyticalInput): TsunamiAnalyticalDiagnostics {
    if (this.#destroyed) throw new Error("TsunamiAnalyticalController is destroyed.");
    const build = this.#buildDesired(input);
    const desired = new Set(build.entities.map((descriptor) => descriptor.key));
    let created = 0;
    let updated = 0;
    let removed = 0;
    let unchanged = 0;

    for (const [key, owned] of [...this.#owned]) {
      if (desired.has(key)) continue;
      owned.lease.release();
      this.#owned.delete(key);
      removed += 1;
    }
    for (const descriptor of build.entities) {
      const nextSignature = signature(descriptor);
      const owned = this.#owned.get(descriptor.key);
      if (owned) {
        if (owned.signature === nextSignature) {
          unchanged += 1;
          continue;
        }
        this.#host.updateEntity(owned.handle, descriptor);
        owned.descriptor = descriptor;
        owned.signature = nextSignature;
        updated += 1;
        continue;
      }
      const handle = this.#host.createEntity(descriptor.key, descriptor);
      const lease = this.#scope.ownEntity(() => this.#host.removeEntity(handle));
      this.#owned.set(descriptor.key, { handle, descriptor, signature: nextSignature, lease });
      created += 1;
    }

    this.#wavefrontTimeS = build.wavefrontTimeS;
    this.#isochroneLevels = build.isochroneLevels;
    const operations = freezeOperations({ created, updated, removed, unchanged, invalid_inputs: build.invalidInputs });
    this.#record(operations);
    if (created + updated + removed > 0) this.#host.requestRender();
    return this.diagnostics;
  }

  clear(): TsunamiAnalyticalDiagnostics {
    if (this.#destroyed) return this.diagnostics;
    const removed = this.#owned.size;
    this.#scope.reset();
    this.#owned.clear();
    this.#wavefrontTimeS = null;
    this.#isochroneLevels = 0;
    this.#record(freezeOperations({ ...ZERO_OPERATIONS, removed }));
    if (removed > 0) this.#host.requestRender();
    return this.diagnostics;
  }

  destroy(): TsunamiAnalyticalDiagnostics {
    if (this.#destroyed) return this.diagnostics;
    const removed = this.#owned.size;
    this.#destroyed = true;
    this.#scope.destroy();
    this.#owned.clear();
    this.#wavefrontTimeS = null;
    this.#isochroneLevels = 0;
    this.#record(freezeOperations({ ...ZERO_OPERATIONS, removed }));
    if (removed > 0) this.#host.requestRender();
    return this.diagnostics;
  }

  #record(operations: AnalyticalOperationCounts): void {
    this.#revision += 1;
    this.#lastUpdate = operations;
    this.#cumulative = freezeOperations({
      created: this.#cumulative.created + operations.created,
      updated: this.#cumulative.updated + operations.updated,
      removed: this.#cumulative.removed + operations.removed,
      unchanged: this.#cumulative.unchanged + operations.unchanged,
      invalid_inputs: this.#cumulative.invalid_inputs + operations.invalid_inputs,
    });
  }

  #buildDesired(input: TsunamiAnalyticalInput): DesiredBuild {
    const entities: TsunamiAnalyticalEntityDescriptor[] = [];
    let invalidInputs = 0;
    let wavefrontTimeS: number | null = null;

    if (input.wavefront) {
      if (!input.source_center || !validCoordinate(input.source_center.lat_deg, input.source_center.lon_deg)) {
        invalidInputs += 1;
      } else if (!Number.isFinite(input.wavefront.time_s)) {
        invalidInputs += 1;
      } else {
        wavefrontTimeS = input.wavefront.time_s;
        const sourcePosition = position(input.source_center.lat_deg, input.source_center.lon_deg);
        const maximumAmplitude = Math.max(
          1e-9,
          input.wavefront.amplitudes_m.reduce(
            (maximum, amplitude) => Number.isFinite(amplitude) && amplitude > maximum ? amplitude : maximum,
            1e-9,
          ),
        );
        for (let index = 0; index < input.wavefront.ranges_m.length; index += 2) {
          const radius = input.wavefront.ranges_m[index];
          if (!Number.isFinite(radius)) {
            invalidInputs += 1;
            continue;
          }
          const amplitude = input.wavefront.amplitudes_m[index];
          if (!Number.isFinite(amplitude)) invalidInputs += 1;
          const normalized = Math.min(1, (Number.isFinite(amplitude) ? amplitude : 0) / maximumAmplitude);
          const descriptor: WavefrontRingDescriptor = Object.freeze({
            kind: "wavefront_ring",
            key: `wavefront:ring:${index}`,
            position: sourcePosition,
            semi_major_axis_m: Math.max(radius, 1),
            semi_minor_axis_m: Math.max(radius, 1),
            fill_css: "#74c7ec",
            fill_alpha: 0,
            outline_css: "#74c7ec",
            outline_alpha: 0.25 + 0.55 * normalized,
          });
          entities.push(descriptor);
        }
      }
    }

    let validLevels = 0;
    const timeOccurrences = new Map<number, number>();
    input.isochrones.forEach((isochrone, levelIndex) => {
      if (!Number.isFinite(isochrone.time_s)) {
        invalidInputs += 1;
        return;
      }
      const occurrence = timeOccurrences.get(isochrone.time_s) ?? 0;
      timeOccurrences.set(isochrone.time_s, occurrence + 1);
      const levelKey = `isochrone:${isochrone.time_s}:${occurrence}`;
      const minutes = Math.round(isochrone.time_s / 60);
      let labelled = false;
      let linesAdded = 0;
      isochrone.lines.forEach((line, lineIndex) => {
        if (line.length < 2) {
          invalidInputs += 1;
          return;
        }
        const points: AnalyticalGeoPosition[] = [];
        for (const [lon, lat] of line) {
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
            invalidInputs += 1;
            continue;
          }
          points.push(clampedPosition(lon, lat));
        }
        if (points.length < 2) {
          invalidInputs += 1;
          return;
        }
        const polyline: IsochronePolylineDescriptor = Object.freeze({
          kind: "isochrone_polyline",
          key: `${levelKey}:line:${lineIndex}`,
          positions: Object.freeze(points),
          width_px: 1.6,
          color_css: "#f9e2af",
          alpha: 0.85,
          dash_length_px: 12,
          clamp_to_ground: false,
        });
        entities.push(polyline);
        linesAdded += 1;
        if (!labelled) {
          const label: IsochroneLabelDescriptor = Object.freeze({
            kind: "isochrone_label",
            key: `${levelKey}:label`,
            position: points[Math.floor(points.length / 2)],
            text: `+${minutes} min`,
            font: "11px 'JetBrains Mono', monospace",
            fill_css: "#f9e2af",
            outline_css: "#000000",
            outline_alpha: 0.7,
            outline_width_px: 2,
            scale: 1,
            disable_depth_test_distance_m: Number.POSITIVE_INFINITY,
          });
          entities.push(label);
          labelled = true;
        }
      });
      if (linesAdded > 0) validLevels += 1;
      else if (isochrone.lines.length === 0) invalidInputs += 1;
      void levelIndex;
    });

    const buoyIndexes = new Map<number, number>();
    input.dart_buoys.forEach((buoy) => {
      if (!Number.isSafeInteger(buoy.id) || buoy.id < 0 || !validCoordinate(buoy.lat, buoy.lon)) {
        invalidInputs += 1;
        return;
      }
      const priorIndex = buoyIndexes.get(buoy.id);
      if (priorIndex !== undefined) {
        invalidInputs += 1;
        entities.splice(priorIndex, 1);
        for (const [id, index] of buoyIndexes) if (index > priorIndex) buoyIndexes.set(id, index - 1);
      }
      const label = `DART ${buoy.id}`;
      const descriptor: DartBuoyDescriptor = Object.freeze({
        kind: "dart_buoy",
        key: `dart:${buoy.id}`,
        name: label,
        position: position(buoy.lat, buoy.lon),
        pixel_size: 9,
        fill_css: "#eba0ac",
        outline_css: "#11111b",
        outline_width_px: 2,
        label,
        label_font: "10px Inter, sans-serif",
        label_pixel_offset: Object.freeze([0, 10] as const),
        label_scale: 0.85,
        distance_display_min_m: 0,
        distance_display_max_m: 15_000_000,
      });
      buoyIndexes.set(buoy.id, entities.length);
      entities.push(descriptor);
    });

    return { entities, invalidInputs, wavefrontTimeS, isochroneLevels: validLevels };
  }
}
