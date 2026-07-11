import type {
  RenderEventV1,
  RendererNeutralFrameView,
  TransformStateV1,
} from "../../types/render-protocol";

export type DirectImpactKind = "asteroid" | "nuclear" | null;
export type EcefPoint = readonly [number, number, number];

export type DirectEllipseState = Readonly<{
  centerEcefM: EcefPoint;
  semiMajorM: number;
  semiMinorM: number;
}>;

export type DirectPointState = Readonly<{
  positionEcefM: EcefPoint;
  radiusM: number;
}>;

export type DirectPolylineState = Readonly<{
  positionsEcefM: readonly [EcefPoint, EcefPoint];
}>;

export type DirectCylinderState = Readonly<{
  centerEcefM: EcefPoint;
  heightM: number;
}>;

export interface DirectEffectsHost<Handle = unknown> {
  createEllipse(id: string, state: DirectEllipseState): Handle;
  updateEllipse(handle: Handle, state: DirectEllipseState): void;
  createPoint(id: string, state: DirectPointState): Handle;
  updatePoint(handle: Handle, state: DirectPointState): void;
  createPolyline(id: string, state: DirectPolylineState): Handle;
  updatePolyline(handle: Handle, state: DirectPolylineState): void;
  createCylinder(id: string, state: DirectCylinderState): Handle;
  updateCylinder(handle: Handle, state: DirectCylinderState): void;
  remove(handle: Handle): void;
}

export type DirectEffectsDiagnostics = Readonly<{
  ellipses: number;
  points: number;
  polylines: number;
  cylinders: number;
  total: number;
  created: number;
  updated: number;
  removed: number;
  destroyed: boolean;
}>;

type EffectKind = "ellipse" | "point" | "polyline" | "cylinder";
type DesiredEffect =
  | Readonly<{ kind: "ellipse"; state: DirectEllipseState }>
  | Readonly<{ kind: "point"; state: DirectPointState }>
  | Readonly<{ kind: "polyline"; state: DirectPolylineState }>
  | Readonly<{ kind: "cylinder"; state: DirectCylinderState }>;
type OwnedEffect<Handle> = Readonly<{ kind: EffectKind; handle: Handle }>;

const VISIBLE_PHASES = new Set<RenderEventV1["phase"]>(["active", "peak", "decaying"]);

