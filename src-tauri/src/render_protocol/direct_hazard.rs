//! Direct-hazard adapters for the renderer protocol.
//!
//! These adapters sample the existing Cesium presentation sequence at the
//! authoritative 0.1 second protocol tick. Clients receive explicit local-ENU
//! transforms, radii, heights, and event intervals; they never reconstruct the
//! asteroid path, blast expansion, splash, or wavefront dimensions.

use crate::data::geodesy::{self, GeodeticPosition};
use crate::physics::direct_hazard::{
    AsteroidDetail, AsteroidHazardRequest, FalloutPlume, HazardDetail, HazardResult, NuclearDetail,
    NuclearHazardRequest, simulate_asteroid_hazard, simulate_nuclear_hazard,
};

use super::{
    EndHeaderV1, EventKindV1, EventPhaseV1, FrameHeaderV1, GeoreferenceV1, ModelVersionV1,
    PacketHeaderV1, PhysicsProvenanceV1, ProtocolVersion, RenderEventV1, ScalarQuantityV1,
    ScenarioHeaderV1, TransformStateV1, capabilities, encode_packet, sha256_hex,
};

const TICK_DURATION_S: f64 = 0.1;
const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ASTEROID_ENTRY_END_TICK: u64 = 50;
const ASTEROID_DRY_END_TICK: u64 = 76;
const ASTEROID_WATER_END_TICK: u64 = 102;
const NUCLEAR_END_TICK: u64 = 24;

#[derive(Debug, Clone)]
struct AsteroidSequence {
    start_enu_m: [f64; 3],
    body_radius_m: f64,
    outer_radius_m: f64,
    flash_max_radius_m: f64,
    splash_max_height_m: f64,
    wave_reach_m: f64,
    final_tick: u64,
}

pub fn asteroid_render_recording(
    request: &AsteroidHazardRequest,
) -> Result<(HazardResult, Vec<Vec<u8>>), String> {
    let canonical_request = serde_json::to_vec(request)
        .map_err(|error| format!("serialize asteroid protocol request: {error}"))?;
    let result = simulate_asteroid_hazard(request.clone())?;
    let HazardDetail::Asteroid(detail) = &result.detail else {
        return Err("asteroid model returned a non-asteroid detail".into());
    };
    let sequence = asteroid_sequence(request, &result, detail);
    let scenario_hash = sha256_hex(&canonical_request);
    let scenario_id = format!("asteroid-{}", &scenario_hash[..16]);
    let origin = center_origin(result.center.lat, result.center.lon);
    let mut packets = vec![scenario_packet(
        &scenario_id,
        &scenario_hash,
        origin,
        result.model_version,
        "asteroid",
        asteroid_transforms(sequence.start_enu_m, 0),
        scheduled(asteroid_events(detail, &sequence, 0)),
    )?];

    for tick in 0..=sequence.final_tick {
        packets.push(frame_packet(
            &scenario_id,
            &scenario_hash,
            tick,
            asteroid_transforms(sequence.start_enu_m, tick),
            asteroid_events(detail, &sequence, tick),
            tick + 1,
        )?);
    }
    packets.push(end_protocol_packet(
        &scenario_id,
        &scenario_hash,
        sequence.final_tick,
        sequence.final_tick + 1,
        sequence.final_tick + 2,
    )?);
    Ok((result, packets))
}

pub fn nuclear_render_recording(
    request: &NuclearHazardRequest,
) -> Result<(HazardResult, Vec<Vec<u8>>), String> {
    let canonical_request = serde_json::to_vec(request)
        .map_err(|error| format!("serialize nuclear protocol request: {error}"))?;
    let result = simulate_nuclear_hazard(request.clone())?;
    let HazardDetail::Nuclear(detail) = &result.detail else {
        return Err("nuclear model returned a non-nuclear detail".into());
    };
    let scenario_hash = sha256_hex(&canonical_request);
    let scenario_id = format!("nuclear-{}", &scenario_hash[..16]);
    let origin = center_origin(result.center.lat, result.center.lon);
    let transforms = vec![origin_transform()];
    let mut packets = vec![scenario_packet(
        &scenario_id,
        &scenario_hash,
        origin,
        result.model_version,
        "nuclear",
        transforms.clone(),
        scheduled(nuclear_events(detail, &result, 0)),
    )?];

    for tick in 0..=NUCLEAR_END_TICK {
        packets.push(frame_packet(
            &scenario_id,
            &scenario_hash,
            tick,
            transforms.clone(),
            nuclear_events(detail, &result, tick),
            tick + 1,
        )?);
    }
    packets.push(end_protocol_packet(
        &scenario_id,
        &scenario_hash,
        NUCLEAR_END_TICK,
        NUCLEAR_END_TICK + 1,
        NUCLEAR_END_TICK + 2,
    )?);
    Ok((result, packets))
}

