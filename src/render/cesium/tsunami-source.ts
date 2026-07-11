import { ResourceScope } from "./resources";
import { RESOURCE_CATEGORIES, type ResourceCounts, type ResourceLease } from "./types";
import type {
  SourceCameraTarget,
  SourceGeoPosition,
  ThemeColorReference,
  TsunamiSourceEntityDescriptor,
  TsunamiSourceHost,
} from "./tsunami-source-host";

export type TsunamiSourceInput = Readonly<{
  center: Readonly<{ lat_deg: number; lon_deg: number }>;
  cavity_radius_m: number;
  peak_amplitude_m: number;
  label: string;
  camera_view?: Readonly<{
    heading_deg: number;
    pitch_deg: number;
    range_m: number;
  }> | null;
}>;

export type SourceControllerInput = Readonly<{
  source: TsunamiSourceInput | null;
  reference_capture: boolean;
  reduced_motion: boolean;
}>;

export type SourceCameraMode = "none" | "flight" | "instant" | "reference_capture";

export type SourceOperationCounts = Readonly<{
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  invalid_inputs: number;
  flights_started: number;
  flights_cancelled: number;
  instant_views: number;
  reference_capture_skips: number;
  flight_failures: number;
}>;

export type TsunamiSourceDiagnostics = Readonly<{
  generation: number;
  revision: number;
  destroyed: boolean;
  camera_mode: SourceCameraMode;
  active: Readonly<{
    source_entities: number;
    camera_flights: number;
  }>;
  last_update: SourceOperationCounts;
  cumulative: SourceOperationCounts;
  resources: ResourceCounts;
}>;

const ZERO_OPERATIONS: SourceOperationCounts = Object.freeze({
  created: 0,
  updated: 0,
  removed: 0,
  unchanged: 0,
  invalid_inputs: 0,
  flights_started: 0,
  flights_cancelled: 0,
  instant_views: 0,
  reference_capture_skips: 0,
  flight_failures: 0,
});

function theme(token: string, fallback_css: string, alpha = 1): ThemeColorReference {
  return Object.freeze({ token, fallback_css, alpha });
}

function sumCounts(left: ResourceCounts, right: ResourceCounts): ResourceCounts {
  return Object.freeze(Object.fromEntries(
    RESOURCE_CATEGORIES.map((category) => [category, left[category] + right[category]]),
  ) as Record<(typeof RESOURCE_CATEGORIES)[number], number>);
}

function freezeOperations(value: SourceOperationCounts): SourceOperationCounts {
  return Object.freeze({ ...value });
}

function validSource(source: TsunamiSourceInput): boolean {
  return Number.isFinite(source.center.lat_deg)
    && Number.isFinite(source.center.lon_deg)
    && source.center.lat_deg >= -90
    && source.center.lat_deg <= 90
    && source.center.lon_deg >= -180
    && source.center.lon_deg <= 180
    && Number.isFinite(source.cavity_radius_m)
    && source.cavity_radius_m >= 0
    && Number.isFinite(source.peak_amplitude_m)
    && source.label.trim().length > 0;
}

function validCameraView(view: NonNullable<TsunamiSourceInput["camera_view"]>): boolean {
  return Number.isFinite(view.heading_deg)
    && Number.isFinite(view.pitch_deg)
    && Number.isFinite(view.range_m)
    && view.range_m > 0;
}

function cameraSignature(target: SourceCameraTarget, mode: SourceCameraMode): string {
  return JSON.stringify({ target, mode });
}

/** Lifecycle-safe source marker and camera framing with one stable entity handle. */
export class TsunamiSourceController<Handle = unknown> {
  readonly #host: TsunamiSourceHost<Handle>;
  readonly #entityScope: ResourceScope;
  readonly #flightScope: ResourceScope;
  #handle: Handle | null = null;
  #entityLease: ResourceLease | null = null;
  #entitySignature: string | null = null;
  #cameraSignature: string | null = null;
  #cameraMode: SourceCameraMode = "none";
  #revision = 0;
  #destroyed = false;
  #lastUpdate: SourceOperationCounts = ZERO_OPERATIONS;
  #cumulative: SourceOperationCounts = ZERO_OPERATIONS;

  constructor(host: TsunamiSourceHost<Handle>, generation: number) {
    this.#host = host;
    this.#entityScope = new ResourceScope(generation);
    this.#flightScope = new ResourceScope(generation);
  }

