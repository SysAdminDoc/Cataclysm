import { ResourceScope } from "./resources";
import type { ResourceCounts, ResourceLease } from "./types";
import type {
  FalloutPolygonEntityDescriptor,
  GroundZeroEntityDescriptor,
  HazardGeoPosition,
  HazardRingEntityDescriptor,
  StaticHazardEntityDescriptor,
  StaticHazardEntityHost,
} from "./static-hazard-host";

export type HazardFootprintRing = Readonly<{
  id?: string;
  label: string;
  description?: string;
  radius_m: number;
  color_css: string;
}>;

export type FalloutPolygon = Readonly<{
  id?: string;
  label: string;
  color_css: string;
  points: readonly Readonly<{ lat_deg: number; lon_deg: number }>[];
}>;

export type StaticHazardInput = Readonly<{
  center: Readonly<{ lat_deg: number; lon_deg: number }> | null;
  rings: readonly HazardFootprintRing[];
  fallout_polygons: readonly FalloutPolygon[];
}>;

export type StaticHazardOperationCounts = Readonly<{
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  invalid_inputs: number;
}>;

export type StaticHazardDiagnostics = Readonly<{
  generation: number;
  revision: number;
  destroyed: boolean;
  active: Readonly<{
    hazard_rings: number;
    ground_zero_markers: number;
    fallout_polygons: number;
    total_entities: number;
    outer_radius_m: number;
  }>;
  last_update: StaticHazardOperationCounts;
  cumulative: StaticHazardOperationCounts;
  resources: ResourceCounts;
}>;

type OwnedEntity<Handle> = {
  handle: Handle;
  descriptor: StaticHazardEntityDescriptor;
  signature: string;
  lease: ResourceLease;
};

type DesiredBuild = {
  entities: StaticHazardEntityDescriptor[];
  invalidInputs: number;
};

const ZERO_OPERATIONS: StaticHazardOperationCounts = Object.freeze({
  created: 0,
  updated: 0,
  removed: 0,
  unchanged: 0,
  invalid_inputs: 0,
});

function frozenPosition(lat_deg: number, lon_deg: number): HazardGeoPosition {
  return Object.freeze({ lat_deg, lon_deg, height_m: 0 });
}

function finiteCoordinate(value: Readonly<{ lat_deg: number; lon_deg: number }> | null): value is Readonly<{ lat_deg: number; lon_deg: number }> {
  return value !== null
    && Number.isFinite(value.lat_deg)
    && Number.isFinite(value.lon_deg)
    && value.lat_deg >= -90
    && value.lat_deg <= 90
    && value.lon_deg >= -180
    && value.lon_deg <= 180;
}

function stableKeys<T extends { id?: string; label: string }>(prefix: string, values: readonly T[]): Array<{ value: T; key: string }> {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const identity = value.id?.trim() || value.label.trim();
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { value, key: `${prefix}:${identity}:${occurrence}` };
  });
}

function signature(descriptor: StaticHazardEntityDescriptor): string {
  return JSON.stringify(descriptor);
}

function freezeOperations(value: StaticHazardOperationCounts): StaticHazardOperationCounts {
  return Object.freeze({ ...value });
}

/** Stable, generation-bound entity lifecycle for hazard footprints and fallout. */
export class StaticHazardController<Handle = unknown> {
  readonly #host: StaticHazardEntityHost<Handle>;
  readonly #scope: ResourceScope;
  #owned = new Map<string, OwnedEntity<Handle>>();
  #revision = 0;
  #destroyed = false;
  #lastUpdate: StaticHazardOperationCounts = ZERO_OPERATIONS;
  #cumulative: StaticHazardOperationCounts = ZERO_OPERATIONS;

  constructor(host: StaticHazardEntityHost<Handle>, generation: number) {
    this.#host = host;
    this.#scope = new ResourceScope(generation);
  }

  get diagnostics(): StaticHazardDiagnostics {
    let hazardRings = 0;
    let groundZero = 0;
    let fallout = 0;
    let outerRadius = 0;
    for (const { descriptor } of this.#owned.values()) {
      if (descriptor.kind === "hazard_ring") {
        hazardRings += 1;
        outerRadius = Math.max(outerRadius, descriptor.semi_major_axis_m);
      } else if (descriptor.kind === "ground_zero") {
        groundZero += 1;
      } else {
        fallout += 1;
      }
    }
    return Object.freeze({
      generation: this.#scope.generation,
      revision: this.#revision,
      destroyed: this.#destroyed,
      active: Object.freeze({
        hazard_rings: hazardRings,
        ground_zero_markers: groundZero,
        fallout_polygons: fallout,
        total_entities: this.#owned.size,
        outer_radius_m: outerRadius,
      }),
      last_update: this.#lastUpdate,
      cumulative: this.#cumulative,
      resources: this.#scope.snapshotCounts(),
    });
  }