function quantity(event: RenderEventV1, semantic: string): number | null {
  const value = event.quantities.find((candidate) => candidate.semantic === semantic)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveQuantity(event: RenderEventV1, semantic: string): number | null {
  const value = quantity(event, semantic);
  return value !== null && value > 0 ? value : null;
}

function originEcef(frame: RendererNeutralFrameView): EcefPoint {
  const origin = frame.georeference.origin_ecef_m;
  return [origin.x_m, origin.y_m, origin.z_m];
}

function localToEcef(frame: RendererNeutralFrameView, local: readonly [number, number, number]): EcefPoint {
  const matrix = frame.georeference.local_enu_to_ecef;
  return [
    matrix[0] * local[0] + matrix[4] * local[1] + matrix[8] * local[2] + matrix[12],
    matrix[1] * local[0] + matrix[5] * local[1] + matrix[9] * local[2] + matrix[13],
    matrix[2] * local[0] + matrix[6] * local[1] + matrix[10] * local[2] + matrix[14],
  ];
}

function transformPosition(
  frame: RendererNeutralFrameView,
  transforms: ReadonlyMap<string, TransformStateV1>,
  transformId: string | null,
): EcefPoint {
  const transform = transformId === null ? undefined : transforms.get(transformId);
  return transform ? localToEcef(frame, transform.translation_enu_m) : originEcef(frame);
}

function addEllipse(
  desired: Map<string, DesiredEffect>,
  id: string,
  centerEcefM: EcefPoint,
  semiMajorM: number | null,
  semiMinorM = semiMajorM,
): void {
  if (semiMajorM === null || semiMinorM === null || semiMajorM <= 0 || semiMinorM <= 0) return;
  desired.set(id, { kind: "ellipse", state: { centerEcefM, semiMajorM, semiMinorM } });
}

function projectEvent(
  desired: Map<string, DesiredEffect>,
  frame: RendererNeutralFrameView,
  transforms: ReadonlyMap<string, TransformStateV1>,
  event: RenderEventV1,
): void {
  if (!VISIBLE_PHASES.has(event.phase)) return;
  const center = transformPosition(frame, transforms, event.transform_id);

  switch (event.kind) {
    case "asteroid_entry": {
      const radiusM = positiveQuantity(event, "body_radius");
      if (radiusM === null) return;
      desired.set(`${event.id}:body_radius:point`, {
        kind: "point",
        state: { positionEcefM: center, radiusM },
      });
      desired.set(`${event.id}:body_path:polyline`, {
        kind: "polyline",
        state: { positionsEcefM: [center, originEcef(frame)] },
      });
      return;
    }
    case "fireball": {
      const semantic = positiveQuantity(event, "flash_current_radius") !== null
        ? "flash_current_radius"
        : "maximum_radius";
      addEllipse(desired, `${event.id}:${semantic}:ellipse`, center, positiveQuantity(event, semantic));
      return;
    }
    case "blast_front":
      addEllipse(desired, `${event.id}:current_radius:ellipse`, center, positiveQuantity(event, "current_radius"));
      return;
    case "crater":
      // Crater geometry is represented by the reviewed static footprint layer.
      // Do not double-render a second protocol ellipse over that product.
      return;
    case "ocean_cavity": {
      const heightM = positiveQuantity(event, "current_height");
      if (heightM !== null) {
        desired.set(`${event.id}:current_height:cylinder`, {
          kind: "cylinder",
          state: { centerEcefM: center, heightM },
        });
      }
      return;
    }
    case "tsunami":
      for (const semantic of ["wave_0_radius", "wave_1_radius", "wave_2_radius"] as const) {
        addEllipse(desired, `${event.id}:${semantic}:ellipse`, center, positiveQuantity(event, semantic));
      }
      return;
    case "nuclear_cloud":
    case "fallout":
      // These products remain in the authoritative protocol but are rendered
      // by their dedicated static overlay until volumetric systems land.
      return;
    default:
      return;
  }
}

/**
 * Projects Rust-authored direct-hazard frame state into stable host handles.
 * It performs coordinate conversion only; it does not derive physics, advance
 * time, interpolate frames, or synthesize missing protocol quantities.
 */
export class DirectEffectsController<Handle = unknown> {
  readonly #host: DirectEffectsHost<Handle>;
  readonly #owned = new Map<string, OwnedEffect<Handle>>();
  #created = 0;
  #updated = 0;
  #removed = 0;
  #destroyed = false;

  constructor(host: DirectEffectsHost<Handle>) {
    this.#host = host;
  }

  update(impactKind: DirectImpactKind, frame: RendererNeutralFrameView | null): void {
    if (this.#destroyed) throw new Error("DirectEffectsController is destroyed.");
    if (impactKind === null || frame === null) {
      this.clear();
      return;
    }

    const desired = new Map<string, DesiredEffect>();
    const transforms = new Map(frame.transforms.map((transform) => [transform.id, transform]));
    for (const event of frame.events) {
      if (!event.id.startsWith(`${impactKind}-`)) continue;
      projectEvent(desired, frame, transforms, event);
    }
    this.#reconcile(desired);
  }

  clear(): void {
    if (this.#destroyed || this.#owned.size === 0) return;
    for (const effect of this.#owned.values()) {
      this.#host.remove(effect.handle);
      this.#removed += 1;
    }
    this.#owned.clear();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.clear();
    this.#destroyed = true;
  }

  diagnostics(): DirectEffectsDiagnostics {
    let ellipses = 0;
    let points = 0;
    let polylines = 0;
    let cylinders = 0;
    for (const effect of this.#owned.values()) {
      if (effect.kind === "ellipse") ellipses += 1;
      else if (effect.kind === "point") points += 1;
      else if (effect.kind === "polyline") polylines += 1;
      else cylinders += 1;
    }
    return Object.freeze({
      ellipses,
      points,
      polylines,
      cylinders,
      total: this.#owned.size,
      created: this.#created,
      updated: this.#updated,
      removed: this.#removed,
      destroyed: this.#destroyed,
    });
  }

  #reconcile(desired: ReadonlyMap<string, DesiredEffect>): void {
    for (const [id, owned] of this.#owned) {
      const next = desired.get(id);
      if (!next || next.kind !== owned.kind) {
        this.#host.remove(owned.handle);
        this.#owned.delete(id);
        this.#removed += 1;
      }
    }

    for (const [id, effect] of desired) {
      const owned = this.#owned.get(id);
      if (owned) {
        this.#updateOwned(owned, effect);
        this.#updated += 1;
      } else {
        this.#owned.set(id, { kind: effect.kind, handle: this.#create(id, effect) });
        this.#created += 1;
      }
    }
  }

  #create(id: string, effect: DesiredEffect): Handle {
    if (effect.kind === "ellipse") return this.#host.createEllipse(id, effect.state);
    if (effect.kind === "point") return this.#host.createPoint(id, effect.state);
    if (effect.kind === "polyline") return this.#host.createPolyline(id, effect.state);
    return this.#host.createCylinder(id, effect.state);
  }

  #updateOwned(owned: OwnedEffect<Handle>, effect: DesiredEffect): void {
    if (effect.kind === "ellipse") this.#host.updateEllipse(owned.handle, effect.state);
    else if (effect.kind === "point") this.#host.updatePoint(owned.handle, effect.state);
    else if (effect.kind === "polyline") this.#host.updatePolyline(owned.handle, effect.state);
    else this.#host.updateCylinder(owned.handle, effect.state);
  }
}