  get diagnostics(): TsunamiSourceDiagnostics {
    const flightCounts = this.#flightScope.snapshotCounts();
    return Object.freeze({
      generation: this.#entityScope.generation,
      revision: this.#revision,
      destroyed: this.#destroyed,
      camera_mode: this.#cameraMode,
      active: Object.freeze({
        source_entities: this.#handle === null ? 0 : 1,
        camera_flights: flightCounts.pendingAsync,
      }),
      last_update: this.#lastUpdate,
      cumulative: this.#cumulative,
      resources: sumCounts(this.#entityScope.snapshotCounts(), flightCounts),
    });
  }

  update(input: SourceControllerInput): TsunamiSourceDiagnostics {
    if (this.#destroyed) throw new Error("TsunamiSourceController is destroyed.");
    if (!input.source) return this.#clear(false);
    if (!validSource(input.source)) {
      return this.#clear(true);
    }

    const source = input.source;
    const descriptor = this.#descriptor(source);
    const nextEntitySignature = JSON.stringify(descriptor);
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let invalidInputs = 0;
    if (this.#handle === null) {
      const handle = this.#host.createSourceEntity(descriptor);
      this.#handle = handle;
      this.#entityLease = this.#entityScope.ownEntity(() => this.#host.removeSourceEntity(handle));
      this.#entitySignature = nextEntitySignature;
      created = 1;
    } else if (this.#entitySignature !== nextEntitySignature) {
      this.#host.updateSourceEntity(this.#handle, descriptor);
      this.#entitySignature = nextEntitySignature;
      updated = 1;
    } else {
      unchanged = 1;
    }

    let cameraView = source.camera_view ?? null;
    if (cameraView && !validCameraView(cameraView)) {
      cameraView = null;
      invalidInputs += 1;
    }
    const target = this.#cameraTarget(source, cameraView);
    const mode: SourceCameraMode = input.reference_capture
      ? "reference_capture"
      : input.reduced_motion
        ? "instant"
        : "flight";
    const nextCameraSignature = cameraSignature(target, mode);
    let flightsStarted = 0;
    let flightsCancelled = 0;
    let instantViews = 0;
    let referenceSkips = 0;
    if (nextCameraSignature !== this.#cameraSignature) {
      flightsCancelled = this.#cancelFlight();
      this.#cameraSignature = nextCameraSignature;
      this.#cameraMode = mode;
      if (mode === "reference_capture") {
        referenceSkips = 1;
      } else if (mode === "instant") {
        this.#host.setCameraView(target);
        instantViews = 1;
      } else {
        this.#startFlight(this.#handle, target);
        flightsStarted = 1;
      }
    }

    const operations = freezeOperations({
      ...ZERO_OPERATIONS,
      created,
      updated,
      unchanged,
      invalid_inputs: invalidInputs,
      flights_started: flightsStarted,
      flights_cancelled: flightsCancelled,
      instant_views: instantViews,
      reference_capture_skips: referenceSkips,
    });
    this.#record(operations);
    if (created + updated > 0) this.#host.requestRender();
    return this.diagnostics;
  }

  clear(): TsunamiSourceDiagnostics {
    return this.#clear(false);
  }

  destroy(): TsunamiSourceDiagnostics {
    if (this.#destroyed) return this.diagnostics;
    this.#destroyed = true;
    const flightCancelled = this.#cancelFlight();
    this.#flightScope.destroy();
    const removed = this.#handle === null ? 0 : 1;
    this.#entityScope.destroy();
    this.#handle = null;
    this.#entityLease = null;
    this.#entitySignature = null;
    this.#cameraSignature = null;
    this.#cameraMode = "none";
    this.#record(freezeOperations({ ...ZERO_OPERATIONS, removed, flights_cancelled: flightCancelled }));
    if (removed > 0) this.#host.requestRender();
    return this.diagnostics;
  }

  #clear(fromInvalid: boolean): TsunamiSourceDiagnostics {
    if (this.#destroyed) return this.diagnostics;
    const flightCancelled = this.#cancelFlight();
    const removed = this.#handle === null ? 0 : 1;
    this.#entityLease?.release();
    this.#handle = null;
    this.#entityLease = null;
    this.#entitySignature = null;
    this.#cameraSignature = null;
    this.#cameraMode = "none";
    this.#record(freezeOperations({
      ...ZERO_OPERATIONS,
      removed,
      invalid_inputs: fromInvalid ? 1 : 0,
      flights_cancelled: flightCancelled,
    }));
    if (removed > 0) this.#host.requestRender();
    return this.diagnostics;
  }