  update(input: StaticHazardInput): StaticHazardDiagnostics {
    if (this.#destroyed) throw new Error("StaticHazardController is destroyed.");
    const desiredBuild = this.#buildDesired(input);
    const desired = new Map(desiredBuild.entities.map((descriptor) => [descriptor.key, descriptor]));
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

    for (const descriptor of desiredBuild.entities) {
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

    const operations = freezeOperations({
      created,
      updated,
      removed,
      unchanged,
      invalid_inputs: desiredBuild.invalidInputs,
    });
    this.#record(operations);
    if (created + updated + removed > 0) this.#host.requestRender();
    return this.diagnostics;
  }

  clear(): StaticHazardDiagnostics {
    if (this.#destroyed) return this.diagnostics;
    const removed = this.#owned.size;
    this.#scope.reset();
    this.#owned.clear();
    const operations = freezeOperations({ ...ZERO_OPERATIONS, removed });
    this.#record(operations);
    if (removed > 0) this.#host.requestRender();
    return this.diagnostics;
  }

  destroy(): StaticHazardDiagnostics {
    if (this.#destroyed) return this.diagnostics;
    const removed = this.#owned.size;
    this.#destroyed = true;
    this.#scope.destroy();
    this.#owned.clear();
    const operations = freezeOperations({ ...ZERO_OPERATIONS, removed });
    this.#record(operations);
    if (removed > 0) this.#host.requestRender();
    return this.diagnostics;
  }

  #record(operations: StaticHazardOperationCounts): void {
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

  #buildDesired(input: StaticHazardInput): DesiredBuild {
    const entities: StaticHazardEntityDescriptor[] = [];
    let invalidInputs = 0;
    const centerValid = finiteCoordinate(input.center);
    if (input.center && !centerValid) invalidInputs += 1;

    if (centerValid) {
      const position = frozenPosition(input.center.lat_deg, input.center.lon_deg);
      const rings = stableKeys("footprint:ring", input.rings)
        .filter(({ value }) => {
          const valid = value.label.trim().length > 0
            && value.color_css.trim().length > 0
            && Number.isFinite(value.radius_m);
          if (!valid) invalidInputs += 1;
          return valid;
        })
        .sort((left, right) => right.value.radius_m - left.value.radius_m);
      rings.forEach(({ value, key }, index) => {
        const radius = Math.max(value.radius_m, 1);
        const descriptor: HazardRingEntityDescriptor = Object.freeze({
          kind: "hazard_ring",
          key,
          name: value.label,
          description: value.description ?? value.label,
          position,
          semi_major_axis_m: radius,
          semi_minor_axis_m: radius,
          fill_css: value.color_css,
          fill_alpha: 0.16,
          outline_css: value.color_css,
          outline_alpha: 0.9,
          outline_width_px: 2,
          z_order: index,
        });
        entities.push(descriptor);
      });
      if (rings.length > 0) {
        const groundZero: GroundZeroEntityDescriptor = Object.freeze({
          kind: "ground_zero",
          key: "footprint:ground-zero",
          position,
          pixel_size: 9,
          fill_css: "#f38ba8",
          outline_css: "#11111b",
          outline_width_px: 2,
          label: "Ground zero",
        });
        entities.push(groundZero);
      }
    } else if (input.rings.length > 0) {
      invalidInputs += input.rings.length;
    }

    for (const { value, key } of stableKeys("fallout", input.fallout_polygons)) {
      if (value.label.trim().length === 0 || value.color_css.trim().length === 0) {
        invalidInputs += 1;
        continue;
      }
      const points: HazardGeoPosition[] = [];
      for (const point of value.points) {
        if (!finiteCoordinate(point)) {
          invalidInputs += 1;
          continue;
        }
        points.push(frozenPosition(point.lat_deg, point.lon_deg));
      }
      if (points.length < 3) {
        invalidInputs += 1;
        continue;
      }
      const polygon: FalloutPolygonEntityDescriptor = Object.freeze({
        kind: "fallout_polygon",
        key,
        name: value.label,
        description: value.label,
        points: Object.freeze(points),
        fill_css: value.color_css,
        fill_alpha: 0.22,
        outline_css: value.color_css,
        outline_alpha: 0.8,
      });
      entities.push(polygon);
    }
    return { entities, invalidInputs };
  }
}
