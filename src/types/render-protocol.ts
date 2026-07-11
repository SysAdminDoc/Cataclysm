/** Canonical renderer-neutral contract mirrored from Rust render_protocol::types. */

export const RENDER_PROTOCOL_MAGIC = "CATRFRM\0";
export const RENDER_PROTOCOL_PRELUDE_BYTES = 32;
export const RENDER_PROTOCOL_MAJOR = 1;
export const RENDER_PROTOCOL_MINOR = 0;
export const RENDER_PROTOCOL_FLAG_KEYFRAME = 0x01;

export const RENDER_PROTOCOL_PACKET_KIND = {
  scenario: 1,
  frame: 2,
  end: 3,
} as const;

export type RenderProtocolPacketKind =
  (typeof RENDER_PROTOCOL_PACKET_KIND)[keyof typeof RENDER_PROTOCOL_PACKET_KIND];

export const RENDER_PROTOCOL_FEATURES = [
  "json_header",
  "raw_f32_fields",
  "bitset_wet_mask",
  "sha256",
  "local_enu",
  "authoritative_tick",
  "codec_none",
] as const;

export type RenderProtocolFeature = (typeof RENDER_PROTOCOL_FEATURES)[number];
export type ProtocolVersion = Readonly<{ major: number; minor: number }>;

export type GeodeticPositionV1 = Readonly<{
  lat_deg: number;
  lon_deg: number;
  ellipsoid_height_m: number;
}>;

export type EcefPositionV1 = Readonly<{ x_m: number; y_m: number; z_m: number }>;

export type GeoreferenceV1 = Readonly<{
  contract_version: string;
  geographic_crs: string;
  ecef_crs: string;
  origin: GeodeticPositionV1;
  origin_ecef_m: EcefPositionV1;
  local_enu_to_ecef: readonly number[];
  ecef_to_local_enu: readonly number[];
  matrix_order: string;
  local_axis_order: readonly string[];
  local_unit: string;
  unreal_centimetres_per_metre: number;
}>;

export type TransformStateV1 = Readonly<{
  id: string;
  parent_frame: string;
  translation_enu_m: readonly [number, number, number];
  rotation_xyzw: readonly [number, number, number, number];
  scale: readonly [number, number, number];
}>;

export type EventKindV1 =
  | "asteroid_entry"
  | "airburst"
  | "impact"
  | "fireball"
  | "blast_front"
  | "crater"
  | "ejecta"
  | "ocean_cavity"
  | "tsunami"
  | "nuclear_cloud"
  | "fallout"
  | "earthquake"
  | "landslide";

export type EventPhaseV1 = "scheduled" | "active" | "peak" | "decaying" | "complete";

export type ScalarQuantityV1 = Readonly<{
  semantic: string;
  value: number;
  unit: string;
}>;

export type RenderEventV1 = Readonly<{
  id: string;
  kind: EventKindV1;
  phase: EventPhaseV1;
  start_tick: number;
  peak_tick: number | null;
  end_tick: number | null;
  transform_id: string | null;
  quantities: readonly ScalarQuantityV1[];
  field_refs: readonly string[];
}>;

export type FieldSemanticV1 =
  | "water_surface_eta_m"
  | "water_velocity_east_m_s"
  | "water_velocity_north_m_s"
  | "bathymetry_depth_m"
  | "wet_mask"
  | "temperature_k"
  | "overpressure_pa"
  | "fallout_deposition_kg_m2"
  | "fallout_dose_rate_sv_h";

export type FieldDataTypeV1 = "f32_le" | "bitset_u1";
export type FieldCodecV1 = "none";
export type VerticalDatumV1 =
  | "wgs84_ellipsoid"
  | "navd88_geoid18"
  | "idealized_mean_sea_level"
  | "depth_below_idealized_mean_sea_level"
  | "local_enu";
export type VerticalAxisV1 = "positive_up" | "positive_down";

export type GridGeometryV1 = Readonly<{
  nx: number;
  ny: number;
  west_cell_center_lon_deg: number;
  south_cell_center_lat_deg: number;
  dlon_deg: number;
  dlat_deg: number;
  row_order: string;
  cell_registration: string;
  longitude_wrap: string;
}>;