fn asteroid_sequence(
    request: &AsteroidHazardRequest,
    result: &HazardResult,
    detail: &AsteroidDetail,
) -> AsteroidSequence {
    let outer_radius_m = maximum_ring_radius(result);
    let base_scale_m = outer_radius_m.max(3_000.0);
    let start_altitude_m = base_scale_m * 1.3;
    let angle_rad = request.angle_deg.clamp(8.0, 89.0).to_radians();
    let horizontal_m = (start_altitude_m / angle_rad.tan()).min(start_altitude_m * 1.3);
    let bearing_rad = 315_f64.to_radians();
    let start_enu_m = [
        horizontal_m * bearing_rad.sin(),
        horizontal_m * bearing_rad.cos(),
        start_altitude_m,
    ];
    AsteroidSequence {
        start_enu_m,
        body_radius_m: request.diameter_m * 0.5,
        outer_radius_m,
        flash_max_radius_m: (outer_radius_m * 0.5).max(3_000.0),
        splash_max_height_m: (base_scale_m * 0.5).max(4_000.0),
        wave_reach_m: (outer_radius_m * 4.0).clamp(60_000.0, 700_000.0),
        final_tick: if detail.tsunami.applies {
            ASTEROID_WATER_END_TICK
        } else {
            ASTEROID_DRY_END_TICK
        },
    }
}

fn asteroid_transforms(start_enu_m: [f64; 3], tick: u64) -> Vec<TransformStateV1> {
    let progress =
        (tick.min(ASTEROID_ENTRY_END_TICK) as f64 / ASTEROID_ENTRY_END_TICK as f64).powi(2);
    let remaining = 1.0 - progress;
    vec![
        origin_transform(),
        TransformStateV1 {
            id: "asteroid-body".into(),
            parent_frame: "local_enu".into(),
            translation_enu_m: [
                start_enu_m[0] * remaining,
                start_enu_m[1] * remaining,
                start_enu_m[2] * remaining,
            ],
            rotation_xyzw: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0, 1.0, 1.0],
        },
    ]
}

