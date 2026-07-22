import { ResourceScope } from "./resources";

export type OutcomeFocusRequest = Readonly<{
  /** Unique interaction token. Reusing a token with unchanged values is a no-op. */
  request_id: string;
  place: Readonly<{
    label?: string;
    lat_deg: number;
    lon_deg: number;
    range_m?: number;
  }>;
  simulation_time_s: number;
  heading_deg?: number;
  pitch_deg?: number;
  /** State restoration uses an exact camera pose instead of a time-based flight. */
  instant?: boolean;
}>;

export type OutcomeFocusTarget = Readonly<{
  lat_deg: number;
  lon_deg: number;
  range_m: number;
  heading_rad: number;
  pitch_rad: number;
  duration_s: number;
  label?: string;
}>;

export interface OutcomeFocusHost {
  cancelCameraFlight(): void;
  flyTo(target: OutcomeFocusTarget, signal: AbortSignal): Promise<boolean>;
  setCameraView(target: OutcomeFocusTarget): void;
  focusSimulationTime(time_s: number): void;
  requestRender(): void;
  showFocus?(target: OutcomeFocusTarget): void;
  clearFocus?(): void;
}

export type OutcomeFocusMode = "none" | "flight" | "instant" | "reference_capture";

export type OutcomeFocusDiagnostics = Readonly<{
  generation: number;
  destroyed: boolean;
  mode: OutcomeFocusMode;
  active_request_id: string | null;
  pending_flights: number;
  requests_applied: number;
  invalid_requests: number;
  flights_cancelled: number;
  flight_failures: number;
}>;

function validRequest(request: OutcomeFocusRequest): boolean {
  return request.request_id.trim().length > 0
    && Number.isFinite(request.place.lat_deg)
    && request.place.lat_deg >= -90
    && request.place.lat_deg <= 90
    && Number.isFinite(request.place.lon_deg)
    && request.place.lon_deg >= -180
    && request.place.lon_deg <= 180
    && Number.isFinite(request.simulation_time_s)
    && request.simulation_time_s >= 0
    && (request.place.range_m === undefined
      || (Number.isFinite(request.place.range_m) && request.place.range_m > 0))
    && (request.heading_deg === undefined || Number.isFinite(request.heading_deg))
    && (request.pitch_deg === undefined || Number.isFinite(request.pitch_deg))
    && (request.instant === undefined || typeof request.instant === "boolean");
}

function targetFor(request: OutcomeFocusRequest, instant: boolean): OutcomeFocusTarget {
  return Object.freeze({
    lat_deg: request.place.lat_deg,
    lon_deg: request.place.lon_deg,
    range_m: Math.max(20_000, request.place.range_m ?? 350_000),
    heading_rad: (request.heading_deg ?? 0) * Math.PI / 180,
    pitch_rad: (request.pitch_deg ?? -55) * Math.PI / 180,
    duration_s: instant ? 0 : 0.9,
    ...(request.place.label?.trim() ? { label: request.place.label.trim() } : {}),
  });
}

/** Owns result-driven place/time focus without allowing stale camera flights. */
export class OutcomeFocusController {
  readonly #host: OutcomeFocusHost;
  readonly #scope: ResourceScope;
  #signature: string | null = null;
  #activeRequestId: string | null = null;
  #mode: OutcomeFocusMode = "none";
  #destroyed = false;
  #requestsApplied = 0;
  #invalidRequests = 0;
  #flightsCancelled = 0;
  #flightFailures = 0;

  constructor(host: OutcomeFocusHost, generation: number) {
    this.#host = host;
    this.#scope = new ResourceScope(generation);
  }

  get diagnostics(): OutcomeFocusDiagnostics {
    return Object.freeze({
      generation: this.#scope.generation,
      destroyed: this.#destroyed,
      mode: this.#mode,
      active_request_id: this.#activeRequestId,
      pending_flights: this.#scope.snapshotCounts().pendingAsync,
      requests_applied: this.#requestsApplied,
      invalid_requests: this.#invalidRequests,
      flights_cancelled: this.#flightsCancelled,
      flight_failures: this.#flightFailures,
    });
  }

  update(
    request: OutcomeFocusRequest | null,
    options: Readonly<{ reduced_motion: boolean; reference_capture: boolean }>,
  ): OutcomeFocusDiagnostics {
    if (this.#destroyed) throw new Error("OutcomeFocusController is destroyed.");
    if (!request) {
      this.#clear();
      return this.diagnostics;
    }
    if (!validRequest(request)) {
      this.#invalidRequests += 1;
      this.#clear();
      return this.diagnostics;
    }

    const signature = JSON.stringify({ request, options });
    if (signature === this.#signature) return this.diagnostics;
    const cancelledOwnedFlight = this.#cancelFlight();
    this.#signature = signature;
    this.#activeRequestId = request.request_id;

    if (options.reference_capture) {
      this.#mode = "reference_capture";
      return this.diagnostics;
    }

    // Other globe products (source, hazard, preview) also own camera flights.
    // An explicit result selection wins that arbitration even when this
    // controller does not currently own the in-flight request.
    if (!cancelledOwnedFlight) this.#host.cancelCameraFlight();
    const instant = options.reduced_motion || request.instant === true;
    const target = targetFor(request, instant);
    this.#host.showFocus?.(target);
    this.#host.focusSimulationTime(request.simulation_time_s);
    this.#requestsApplied += 1;
    if (instant) {
      this.#mode = "instant";
      this.#host.setCameraView(target);
      this.#host.requestRender();
    } else {
      this.#mode = "flight";
      void this.#scope.guardAsync(
        (signal) => this.#host.flyTo(target, signal),
        { disposeStale() {} },
      ).catch(() => {
        if (!this.#destroyed) this.#flightFailures += 1;
      });
    }
    return this.diagnostics;
  }

  destroy(): OutcomeFocusDiagnostics {
    if (this.#destroyed) return this.diagnostics;
    this.#destroyed = true;
    this.#cancelFlight();
    this.#scope.destroy();
    this.#host.clearFocus?.();
    this.#signature = null;
    this.#activeRequestId = null;
    this.#mode = "none";
    return this.diagnostics;
  }

  #clear(): void {
    this.#cancelFlight();
    this.#signature = null;
    this.#activeRequestId = null;
    this.#mode = "none";
    this.#host.clearFocus?.();
  }

  #cancelFlight(): boolean {
    if (this.#scope.snapshotCounts().pendingAsync === 0) return false;
    this.#host.cancelCameraFlight();
    this.#scope.reset();
    this.#flightsCancelled += 1;
    return true;
  }
}