export type FieldDescriptorV1 = Readonly<{
  id: string;
  semantic: FieldSemanticV1;
  data_type: FieldDataTypeV1;
  codec: FieldCodecV1;
  unit: string;
  vertical_datum: VerticalDatumV1 | null;
  vertical_axis: VerticalAxisV1 | null;
  grid: GridGeometryV1;
  byte_offset: number;
  byte_length: number;
  element_count: number;
  minimum: number | null;
  maximum: number | null;
  maximum_abs_conversion_error: number | null;
  sha256: string;
}>;

export type ModelVersionV1 = Readonly<{ component: string; version: string }>;

export type PhysicsProvenanceV1 = Readonly<{
  authority: string;
  model_versions: readonly ModelVersionV1[];
  geodesy_contract_version: string;
  surface_mask_version: string | null;
  bathymetry_asset_id: string | null;
  solver_backend: string;
}>;

type PacketCompatibilityV1 = Readonly<{
  protocol: ProtocolVersion;
  minimum_reader_minor: number;
  required_features: readonly RenderProtocolFeature[];
}>;

export type ScenarioHeaderV1 = PacketCompatibilityV1 &
  Readonly<{
    packet_kind: "scenario";
    scenario_id: string;
    scenario_sha256: string;
    georeference: GeoreferenceV1;
    tick_duration_s: number;
    transforms: readonly TransformStateV1[];
    events: readonly RenderEventV1[];
    provenance: PhysicsProvenanceV1;
    payload_sha256: string;
  }>;

export type FrameHeaderV1 = PacketCompatibilityV1 &
  Readonly<{
    packet_kind: "frame";
    scenario_id: string;
    scenario_sha256: string;
    solver_tick: number;
    simulation_time_s: number;
    tick_duration_s: number;
    keyframe: boolean;
    base_sequence: number | null;
    transforms: readonly TransformStateV1[];
    events: readonly RenderEventV1[];
    fields: readonly FieldDescriptorV1[];
    payload_sha256: string;
  }>;

export type EndHeaderV1 = PacketCompatibilityV1 &
  Readonly<{
    packet_kind: "end";
    scenario_id: string;
    scenario_sha256: string;
    final_tick: number;
    frame_count: number;
    payload_sha256: string;
  }>;

export type PacketHeaderV1 = ScenarioHeaderV1 | FrameHeaderV1 | EndHeaderV1;

export type RenderPacketPrelude = Readonly<{
  major: number;
  minor: number;
  kind: RenderProtocolPacketKind;
  flags: number;
  header_len: number;
  payload_len: number;
  sequence: bigint;
}>;

export type F32LeFieldView = Readonly<{
  data_type: "f32_le";
  length: number;
  at(index: number): number;
  toFloat32Array(): Float32Array;
}>;

export type BitsetU1FieldView = Readonly<{
  data_type: "bitset_u1";
  length: number;
  at(index: number): 0 | 1;
  toUint8Array(): Uint8Array;
  toPackedBytes(): Uint8Array;
}>;

export type RenderFieldView = F32LeFieldView | BitsetU1FieldView;

export type DecodedScenarioPacket = Readonly<{
  kind: "scenario";
  prelude: RenderPacketPrelude;
  header: ScenarioHeaderV1;
}>;

export type DecodedFramePacket = Readonly<{
  kind: "frame";
  prelude: RenderPacketPrelude;
  header: FrameHeaderV1;
  fields: Readonly<Record<string, RenderFieldView>>;
}>;

export type DecodedEndPacket = Readonly<{
  kind: "end";
  prelude: RenderPacketPrelude;
  header: EndHeaderV1;
}>;

export type DecodedRenderPacket = DecodedScenarioPacket | DecodedFramePacket | DecodedEndPacket;

/** Projection-only view. No renderer is allowed to derive authoritative state here. */
export type RendererNeutralFrameView = Readonly<{
  sequence: bigint;
  scenario_id: string;
  scenario_sha256: string;
  solver_tick: number;
  simulation_time_s: number;
  tick_duration_s: number;
  payload_sha256: string;
  keyframe: boolean;
  base_sequence: number | null;
  georeference: GeoreferenceV1;
  transforms: readonly TransformStateV1[];
  events: readonly RenderEventV1[];
  fields: Readonly<Record<string, RenderFieldView>>;
}>;
