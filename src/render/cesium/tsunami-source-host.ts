export type SourceGeoPosition = Readonly<{
  lat_deg: number;
  lon_deg: number;
  height_m: number;
}>;

export type ThemeColorReference = Readonly<{
  token: string;
  fallback_css: string;
  alpha: number;
}>;

export type TsunamiSourceEntityDescriptor = Readonly<{
  kind: "tsunami_source";
  key: "tsunami:source";
  name: string;
  position: SourceGeoPosition;
  point: Readonly<{
    pixel_size: 12;
    fill: ThemeColorReference;
    outline: ThemeColorReference;
    outline_width_px: 2;
  }>;
  cavity: Readonly<{
    length_m: number;
    top_radius_m: number;
    bottom_radius_m: number;
    fill: ThemeColorReference;
    outline: ThemeColorReference;
  }>;
  rim: Readonly<{
    semi_major_axis_m: number;
    semi_minor_axis_m: number;
    fill: ThemeColorReference;
    outline: ThemeColorReference;
    height_m: number;
  }>;
  label: Readonly<{
    text: string;
    font: "12px Inter, sans-serif";
    fill: ThemeColorReference;
    outline: ThemeColorReference;
    outline_width_px: 3;
    pixel_offset: readonly [0, -16];
    show_background: true;
    background: ThemeColorReference;
    background_padding: readonly [8, 6];
  }>;
}>;

export type SourceCameraTarget = Readonly<{
  destination: SourceGeoPosition;
  heading_rad: number;
  pitch_rad: number;
  roll_rad: 0;
  range_m: number;
  duration_s: 1.8;
}>;

export interface TsunamiSourceHost<Handle = unknown> {
  createSourceEntity(descriptor: TsunamiSourceEntityDescriptor): Handle;
  updateSourceEntity(handle: Handle, descriptor: TsunamiSourceEntityDescriptor): void;
  removeSourceEntity(handle: Handle): void;
  cancelCameraFlight(): void;
  flyToSource(handle: Handle, target: SourceCameraTarget, signal: AbortSignal): Promise<boolean>;
  setCameraView(target: SourceCameraTarget): void;
  requestRender(): void;
}