fn asteroid_events(
    detail: &AsteroidDetail,
    sequence: &AsteroidSequence,
    tick: u64,
) -> Vec<RenderEventV1> {
    let mut events = vec![
        event(
            "asteroid-entry",
            EventKindV1::AsteroidEntry,
            tick,
            0,
            Some(ASTEROID_ENTRY_END_TICK),
            Some(ASTEROID_ENTRY_END_TICK),
            "asteroid-body",
            vec![
                metres("body_radius", sequence.body_radius_m),
                metres_per_second("impact_velocity", detail.atmospheric_entry.impact_velocity),
                joules("kinetic_energy", detail.kinetic_energy_j),
            ],
        ),
        event(
            "asteroid-impact",
            EventKindV1::Impact,
            tick,
            ASTEROID_ENTRY_END_TICK,
            Some(ASTEROID_ENTRY_END_TICK),
            Some(ASTEROID_ENTRY_END_TICK),
            "scenario-origin",
            vec![joules(
                "deposited_energy",
                detail.atmospheric_entry.airburst_energy,
            )],
        ),
    ];

    let flash_progress = normalized_tick(tick, ASTEROID_ENTRY_END_TICK, 55);
    let flash_radius_m = if tick > 55 {
        0.0
    } else {
        (0.3 + 1.7 * flash_progress) * (sequence.outer_radius_m * 0.25).max(1_500.0)
    };
    events.push(event(
        "asteroid-fireball",
        EventKindV1::Fireball,
        tick,
        ASTEROID_ENTRY_END_TICK,
        Some(52),
        Some(55),
        "scenario-origin",
        vec![
            metres("physical_radius", detail.fireball_radius_m),
            metres("flash_current_radius", flash_radius_m),
            metres("flash_max_radius", sequence.flash_max_radius_m),
        ],
    ));

    let blast_progress = normalized_tick(tick, ASTEROID_ENTRY_END_TICK, 70);
    let blast_current_m = if tick >= 70 {
        0.0
    } else {
        (1.0 - (1.0 - blast_progress).powi(3)) * sequence.outer_radius_m
    };
    events.push(event(
        "asteroid-blast",
        EventKindV1::BlastFront,
        tick,
        ASTEROID_ENTRY_END_TICK,
        Some(69),
        Some(70),
        "scenario-origin",
        vec![
            metres("current_radius", blast_current_m),
            metres("maximum_radius", sequence.outer_radius_m),
            metres("window_breakage_radius", detail.radius_window_breakage_m),
            metres("severe_damage_radius", detail.radius_severe_damage_m),
            metres(
                "total_destruction_radius",
                detail.radius_total_destruction_m,
            ),
        ],
    ));

    if let Some(crater) = &detail.crater {
        events.push(event(
            "asteroid-crater",
            EventKindV1::Crater,
            tick,
            ASTEROID_ENTRY_END_TICK,
            Some(ASTEROID_ENTRY_END_TICK),
            None,
            "scenario-origin",
            vec![
                metres("rim_radius", crater.final_diameter * 0.5),
                metres("depth", crater.crater_depth),
            ],
        ));
    }
    if detail.tsunami.applies {
        events.extend(asteroid_water_events(detail, sequence, tick));
    }
    events
}

fn asteroid_water_events(
    detail: &AsteroidDetail,
    sequence: &AsteroidSequence,
    tick: u64,
) -> Vec<RenderEventV1> {
    let splash_progress = normalized_tick(tick, ASTEROID_ENTRY_END_TICK, 62);
    let splash_height_m = if tick > 62 {
        0.0
    } else {
        (splash_progress * std::f64::consts::PI).sin() * sequence.splash_max_height_m
    };
    let elapsed_tick = tick.saturating_sub(ASTEROID_ENTRY_END_TICK);
    let wave_radius = |delay: u64| {
        if elapsed_tick <= delay {
            0.0
        } else {
            (((elapsed_tick - delay) as f64 / 40.0).clamp(0.0, 1.0)) * sequence.wave_reach_m
        }
    };
    vec![
        event(
            "asteroid-ocean-cavity",
            EventKindV1::OceanCavity,
            tick,
            ASTEROID_ENTRY_END_TICK,
            Some(ASTEROID_ENTRY_END_TICK),
            None,
            "scenario-origin",
            vec![
                metres("radius", detail.tsunami.cavity_diameter * 0.5),
                metres("depth", detail.tsunami.cavity_depth),
            ],
        ),
        event(
            "asteroid-splash",
            EventKindV1::OceanCavity,
            tick,
            ASTEROID_ENTRY_END_TICK,
            Some(56),
            Some(62),
            "scenario-origin",
            vec![
                metres("current_height", splash_height_m),
                metres("maximum_height", sequence.splash_max_height_m),
            ],
        ),
        event(
            "asteroid-tsunami",
            EventKindV1::Tsunami,
            tick,
            ASTEROID_ENTRY_END_TICK,
            Some(90),
            Some(ASTEROID_WATER_END_TICK),
            "scenario-origin",
            vec![
                metres("wave_0_radius", wave_radius(0)),
                metres("wave_1_radius", wave_radius(9)),
                metres("wave_2_radius", wave_radius(18)),
                metres("maximum_visual_reach", sequence.wave_reach_m),
                metres("initial_amplitude", detail.tsunami.initial_amplitude),
                metres(
                    "amplitude_at_reference_distance",
                    detail.tsunami.amplitude_at_distance,
                ),
                seconds("reference_arrival_time", detail.tsunami.arrival_time),
            ],
        ),
    ]
}

