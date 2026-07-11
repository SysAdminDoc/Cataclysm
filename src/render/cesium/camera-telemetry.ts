export type CameraTelemetry = Readonly<{
  lat: number;
  lon: number;
  altitudeM: number;
  headingDeg: number;
}>;

export interface CameraTelemetryHost {
  read(): CameraTelemetry;
  subscribe(listener: () => void): () => void;
}

/** Owns the camera listener and guarantees idempotent teardown. */
export class CameraTelemetryController {
  readonly #host: CameraTelemetryHost;
  readonly #sink: (telemetry: CameraTelemetry) => void;
  #unsubscribe: (() => void) | null = null;
  #destroyed = false;
  #emissions = 0;

  constructor(host: CameraTelemetryHost, sink: (telemetry: CameraTelemetry) => void) {
    this.#host = host;
    this.#sink = sink;
  }

  start(): void {
    if (this.#destroyed || this.#unsubscribe) return;
    const emit = () => {
      if (this.#destroyed) return;
      this.#sink(this.#host.read());
      this.#emissions += 1;
    };
    this.#unsubscribe = this.#host.subscribe(emit);
    emit();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  diagnostics(): Readonly<{ listeners: number; emissions: number; destroyed: boolean }> {
    return Object.freeze({
      listeners: this.#unsubscribe ? 1 : 0,
      emissions: this.#emissions,
      destroyed: this.#destroyed,
    });
  }
}
