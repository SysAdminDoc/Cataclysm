use serde::{Deserialize, Serialize};

use crate::data::geodesy::{
    self, EcefPosition, GeodeticPosition, GeographicFieldTile, VerticalAxis, VerticalDatum,
};

pub const PROTOCOL_MAJOR: u16 = 1;
pub const PROTOCOL_MINOR: u16 = 0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolVersion {
    pub major: u16,
    pub minor: u16,
}

impl Default for ProtocolVersion {
    fn default() -> Self {
        Self {
            major: PROTOCOL_MAJOR,
            minor: PROTOCOL_MINOR,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolCapabilitiesV1 {
    pub protocol: ProtocolVersion,
    pub minimum_reader_minor: u16,
    pub features: Vec<String>,
    pub codecs: Vec<FieldCodecV1>,
    pub maximum_header_bytes: u32,
    pub maximum_payload_bytes: u32,
    pub maximum_fields: u16,
    pub maximum_cells: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GeoreferenceV1 {
    pub contract_version: String,
    pub geographic_crs: String,
    pub ecef_crs: String,
    pub origin: GeodeticPosition,
    pub origin_ecef_m: EcefPosition,
    /// Column-major matrix mapping local ENU metres to EPSG:4978 ECEF metres.
    pub local_enu_to_ecef: [f64; 16],
    /// Column-major inverse mapping EPSG:4978 ECEF metres to local ENU metres.
    pub ecef_to_local_enu: [f64; 16],
    pub matrix_order: String,
    pub local_axis_order: [String; 3],
    pub local_unit: String,
    pub unreal_centimetres_per_metre: u16,
}

impl GeoreferenceV1 {
    pub fn from_origin(origin: GeodeticPosition) -> Result<Self, String> {
        let origin_ecef_m = geodesy::geodetic_to_ecef(origin)
            .ok_or_else(|| "georeference origin must be finite normalized WGS84".to_string())?;
        let lat = origin.lat_deg.to_radians();
        let lon = origin.lon_deg.to_radians();
        let east = [-lon.sin(), lon.cos(), 0.0];
        let north = [-lat.sin() * lon.cos(), -lat.sin() * lon.sin(), lat.cos()];
        let up = [lat.cos() * lon.cos(), lat.cos() * lon.sin(), lat.sin()];
        let origin_xyz = [origin_ecef_m.x_m, origin_ecef_m.y_m, origin_ecef_m.z_m];
        let dot = |left: [f64; 3], right: [f64; 3]| {
            left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
        };
        let local_enu_to_ecef = [
            east[0],
            east[1],
            east[2],
            0.0,
            north[0],
            north[1],
            north[2],
            0.0,
            up[0],
            up[1],
            up[2],
            0.0,
            origin_xyz[0],
            origin_xyz[1],
            origin_xyz[2],
            1.0,
        ];
        let ecef_to_local_enu = [
            east[0],
            north[0],
            up[0],
            0.0,
            east[1],
            north[1],
            up[1],
            0.0,
            east[2],
            north[2],
            up[2],
            0.0,
            -dot(east, origin_xyz),
            -dot(north, origin_xyz),
            -dot(up, origin_xyz),
            1.0,
        ];
        Ok(Self {
            contract_version: geodesy::CONTRACT_VERSION.to_string(),
            geographic_crs: geodesy::HORIZONTAL_CRS_GEOGRAPHIC_3D.to_string(),
            ecef_crs: geodesy::HORIZONTAL_CRS_ECEF.to_string(),
            origin,
            origin_ecef_m,
            local_enu_to_ecef,
            ecef_to_local_enu,
            matrix_order: "column_major".to_string(),
            local_axis_order: ["east_x".into(), "north_y".into(), "up_z".into()],
            local_unit: "metre".to_string(),
            unreal_centimetres_per_metre: 100,
        })
    }

    pub fn local_to_ecef(&self, local_enu_m: [f64; 3]) -> [f64; 3] {
        transform_point(self.local_enu_to_ecef, local_enu_m)
    }

    pub fn ecef_to_local(&self, ecef_m: [f64; 3]) -> [f64; 3] {
        transform_point(self.ecef_to_local_enu, ecef_m)
    }
}

fn transform_point(matrix: [f64; 16], point: [f64; 3]) -> [f64; 3] {
    [
        matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
        matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
        matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
    ]
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransformStateV1 {
    pub id: String,
    pub parent_frame: String,
    pub translation_enu_m: [f64; 3],
    pub rotation_xyzw: [f64; 4],
    pub scale: [f32; 3],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKindV1 {
    AsteroidEntry,
    Airburst,
    Impact,
    Fireball,
    BlastFront,
    Crater,
    Ejecta,
    OceanCavity,
    Tsunami,
    NuclearCloud,
    Fallout,
    Earthquake,
    Landslide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventPhaseV1 {
    Scheduled,
    Active,
    Peak,
    Decaying,
    Complete,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScalarQuantityV1 {
    pub semantic: String,
    pub value: f64,
    pub unit: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderEventV1 {
    pub id: String,
    pub kind: EventKindV1,
    pub phase: EventPhaseV1,
    pub start_tick: u64,
    pub peak_tick: Option<u64>,
    pub end_tick: Option<u64>,
    pub transform_id: Option<String>,
    pub quantities: Vec<ScalarQuantityV1>,
    pub field_refs: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldSemanticV1 {
    WaterSurfaceEtaM,
    WaterVelocityEastMS,
    WaterVelocityNorthMS,
    BathymetryDepthM,
    WetMask,
    TemperatureK,
    OverpressurePa,
    FalloutDepositionKgM2,
    FalloutDoseRateSvH,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldDataTypeV1 {
    F32Le,
    BitsetU1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldCodecV1 {
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridGeometryV1 {
    pub nx: u32,
    pub ny: u32,
    pub west_cell_center_lon_deg: f64,
    pub south_cell_center_lat_deg: f64,
    pub dlon_deg: f64,
    pub dlat_deg: f64,
    pub row_order: String,
    pub cell_registration: String,
    pub longitude_wrap: String,
    /// Optional additive tiling metadata for non-wrapping/geocentric uploads.
    /// Empty means a legacy reader should treat the grid as one rectangle.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tiles: Vec<GeographicFieldTile>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FieldDescriptorV1 {
    pub id: String,
    pub semantic: FieldSemanticV1,
    pub data_type: FieldDataTypeV1,
    pub codec: FieldCodecV1,
    pub unit: String,
    pub vertical_datum: Option<VerticalDatum>,
    pub vertical_axis: Option<VerticalAxis>,
    pub grid: GridGeometryV1,
    pub byte_offset: u32,
    pub byte_length: u32,
    pub element_count: u32,
    pub minimum: Option<f64>,
    pub maximum: Option<f64>,
    pub maximum_abs_conversion_error: Option<f64>,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelVersionV1 {
    pub component: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhysicsProvenanceV1 {
    pub authority: String,
    pub model_versions: Vec<ModelVersionV1>,
    pub geodesy_contract_version: String,
    pub surface_mask_version: Option<String>,
    pub bathymetry_asset_id: Option<String>,
    pub solver_backend: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScenarioHeaderV1 {
    pub protocol: ProtocolVersion,
    pub minimum_reader_minor: u16,
    pub required_features: Vec<String>,
    pub scenario_id: String,
    pub scenario_sha256: String,
    pub georeference: GeoreferenceV1,
    pub tick_duration_s: f64,
    pub transforms: Vec<TransformStateV1>,
    pub events: Vec<RenderEventV1>,
    pub provenance: PhysicsProvenanceV1,
    pub payload_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FrameHeaderV1 {
    pub protocol: ProtocolVersion,
    pub minimum_reader_minor: u16,
    pub required_features: Vec<String>,
    pub scenario_id: String,
    pub scenario_sha256: String,
    pub solver_tick: u64,
    pub simulation_time_s: f64,
    pub tick_duration_s: f64,
    pub keyframe: bool,
    pub base_sequence: Option<u64>,
    pub transforms: Vec<TransformStateV1>,
    pub events: Vec<RenderEventV1>,
    pub fields: Vec<FieldDescriptorV1>,
    pub payload_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EndHeaderV1 {
    pub protocol: ProtocolVersion,
    pub minimum_reader_minor: u16,
    pub required_features: Vec<String>,
    pub scenario_id: String,
    pub scenario_sha256: String,
    pub final_tick: u64,
    pub frame_count: u64,
    pub payload_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "packet_kind", rename_all = "snake_case")]
pub enum PacketHeaderV1 {
    Scenario(Box<ScenarioHeaderV1>),
    Frame(FrameHeaderV1),
    End(EndHeaderV1),
}

impl PacketHeaderV1 {
    pub fn kind_code(&self) -> u8 {
        match self {
            Self::Scenario(_) => 1,
            Self::Frame(_) => 2,
            Self::End(_) => 3,
        }
    }

    pub fn protocol(&self) -> ProtocolVersion {
        match self {
            Self::Scenario(value) => value.protocol,
            Self::Frame(value) => value.protocol,
            Self::End(value) => value.protocol,
        }
    }

    pub fn required_features(&self) -> &[String] {
        match self {
            Self::Scenario(value) => &value.required_features,
            Self::Frame(value) => &value.required_features,
            Self::End(value) => &value.required_features,
        }
    }

    pub fn minimum_reader_minor(&self) -> u16 {
        match self {
            Self::Scenario(value) => value.minimum_reader_minor,
            Self::Frame(value) => value.minimum_reader_minor,
            Self::End(value) => value.minimum_reader_minor,
        }
    }

    pub fn payload_sha256(&self) -> &str {
        match self {
            Self::Scenario(value) => &value.payload_sha256,
            Self::Frame(value) => &value.payload_sha256,
            Self::End(value) => &value.payload_sha256,
        }
    }
}
