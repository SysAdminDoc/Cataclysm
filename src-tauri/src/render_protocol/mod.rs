//! Renderer-neutral, Rust-owned frame protocol.
//!
//! V1 uses a fixed 32-byte little-endian prelude, a snake_case JSON metadata
//! header, and contiguous raw field chunks. Compression is intentionally not
//! negotiated in the initial feature set; every V1 field declares `codec:
//! "none"` and carries its own SHA-256 digest.

mod codec;
mod direct_hazard;
mod hash;
mod recording;
mod types;

#[allow(unused_imports)]
pub use codec::{DecodedPacketV1, PacketPrelude, capabilities, decode_packet, encode_packet};
#[allow(unused_imports)]
pub use direct_hazard::{asteroid_render_recording, nuclear_render_recording};
pub use hash::sha256_hex;
#[allow(unused_imports)]
pub use recording::{
    end_packet, frame_packet_from_grid, golden_recording_bytes, golden_recording_packets,
    scenario_packet,
};
pub use types::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::geodesy::GeodeticPosition;
    use crate::physics::solver::{SwGrid, TimeStepper};

    fn forge_packet(header: &PacketHeaderV1, payload: &[u8], sequence: u64) -> Vec<u8> {
        let json = serde_json::to_vec(header).unwrap();
        let mut bytes = Vec::with_capacity(codec::PRELUDE_BYTES + json.len() + payload.len());
        bytes.extend_from_slice(&codec::MAGIC);
        bytes.extend_from_slice(&header.protocol().major.to_le_bytes());
        bytes.extend_from_slice(&header.protocol().minor.to_le_bytes());
        bytes.push(header.kind_code());
        bytes.push(
            if matches!(header, PacketHeaderV1::Frame(frame) if frame.keyframe) {
                codec::FLAG_KEYFRAME
            } else {
                0
            },
        );
        bytes.extend_from_slice(&0_u16.to_le_bytes());
        bytes.extend_from_slice(&(json.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&sequence.to_le_bytes());
        bytes.extend_from_slice(&json);
        bytes.extend_from_slice(payload);
        bytes
    }

    fn golden_frame() -> DecodedPacketV1 {
        decode_packet(&golden_recording_packets().unwrap()[1]).unwrap()
    }

    #[test]
    fn capabilities_are_versioned_and_dependency_free() {
        let value = capabilities();
        assert_eq!(value.protocol, ProtocolVersion { major: 1, minor: 0 });
        assert_eq!(value.codecs, vec![FieldCodecV1::None]);
        assert!(value.features.contains(&"raw_f32_fields".to_string()));
        assert!(value.features.contains(&"authoritative_tick".to_string()));
    }

    #[test]
    fn fixed_prelude_offsets_and_roundtrip_are_stable() {
        let packets = golden_recording_packets().unwrap();
        for (sequence, packet) in packets.iter().enumerate() {
            assert_eq!(&packet[..8], b"CATRFRM\0");
            assert_eq!(u16::from_le_bytes(packet[8..10].try_into().unwrap()), 1);
            assert_eq!(u16::from_le_bytes(packet[10..12].try_into().unwrap()), 0);
            assert_eq!(u16::from_le_bytes(packet[14..16].try_into().unwrap()), 0);
            assert_eq!(
                u64::from_le_bytes(packet[24..32].try_into().unwrap()),
                sequence as u64
            );
            let decoded = decode_packet(packet).unwrap();
            let reencoded = encode_packet(
                decoded.header.clone(),
                &decoded.payload,
                decoded.prelude.sequence,
            )
            .unwrap();
            let reparsed = decode_packet(&reencoded).unwrap();
            assert_eq!(reparsed.header.kind_code(), decoded.header.kind_code());
            assert_eq!(reparsed.header.protocol(), decoded.header.protocol());
            assert_eq!(
                reparsed.header.payload_sha256(),
                decoded.header.payload_sha256()
            );
            if let (PacketHeaderV1::Frame(left), PacketHeaderV1::Frame(right)) =
                (&reparsed.header, &decoded.header)
            {
                assert_eq!(left.solver_tick, right.solver_tick);
                assert_eq!(left.fields.len(), right.fields.len());
                assert!(
                    left.fields
                        .iter()
                        .zip(&right.fields)
                        .all(|(a, b)| a.id == b.id && a.sha256 == b.sha256)
                );
            }
            assert_eq!(reparsed.payload, decoded.payload);
            assert_eq!(reparsed.prelude.sequence, decoded.prelude.sequence);
            assert_eq!(reparsed.prelude.kind, decoded.prelude.kind);
        }
    }

    #[test]
    fn deterministic_golden_4x3_recording_is_repeatable() {
        let first = golden_recording_bytes().unwrap();
        let second = golden_recording_bytes().unwrap();
        assert_eq!(first, second);
        assert!(!first.is_empty());

        let packets = golden_recording_packets().unwrap();
        assert_eq!(packets.len(), 5);
        for (expected_tick, packet) in packets[1..4].iter().enumerate() {
            let decoded = decode_packet(packet).unwrap();
            let PacketHeaderV1::Frame(frame) = decoded.header else {
                panic!("golden packet must be a frame");
            };
            assert_eq!(frame.solver_tick, expected_tick as u64);
            assert_eq!(frame.fields.len(), 5);
            assert!(
                frame
                    .fields
                    .iter()
                    .all(|field| field.grid.nx == 4 && field.grid.ny == 3)
            );
            let wet = frame
                .fields
                .iter()
                .find(|field| field.semantic == FieldSemanticV1::WetMask)
                .unwrap();
            assert_eq!(decoded.payload[wet.byte_offset as usize] & 1, 0);
        }
    }

    #[test]
    fn payload_and_field_corruption_are_rejected() {
        let mut packet = golden_recording_packets().unwrap()[1].clone();
        *packet.last_mut().unwrap() ^= 0x01;
        assert!(decode_packet(&packet).unwrap_err().contains("SHA-256"));

        let decoded = golden_frame();
        let PacketHeaderV1::Frame(mut frame) = decoded.header else {
            unreachable!()
        };
        frame.fields[0].sha256 = "0".repeat(64);
        let forged = forge_packet(&PacketHeaderV1::Frame(frame), &decoded.payload, 1);
        assert!(
            decode_packet(&forged)
                .unwrap_err()
                .contains("field eta SHA-256")
        );
    }

    #[test]
    fn breaking_major_and_unknown_required_feature_are_rejected() {
        let decoded = golden_frame();
        let PacketHeaderV1::Frame(mut frame) = decoded.header else {
            unreachable!()
        };
        frame.protocol.major = 2;
        let forged = forge_packet(&PacketHeaderV1::Frame(frame), &decoded.payload, 1);
        assert!(
            decode_packet(&forged)
                .unwrap_err()
                .contains("breaking protocol major")
        );

        let decoded = golden_frame();
        let PacketHeaderV1::Frame(mut frame) = decoded.header else {
            unreachable!()
        };
        frame
            .required_features
            .push("future_breaking_feature".into());
        let forged = forge_packet(&PacketHeaderV1::Frame(frame), &decoded.payload, 1);
        assert!(
            decode_packet(&forged)
                .unwrap_err()
                .contains("unsupported required")
        );
    }

    #[test]
    fn newer_minor_with_only_known_features_is_compatible() {
        let decoded = golden_frame();
        let PacketHeaderV1::Frame(mut frame) = decoded.header else {
            unreachable!()
        };
        frame.protocol.minor = 1;
        frame.minimum_reader_minor = 0;
        let forged = forge_packet(&PacketHeaderV1::Frame(frame), &decoded.payload, 1);
        assert_eq!(decode_packet(&forged).unwrap().prelude.minor, 1);
    }

    #[test]
    fn invalid_shape_hash_tick_and_nonfinite_values_fail_closed() {
        let decoded = golden_frame();
        let PacketHeaderV1::Frame(mut frame) = decoded.header else {
            unreachable!()
        };
        frame.fields[0].grid.nx = 0;
        let forged = forge_packet(&PacketHeaderV1::Frame(frame), &decoded.payload, 1);
        assert!(decode_packet(&forged).unwrap_err().contains("shape"));

        let decoded = golden_frame();
        let PacketHeaderV1::Frame(mut frame) = decoded.header else {
            unreachable!()
        };
        frame.simulation_time_s = 50.0;
        let forged = forge_packet(&PacketHeaderV1::Frame(frame), &decoded.payload, 1);
        assert!(
            decode_packet(&forged)
                .unwrap_err()
                .contains("more than one tick")
        );

        let mut grid = SwGrid::new(0.0, 0.0, 2.0, 2.0, 1.0, 1.0);
        grid.fill_uniform_depth(100.0);
        grid.eta_m[0] = f64::NAN;
        let scenario_sha = hash::sha256_hex(b"nonfinite");
        assert!(
            frame_packet_from_grid("nonfinite", &scenario_sha, &grid, 1.0, 1)
                .unwrap_err()
                .contains("non-finite")
        );
    }

    #[test]
    fn georeference_roundtrips_local_positions_within_one_metre() {
        for origin in [
            GeodeticPosition {
                lat_deg: 37.7749,
                lon_deg: -122.4194,
                ellipsoid_height_m: -32.535,
            },
            GeodeticPosition {
                lat_deg: 40.7128,
                lon_deg: -74.0060,
                ellipsoid_height_m: -31.853,
            },
            GeodeticPosition {
                lat_deg: 29.9511,
                lon_deg: -90.0715,
                ellipsoid_height_m: -25.967,
            },
        ] {
            let reference = GeoreferenceV1::from_origin(origin).unwrap();
            let local = [1_000.25, -500.5, 75.125];
            let ecef = reference.local_to_ecef(local);
            let roundtrip = reference.ecef_to_local(ecef);
            let error = ((local[0] - roundtrip[0]).powi(2)
                + (local[1] - roundtrip[1]).powi(2)
                + (local[2] - roundtrip[2]).powi(2))
            .sqrt();
            assert!(error <= 1.0, "local/ECEF error was {error} m");
        }
    }

    #[test]
    fn cpu_solver_step_index_is_authoritative_and_cancellable() {
        let mut grid = SwGrid::new(-1.0, -1.0, 1.0, 1.0, 0.5, 0.5);
        grid.fill_uniform_depth(4_000.0);
        let stepper = TimeStepper::new(0.25);
        stepper.step(&mut grid, 4);
        assert_eq!(grid.step_index, 4);
        assert!((grid.t_s - 1.0).abs() < 1e-12);
        let raw = grid.raw_render_fields();
        assert_eq!(raw.step_index, grid.step_index);
        assert_eq!(raw.time_s, grid.t_s);
    }

    #[test]
    fn malformed_lengths_reserved_bits_and_kind_are_rejected() {
        let packet = golden_recording_packets().unwrap()[1].clone();
        let mut truncated = packet.clone();
        truncated.pop();
        assert!(decode_packet(&truncated).unwrap_err().contains("length"));

        let mut reserved = packet.clone();
        reserved[14] = 1;
        assert!(decode_packet(&reserved).unwrap_err().contains("reserved"));

        let mut wrong_kind = packet;
        wrong_kind[12] = 3;
        assert!(
            decode_packet(&wrong_kind)
                .unwrap_err()
                .contains("kind disagrees")
        );
    }
}
