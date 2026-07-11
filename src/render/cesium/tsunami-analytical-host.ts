export type AnalyticalGeoPosition = Readonly<{
  lat_deg: number;
  lon_deg: number;
  height_m: number;
}>;

export type WavefrontRingDescriptor = Readonly<{
  kind: "wavefront_ring";
  key: string;
  position: AnalyticalGeoPosition;
  semi_major_axis_m: number;
  semi_minor_axis_m: number;
  fill_css: "#74c7ec";
  fill_alpha: 0;
  outline_css: "#74c7ec";
  outline_alpha: number;
}>;

export type IsochronePolylineDescriptor = Readonly<{
  kind: "isochrone_polyline";
  key: string;
  positions: readonly AnalyticalGeoPosition[];
  width_px: 1.6;
  color_css: "#f9e2af";
  alpha: 0.85;
  dash_length_px: 12;
  clamp_to_ground: false;
}>;

export type IsochroneLabelDescriptor = Readonly<{
  kind: "isochrone_label";
  key: string;
  position: AnalyticalGeoPosition;
  text: string;
  font: "11px 'JetBrains Mono', monospace";
  fill_css: "#f9e2af";
  outline_css: "#000000";
  outline_alpha: 0.7;
  outline_width_px: 2;
  scale: 1;
  disable_depth_test_distance_m: number;
}>;

export type DartBuoyDescriptor = Readonly<{
  kind: "dart_buoy";
  key: string;
  name: string;
  position: AnalyticalGeoPosition;
  pixel_size: 9;
  fill_css: "#eba0ac";
  outline_css: "#11111b";
  outline_width_px: 2;
  label: string;
  label_font: "10px Inter, sans-serif";
  label_pixel_offset: readonly [0, 10];
  label_scale: 0.85;
  distance_display_min_m: 0;
  distance_display_max_m: 15_000_000;
}>;

export type TsunamiAnalyticalEntityDescriptor =
  | WavefrontRingDescriptor
  | IsochronePolylineDescriptor
  | IsochroneLabelDescriptor
  | DartBuoyDescriptor;

export interface TsunamiAnalyticalEntityHost<Handle = unknown> {
  createEntity(key: string, descriptor: TsunamiAnalyticalEntityDescriptor): Handle;
  updateEntity(handle: Handle, descriptor: TsunamiAnalyticalEntityDescriptor): void;
  removeEntity(handle: Handle): void;
  requestRender(): void;
}