fn nuclear_events(detail: &NuclearDetail, result: &HazardResult, tick: u64) -> Vec<RenderEventV1> {
    let outer_radius_m = maximum_ring_radius(result);
    let blast_progress = normalized_tick(tick, 0, NUCLEAR_END_TICK);
    let blast_current_m = if tick >= NUCLEAR_END_TICK {
        0.0
    } else {
        (1.0 - (1.0 - blast_progress).powi(3)) * outer_radius_m
    };
    let mut events = vec![
        event(
            "nuclear-detonation",
            EventKindV1::Impact,
            tick,
            0,
            Some(0),
            Some(0),
            "scenario-origin",
            vec![joules("yield", detail.yield_kt * 4.184e12)],
        ),
        event(
            "nuclear-fireball",
            EventKindV1::Fireball,
            tick,
            0,
            Some(0),
            Some(1),
            "scenario-origin",
            vec![metres("maximum_radius", detail.fireball * 1_000.0)],
        ),
        event(
            "nuclear-blast",
            EventKindV1::BlastFront,
            tick,
            0,
            Some(23),
            Some(NUCLEAR_END_TICK),
            "scenario-origin",
            vec![
                metres("current_radius", blast_current_m),
                metres("maximum_radius", outer_radius_m),
                metres("radius_20_psi", detail.psi_20 * 1_000.0),
                metres("radius_5_psi", detail.psi_5 * 1_000.0),
                metres("radius_1_psi", detail.psi_1 * 1_000.0),
            ],
        ),
        event(
            "nuclear-cloud",
            EventKindV1::NuclearCloud,
            tick,
            0,
            Some(NUCLEAR_END_TICK),
            None,
            "scenario-origin",
            vec![metres("cloud_top_height", detail.cloud_top_h * 1_000.0)],
        ),
    ];
    if detail.crater_r > 0.0 {
        events.push(event(
            "nuclear-crater",
            EventKindV1::Crater,
            tick,
            0,
            Some(0),
            None,
            "scenario-origin",
            vec![metres("rim_radius", detail.crater_r * 1_000.0)],
        ));
    }
    if let Some(fallout) = &detail.fallout {
        events.push(fallout_event(fallout, tick));
    }
    if detail.is_water {
        events.push(event(
            "nuclear-water-wave",
            EventKindV1::Tsunami,
            tick,
            0,
            Some(NUCLEAR_END_TICK),
            None,
            "scenario-origin",
            vec![metres("wave_height_at_1_km", detail.wave_height)],
        ));
    }
    events
}

fn fallout_event(fallout: &FalloutPlume, tick: u64) -> RenderEventV1 {
    event(
        "nuclear-fallout",
        EventKindV1::Fallout,
        tick,
        0,
        None,
        None,
        "scenario-origin",
        vec![
            metres("heavy_length", fallout.heavy.length * 1_000.0),
            metres("heavy_width", fallout.heavy.width * 1_000.0),
            metres("light_length", fallout.light.length * 1_000.0),
            metres("light_width", fallout.light.width * 1_000.0),
        ],
    )
}

fn scenario_packet(
    scenario_id: &str,
    scenario_hash: &str,
    origin: GeodeticPosition,
    model_version: &str,
    component: &str,
    transforms: Vec<TransformStateV1>,
    events: Vec<RenderEventV1>,
) -> Result<Vec<u8>, String> {
    encode_packet(
        PacketHeaderV1::Scenario(Box::new(ScenarioHeaderV1 {
            protocol: ProtocolVersion::default(),
            minimum_reader_minor: 0,
            required_features: capabilities().features,
            scenario_id: scenario_id.into(),
            scenario_sha256: scenario_hash.into(),
            georeference: GeoreferenceV1::from_origin(origin)?,
            tick_duration_s: TICK_DURATION_S,
            transforms,
            events,
            provenance: PhysicsProvenanceV1 {
                authority: "rust".into(),
                model_versions: vec![ModelVersionV1 {
                    component: component.into(),
                    version: model_version.into(),
                }],
                geodesy_contract_version: geodesy::CONTRACT_VERSION.into(),
                surface_mask_version: None,
                bathymetry_asset_id: None,
                solver_backend: "direct_hazard".into(),
            },
            payload_sha256: EMPTY_SHA256.into(),
        })),
        &[],
        0,
    )
}

