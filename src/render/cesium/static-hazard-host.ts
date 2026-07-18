export type HazardGeoPosition = Readonly<{
  lat_deg: number;
  lon_deg: number;
  height_m: number;
}>;

export type HazardRingEntityDescriptor = Readonly<{
  kind: "hazard_ring";
  key: string;
  name: string;
  description: string;
  position: HazardGeoPosition;
  semi_major_axis_m: number;
  semi_minor_axis_m: number;
  fill_css: string;
  fill_alpha: number;
  outline_css: string;
  outline_alpha: number;
  outline_width_px: number;
  z_order: number;
}>;

export type GroundZeroEntityDescriptor = Readonly<{
  kind: "ground_zero";
  key: "footprint:ground-zero";
  position: HazardGeoPosition;
  pixel_size: number;
  fill_css: string;
  fill_alpha: number;
  outline_css: string;
  outline_alpha: number;
  outline_width_px: number;
  label: string;
}>;

export type FalloutPolygonEntityDescriptor = Readonly<{
  kind: "fallout_polygon";
  key: string;
  name: string;
  description: string;
  points: readonly HazardGeoPosition[];
  fill_css: string;
  fill_alpha: number;
  outline_css: string;
  outline_alpha: number;
}>;

export type StaticHazardEntityDescriptor =
  | HazardRingEntityDescriptor
  | GroundZeroEntityDescriptor
  | FalloutPolygonEntityDescriptor;

/** Adapter boundary implemented by the Cesium integration, and faked by unit tests. */
export interface StaticHazardEntityHost<Handle = unknown> {
  createEntity(key: string, descriptor: StaticHazardEntityDescriptor): Handle;
  updateEntity(handle: Handle, descriptor: StaticHazardEntityDescriptor): void;
  removeEntity(handle: Handle): void;
  requestRender(): void;
}