  #cancelFlight(): number {
    if (this.#flightScope.snapshotCounts().pendingAsync === 0) return 0;
    this.#host.cancelCameraFlight();
    this.#flightScope.reset();
    return 1;
  }

  #startFlight(handle: Handle, target: SourceCameraTarget): void {
    void this.#flightScope.guardAsync(
      (signal) => this.#host.flyToSource(handle, target, signal),
      { disposeStale() {} },
    ).catch(() => {
      if (this.#destroyed) return;
      const failure = freezeOperations({ ...ZERO_OPERATIONS, flight_failures: 1 });
      this.#record(failure);
    });
  }

  #record(operations: SourceOperationCounts): void {
    this.#revision += 1;
    this.#lastUpdate = operations;
    this.#cumulative = freezeOperations({
      created: this.#cumulative.created + operations.created,
      updated: this.#cumulative.updated + operations.updated,
      removed: this.#cumulative.removed + operations.removed,
      unchanged: this.#cumulative.unchanged + operations.unchanged,
      invalid_inputs: this.#cumulative.invalid_inputs + operations.invalid_inputs,
      flights_started: this.#cumulative.flights_started + operations.flights_started,
      flights_cancelled: this.#cumulative.flights_cancelled + operations.flights_cancelled,
      instant_views: this.#cumulative.instant_views + operations.instant_views,
      reference_capture_skips: this.#cumulative.reference_capture_skips + operations.reference_capture_skips,
      flight_failures: this.#cumulative.flight_failures + operations.flight_failures,
    });
  }

  #descriptor(source: TsunamiSourceInput): TsunamiSourceEntityDescriptor {
    const sourcePosition: SourceGeoPosition = Object.freeze({
      lat_deg: source.center.lat_deg,
      lon_deg: source.center.lon_deg,
      height_m: 0,
    });
    const cavityDepthM = Math.max(2 * source.cavity_radius_m / 2.83, 1);
    return Object.freeze({
      kind: "tsunami_source",
      key: "tsunami:source",
      name: source.label,
      position: sourcePosition,
      point: Object.freeze({
        pixel_size: 12,
        fill: theme("--yellow", "#f9e2af"),
        outline: theme("--crust", "#11111b"),
        outline_width_px: 2,
      }),
      cavity: Object.freeze({
        length_m: cavityDepthM,
        top_radius_m: Math.max(source.cavity_radius_m, 500),
        bottom_radius_m: Math.max(source.cavity_radius_m * 0.3, 250),
        fill: theme("--red", "#f38ba8", 0.3),
        outline: theme("--maroon", "#eba0ac"),
      }),
      rim: Object.freeze({
        semi_major_axis_m: Math.max(source.cavity_radius_m, 1_000),
        semi_minor_axis_m: Math.max(source.cavity_radius_m, 1_000),
        fill: theme("--red", "#f38ba8", 0.18),
        outline: theme("--maroon", "#eba0ac"),
        height_m: 0,
      }),
      label: Object.freeze({
        text: `${source.label}\nA₀ = ${source.peak_amplitude_m.toFixed(1)} m`,
        font: "12px Inter, sans-serif",
        fill: theme("--text", "#cdd6f4"),
        outline: theme("--crust", "#11111b"),
        outline_width_px: 3,
        pixel_offset: Object.freeze([0, -16] as const),
        show_background: true,
        background: theme("--viewport-hud", "#1e1e2e", 0.9),
        background_padding: Object.freeze([8, 6] as const),
      }),
    });
  }

  #cameraTarget(
    source: TsunamiSourceInput,
    view: TsunamiSourceInput["camera_view"],
  ): SourceCameraTarget {
    const range = view
      ? view.range_m
      : Math.min(8e6, Math.max(5e5, source.cavity_radius_m * 25));
    return Object.freeze({
      destination: Object.freeze({ lat_deg: source.center.lat_deg, lon_deg: source.center.lon_deg, height_m: 0 }),
      heading_rad: (view?.heading_deg ?? 0) * Math.PI / 180,
      pitch_rad: (view?.pitch_deg ?? -45) * Math.PI / 180,
      roll_rad: 0,
      range_m: range,
      duration_s: 1.8,
    });
  }
}