fn frame_packet(
    scenario_id: &str,
    scenario_hash: &str,
    tick: u64,
    transforms: Vec<TransformStateV1>,
    events: Vec<RenderEventV1>,
    sequence: u64,
) -> Result<Vec<u8>, String> {
    encode_packet(
        PacketHeaderV1::Frame(FrameHeaderV1 {
            protocol: ProtocolVersion::default(),
            minimum_reader_minor: 0,
            required_features: capabilities().features,
            scenario_id: scenario_id.into(),
            scenario_sha256: scenario_hash.into(),
            solver_tick: tick,
            simulation_time_s: tick as f64 * TICK_DURATION_S,
            tick_duration_s: TICK_DURATION_S,
            keyframe: true,
            base_sequence: None,
            transforms,
            events,
            fields: Vec::new(),
            payload_sha256: EMPTY_SHA256.into(),
        }),
        &[],
        sequence,
    )
}

fn end_protocol_packet(
    scenario_id: &str,
    scenario_hash: &str,
    final_tick: u64,
    frame_count: u64,
    sequence: u64,
) -> Result<Vec<u8>, String> {
    encode_packet(
        PacketHeaderV1::End(EndHeaderV1 {
            protocol: ProtocolVersion::default(),
            minimum_reader_minor: 0,
            required_features: capabilities().features,
            scenario_id: scenario_id.into(),
            scenario_sha256: scenario_hash.into(),
            final_tick,
            frame_count,
            payload_sha256: EMPTY_SHA256.into(),
        }),
        &[],
        sequence,
    )
}

#[allow(clippy::too_many_arguments)]
fn event(
    id: &str,
    kind: EventKindV1,
    tick: u64,
    start_tick: u64,
    peak_tick: Option<u64>,
    end_tick: Option<u64>,
    transform_id: &str,
    quantities: Vec<ScalarQuantityV1>,
) -> RenderEventV1 {
    RenderEventV1 {
        id: id.into(),
        kind,
        phase: phase_at(tick, start_tick, peak_tick, end_tick),
        start_tick,
        peak_tick,
        end_tick,
        transform_id: Some(transform_id.into()),
        quantities,
        field_refs: Vec::new(),
    }
}

fn phase_at(
    tick: u64,
    start_tick: u64,
    peak_tick: Option<u64>,
    end_tick: Option<u64>,
) -> EventPhaseV1 {
    if tick < start_tick {
        EventPhaseV1::Scheduled
    } else if peak_tick == Some(tick) {
        EventPhaseV1::Peak
    } else if end_tick.is_some_and(|end| tick >= end) {
        EventPhaseV1::Complete
    } else if peak_tick.is_some_and(|peak| tick > peak) {
        EventPhaseV1::Decaying
    } else {
        EventPhaseV1::Active
    }
}

fn scheduled(mut events: Vec<RenderEventV1>) -> Vec<RenderEventV1> {
    for event in &mut events {
        event.phase = EventPhaseV1::Scheduled;
    }
    events
}

fn normalized_tick(tick: u64, start: u64, end: u64) -> f64 {
    if tick <= start {
        0.0
    } else {
        ((tick.min(end) - start) as f64 / (end - start) as f64).clamp(0.0, 1.0)
    }
}

fn maximum_ring_radius(result: &HazardResult) -> f64 {
    result
        .rings
        .iter()
        .map(|ring| ring.radius_m)
        .filter(|radius| radius.is_finite())
        .fold(1.0, f64::max)
}

fn center_origin(lat: f64, lon: f64) -> GeodeticPosition {
    GeodeticPosition {
        lat_deg: lat,
        lon_deg: lon,
        ellipsoid_height_m: 0.0,
    }
}

fn origin_transform() -> TransformStateV1 {
    TransformStateV1 {
        id: "scenario-origin".into(),
        parent_frame: "local_enu".into(),
        translation_enu_m: [0.0, 0.0, 0.0],
        rotation_xyzw: [0.0, 0.0, 0.0, 1.0],
        scale: [1.0, 1.0, 1.0],
    }
}

fn quantity(semantic: &str, value: f64, unit: &str) -> ScalarQuantityV1 {
    ScalarQuantityV1 {
        semantic: semantic.into(),
        value,
        unit: unit.into(),
    }
}

fn metres(semantic: &str, value: f64) -> ScalarQuantityV1 {
    quantity(semantic, value, "metre")
}

fn metres_per_second(semantic: &str, value: f64) -> ScalarQuantityV1 {
    quantity(semantic, value, "metre_per_second")
}

fn seconds(semantic: &str, value: f64) -> ScalarQuantityV1 {
    quantity(semantic, value, "second")
}

fn joules(semantic: &str, value: f64) -> ScalarQuantityV1 {
    quantity(semantic, value, "joule")
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::super::decode_packet;
    use super::*;
    use crate::physics::direct_hazard::{AsteroidTargetType, HazardCenter, NuclearBurstType};

    fn asteroid_request() -> AsteroidHazardRequest {
        AsteroidHazardRequest {
            center: HazardCenter {
                lat: 20.0,
                lon: -86.0,
            },
            diameter_m: 500.0,
            density_kg_m3: 3_000.0,
            velocity_km_s: 20.0,
            angle_deg: 45.0,
            target_type: AsteroidTargetType::Water,
            water_depth_m: 4_000.0,
            beach_slope_rad: 0.02,
        }
    }

    fn nuclear_request() -> NuclearHazardRequest {
        NuclearHazardRequest {
            center: HazardCenter {
                lat: 40.7,
                lon: -74.0,
            },
            yield_kt: 100.0,
            burst_type: NuclearBurstType::Surface,
            height_m: Some(0.0),
            fission_pct: 50.0,
            population_density: 1_000.0,
        }
    }

    fn frames(packets: &[Vec<u8>]) -> Vec<FrameHeaderV1> {
        packets
            .iter()
            .filter_map(|packet| match decode_packet(packet).unwrap().header {
                PacketHeaderV1::Frame(frame) => Some(frame),
                _ => None,
            })
            .collect()
    }

    fn quantity_value(event: &RenderEventV1, semantic: &str) -> f64 {
        event
            .quantities
            .iter()
            .find(|quantity| quantity.semantic == semantic)
            .unwrap_or_else(|| panic!("missing {semantic} on {}", event.id))
            .value
    }

    #[test]
    fn asteroid_packets_are_deterministic_compatible_and_fieldless() {
        let request = asteroid_request();
        let (left_result, left) = asteroid_render_recording(&request).unwrap();
        let (right_result, right) = asteroid_render_recording(&request).unwrap();
        assert_eq!(left, right);
        assert_eq!(left_result.authority, "rust");
        assert_eq!(left_result.model_version, right_result.model_version);
        assert_eq!(left.len(), ASTEROID_WATER_END_TICK as usize + 3);
        let PacketHeaderV1::Scenario(scenario) = decode_packet(&left[0]).unwrap().header else {
            unreachable!()
        };
        let expected_hash = sha256_hex(&serde_json::to_vec(&request).unwrap());
        assert_eq!(scenario.scenario_sha256, expected_hash);
        assert_eq!(
            scenario.scenario_id,
            format!("asteroid-{}", &expected_hash[..16])
        );
        for packet in &left {
            let decoded = decode_packet(packet).unwrap();
            assert!(decoded.payload.is_empty());
            if let PacketHeaderV1::Frame(frame) = decoded.header {
                assert!(frame.fields.is_empty());
                assert_eq!(frame.tick_duration_s, TICK_DURATION_S);
                assert!(
                    (frame.simulation_time_s - frame.solver_tick as f64 * TICK_DURATION_S).abs()
                        <= 1e-12
                );
            }
        }
    }

    #[test]
    fn asteroid_events_cover_authoritative_sequence_and_result_dimensions() {
        let request = asteroid_request();
        let (result, packets) = asteroid_render_recording(&request).unwrap();
        let HazardDetail::Asteroid(detail) = &result.detail else {
            unreachable!()
        };
        let frame_headers = frames(&packets);
        let impact = &frame_headers[ASTEROID_ENTRY_END_TICK as usize];
        let ids: HashSet<&str> = impact
            .events
            .iter()
            .map(|event| event.id.as_str())
            .collect();
        for expected in [
            "asteroid-entry",
            "asteroid-impact",
            "asteroid-fireball",
            "asteroid-blast",
            "asteroid-crater",
            "asteroid-ocean-cavity",
            "asteroid-splash",
            "asteroid-tsunami",
        ] {
            assert!(ids.contains(expected), "missing event {expected}");
        }
        let outer = maximum_ring_radius(&result);
        let entry = impact
            .events
            .iter()
            .find(|event| event.id == "asteroid-entry")
            .unwrap();
        assert_eq!(
            quantity_value(entry, "body_radius"),
            request.diameter_m * 0.5
        );
        let blast = impact
            .events
            .iter()
            .find(|event| event.id == "asteroid-blast")
            .unwrap();
        assert_eq!(quantity_value(blast, "maximum_radius"), outer);
        let fireball = impact
            .events
            .iter()
            .find(|event| event.id == "asteroid-fireball")
            .unwrap();
        assert_eq!(
            quantity_value(fireball, "physical_radius"),
            detail.fireball_radius_m
        );
        let crater = impact
            .events
            .iter()
            .find(|event| event.id == "asteroid-crater")
            .unwrap();
        assert_eq!(
            quantity_value(crater, "rim_radius"),
            detail.crater.as_ref().unwrap().final_diameter * 0.5
        );
        let cavity = impact
            .events
            .iter()
            .find(|event| event.id == "asteroid-ocean-cavity")
            .unwrap();
        assert_eq!(
            quantity_value(cavity, "radius"),
            detail.tsunami.cavity_diameter * 0.5
        );
    }

    #[test]
    fn asteroid_body_path_is_explicit_in_local_enu_keyframes() {
        let (_, packets) = asteroid_render_recording(&asteroid_request()).unwrap();
        let frame_headers = frames(&packets);
        let start = frame_headers[0]
            .transforms
            .iter()
            .find(|transform| transform.id == "asteroid-body")
            .unwrap();
        let impact = frame_headers[ASTEROID_ENTRY_END_TICK as usize]
            .transforms
            .iter()
            .find(|transform| transform.id == "asteroid-body")
            .unwrap();
        assert!(start.translation_enu_m[2] > 0.0);
        assert!(start.translation_enu_m[0] < 0.0);
        assert!(start.translation_enu_m[1] > 0.0);
        assert_eq!(impact.translation_enu_m, [0.0, 0.0, 0.0]);
    }

    #[test]
    fn nuclear_packets_cover_fireball_blast_cloud_crater_and_fallout() {
        let request = nuclear_request();
        let (result, packets) = nuclear_render_recording(&request).unwrap();
        let (_, repeated_packets) = nuclear_render_recording(&request).unwrap();
        assert_eq!(packets, repeated_packets);
        let HazardDetail::Nuclear(detail) = &result.detail else {
            unreachable!()
        };
        assert_eq!(result.authority, "rust");
        assert_eq!(
            packets,
            nuclear_render_recording(&nuclear_request()).unwrap().1
        );
        let frame_headers = frames(&packets);
        let first = &frame_headers[0];
        let ids: HashSet<&str> = first.events.iter().map(|event| event.id.as_str()).collect();
        for expected in [
            "nuclear-detonation",
            "nuclear-fireball",
            "nuclear-blast",
            "nuclear-cloud",
            "nuclear-crater",
            "nuclear-fallout",
        ] {
            assert!(ids.contains(expected), "missing event {expected}");
        }
        let fireball = first
            .events
            .iter()
            .find(|event| event.id == "nuclear-fireball")
            .unwrap();
        assert_eq!(
            quantity_value(fireball, "maximum_radius"),
            detail.fireball * 1_000.0
        );
        let cloud = first
            .events
            .iter()
            .find(|event| event.id == "nuclear-cloud")
            .unwrap();
        assert_eq!(
            quantity_value(cloud, "cloud_top_height"),
            detail.cloud_top_h * 1_000.0
        );
        let fallout = first
            .events
            .iter()
            .find(|event| event.id == "nuclear-fallout")
            .unwrap();
        assert_eq!(
            quantity_value(fallout, "heavy_length"),
            detail.fallout.as_ref().unwrap().heavy.length * 1_000.0
        );
        for frame in frame_headers {
            assert!(frame.fields.is_empty());
            assert_eq!(frame.tick_duration_s, TICK_DURATION_S);
            assert!(
                (frame.simulation_time_s - frame.solver_tick as f64 * TICK_DURATION_S).abs()
                    <= 1e-12
            );
        }
    }
}
