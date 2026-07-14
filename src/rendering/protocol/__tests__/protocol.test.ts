import { describe, expect, it } from "vitest";
import {
  RENDER_PROTOCOL_PRELUDE_BYTES,
  type DecodedFramePacket,
  type DecodedRenderPacket,
} from "../../../types/render-protocol";
import { RenderProtocolDecodeError, decodeRenderPacket } from "../decoder";
import { decodeRenderRecording, ingestRenderRecording, splitRenderRecording } from "../recording";
import { RenderReplayAdapter } from "../replay";

type Header = Record<string, unknown>;

const fsModuleName = "node:fs";
const { readFileSync } = await import(/* @vite-ignore */ fsModuleName) as {
  readFileSync(path: string): Uint8Array;
};
const processLike = (globalThis as unknown as { process: { cwd(): string } }).process;
const fixture = new Uint8Array(readFileSync(`${processLike.cwd()}/tests/fixtures/render-protocol/v1/recording.catframe`));

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function packetParts(packet: Uint8Array): { header: Header; payload: Uint8Array; view: DataView } {
  const view = new DataView(packet.buffer, packet.byteOffset, RENDER_PROTOCOL_PRELUDE_BYTES);
  const headerLength = view.getUint32(16, true);
  const headerEnd = RENDER_PROTOCOL_PRELUDE_BYTES + headerLength;
  return {
    header: JSON.parse(new TextDecoder().decode(packet.subarray(RENDER_PROTOCOL_PRELUDE_BYTES, headerEnd))) as Header,
    payload: packet.subarray(headerEnd),
    view,
  };
}

function forgePacket(
  original: Uint8Array,
  header: Header,
  payload: Uint8Array,
  prelude: { major?: number; minor?: number; kind?: number; flags?: number; reserved?: number; sequence?: bigint } = {},
): Uint8Array {
  const source = packetParts(original).view;
  const json = new TextEncoder().encode(JSON.stringify(header));
  const result = new Uint8Array(RENDER_PROTOCOL_PRELUDE_BYTES + json.length + payload.length);
  result.set(original.subarray(0, 8));
  const view = new DataView(result.buffer);
  view.setUint16(8, prelude.major ?? source.getUint16(8, true), true);
  view.setUint16(10, prelude.minor ?? source.getUint16(10, true), true);
  view.setUint8(12, prelude.kind ?? source.getUint8(12));
  view.setUint8(13, prelude.flags ?? source.getUint8(13));
  view.setUint16(14, prelude.reserved ?? 0, true);
  view.setUint32(16, json.length, true);
  view.setUint32(20, payload.length, true);
  view.setBigUint64(24, prelude.sequence ?? source.getBigUint64(24, true), true);
  result.set(json, RENDER_PROTOCOL_PRELUDE_BYTES);
  result.set(payload, RENDER_PROTOCOL_PRELUDE_BYTES + json.length);
  return result;
}

async function expectDecodeCode(work: Promise<unknown>, code: string): Promise<void> {
  await expect(work).rejects.toMatchObject({ name: "RenderProtocolDecodeError", code });
}

async function expectReplayCode(work: Promise<unknown>, code: string): Promise<void> {
  await expect(work).rejects.toMatchObject({ name: "RenderReplayError", code });
}

describe("canonical Rust render protocol fixture", () => {
  it("decodes the Rust-generated five-packet recording with three five-field frames", async () => {
    expect(fixture.byteLength).toBeGreaterThan(RENDER_PROTOCOL_PRELUDE_BYTES);
    const packets = splitRenderRecording(fixture);
    expect(packets).toHaveLength(5);
    const decoded = await decodeRenderRecording(fixture);
    expect(decoded.map((packet) => packet.kind)).toEqual(["scenario", "frame", "frame", "frame", "end"]);
    expect(decoded.map((packet) => packet.prelude.sequence)).toEqual([0n, 1n, 2n, 3n, 4n]);
    const frames = decoded.filter((packet): packet is DecodedFramePacket => packet.kind === "frame");
    expect(frames.map((frame) => frame.header.solver_tick)).toEqual([0, 1, 2]);
    expect(frames.map((frame) => frame.header.simulation_time_s)).toEqual([0, 0.5, 1]);
    expect(frames.every((frame) => frame.header.fields.length === 5)).toBe(true);
    expect(frames.every((frame) => frame.header.fields.every((field) => field.grid.nx === 4 && field.grid.ny === 3))).toBe(true);
    expect(frames[0].header.fields.map((field) => field.semantic)).toEqual([
      "water_surface_eta_m", "water_velocity_east_m_s", "water_velocity_north_m_s", "bathymetry_depth_m", "wet_mask",
    ]);
    expect(frames[0].fields.wet_mask.data_type).toBe("bitset_u1");
    expect(frames[0].fields.wet_mask.length).toBe(12);
    if (frames[0].fields.wet_mask.data_type !== "bitset_u1") throw new Error("expected wet-mask bitset");
    expect(frames[0].fields.wet_mask.toUint8Array()).toEqual(Uint8Array.from([0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]));
    expect(frames[0].fields.eta.at(0)).toBeCloseTo(-0.055, 6);
    expect(frames[2].fields.eta.at(11)).toBeCloseTo(0.555, 6);
  });

  it("replays the fixture deterministically without changing authoritative values", async () => {
    const first = await ingestRenderRecording(fixture);
    const second = await ingestRenderRecording(Uint8Array.from(fixture));
    expect(first.complete).toBe(true);
    expect(first.frame_count).toBe(3);
    expect(first.end?.header.final_tick).toBe(2);
    const firstSignature = first.frames.map((frame) => ({
      sequence: frame.prelude.sequence,
      tick: frame.header.solver_tick,
      time: frame.header.simulation_time_s,
      payload: frame.header.payload_sha256,
      fields: frame.header.fields.map((field) => [field.id, field.sha256]),
      eta: frame.fields.eta.data_type === "f32_le" ? [...frame.fields.eta.toFloat32Array()] : [],
    }));
    const secondSignature = second.frames.map((frame) => ({
      sequence: frame.prelude.sequence,
      tick: frame.header.solver_tick,
      time: frame.header.simulation_time_s,
      payload: frame.header.payload_sha256,
      fields: frame.header.fields.map((field) => [field.id, field.sha256]),
      eta: frame.fields.eta.data_type === "f32_le" ? [...frame.fields.eta.toFloat32Array()] : [],
    }));
    expect(secondSignature).toEqual(firstSignature);
    const view = first.frameAtTick(1);
    expect(view?.sequence).toBe(2n);
    expect(view?.scenario_sha256).toBe(first.scenario?.header.scenario_sha256);
    expect(view?.georeference).toBe(first.scenario?.header.georeference);
    expect(view?.transforms[0].translation_enu_m).toEqual([0, 0, 0]);
    expect(view?.events[0].kind).toBe("tsunami");
    expect(Object.isFrozen(view)).toBe(true);
  });
});

describe("canonical packet validation", () => {
  it("accepts the validated byte-array transport emitted by Tauri channels", async () => {
    const scenario = splitRenderRecording(fixture)[0];
    await expect(decodeRenderPacket([...scenario])).resolves.toMatchObject({ kind: "scenario" });
    await expect(decodeRenderPacket([0, 1.5, 256])).rejects.toMatchObject({
      name: "RenderProtocolDecodeError",
      code: "invalid_input",
    });
    await expect(
      decodeRenderPacket([...scenario], { limits: { max_packet_bytes: scenario.length - 1 } }),
    ).rejects.toMatchObject({ name: "RenderProtocolDecodeError", code: "packet_too_large" });
  });

  it("enforces exact prelude framing, caps, reserved bits, and packet_kind agreement", async () => {
    const frame = splitRenderRecording(fixture)[1];
    const { header, payload } = packetParts(frame);
    await expectDecodeCode(decodeRenderPacket(new Uint8Array(31)), "truncated_prelude");
    const badMagic = Uint8Array.from(frame);
    badMagic[0] ^= 1;
    await expectDecodeCode(decodeRenderPacket(badMagic), "bad_magic");
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, header, payload, { reserved: 1 })), "reserved_nonzero");
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, header, payload, { flags: 0x80 })), "unsupported_flags");
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, header, payload, { kind: 3 })), "packet_kind_mismatch");
    await expectDecodeCode(decodeRenderPacket(frame, { limits: { max_packet_bytes: frame.length - 1 } }), "packet_too_large");
    await expectDecodeCode(decodeRenderPacket(frame, { limits: { max_header_bytes: 8 } }), "header_too_large");
    await expectDecodeCode(decodeRenderPacket(frame, { limits: { max_payload_bytes: 2 } }), "payload_too_large");
    await expectDecodeCode(decodeRenderPacket(frame.subarray(0, frame.length - 1)), "length_mismatch");
  });

  it("accepts complete field tile addressing and rejects incomplete coverage", async () => {
    const frame = splitRenderRecording(fixture)[1];
    const parts = packetParts(frame);
    const tiled = clone(parts.header);
    const grid = ((tiled.fields as Header[])[0]).grid as Header;
    const nx = grid.nx as number;
    const ny = grid.ny as number;
    const dlon = grid.dlon_deg as number;
    const dlat = grid.dlat_deg as number;
    const west = (grid.west_cell_center_lon_deg as number) - 0.5 * dlon;
    const south = (grid.south_cell_center_lat_deg as number) - 0.5 * dlat;
    grid.tiles = [{
      column_offset: 0,
      column_count: nx,
      bbox: [west, south, west + nx * dlon, south + ny * dlat],
    }];

    const decoded = await decodeRenderPacket(forgePacket(frame, tiled, parts.payload));
    if (decoded.kind !== "frame") throw new Error("expected frame");
    expect(decoded.header.fields[0].grid.tiles).toEqual(grid.tiles);

    const incomplete = clone(tiled);
    ((((incomplete.fields as Header[])[0]).grid as Header).tiles as Header[])[0].column_count = nx - 1;
    await expectDecodeCode(
      decodeRenderPacket(forgePacket(frame, incomplete, parts.payload)),
      "invalid_grid",
    );
  });

  it("enforces protocol versions, minimum reader minor, features, and keyframe flags", async () => {
    const frame = splitRenderRecording(fixture)[1];
    const parts = packetParts(frame);
    const major = clone(parts.header);
    (major.protocol as Header).major = 2;
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, major, parts.payload, { major: 2 })), "unsupported_major");
    const newer = clone(parts.header);
    (newer.protocol as Header).minor = 1;
    expect((await decodeRenderPacket(forgePacket(frame, newer, parts.payload, { minor: 1 }))).prelude.minor).toBe(1);
    const reader = clone(parts.header);
    reader.minimum_reader_minor = 1;
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, reader, parts.payload)), "unsupported_minor");
    const feature = clone(parts.header);
    (feature.required_features as string[]).push("future_breaking_feature");
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, feature, parts.payload)), "unsupported_feature");
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, parts.header, parts.payload, { flags: 0 })), "keyframe_flag_mismatch");
  });

  it("validates checksums and finite f32 field data", async () => {
    const frame = splitRenderRecording(fixture)[1];
    const parts = packetParts(frame);
    const corrupted = Uint8Array.from(parts.payload);
    corrupted[0] ^= 1;
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, parts.header, corrupted)), "payload_checksum_mismatch");
    const fieldHash = clone(parts.header);
    ((fieldHash.fields as Header[])[0]).sha256 = "0".repeat(64);
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, fieldHash, parts.payload)), "field_checksum_mismatch");

    const nonfinitePayload = Uint8Array.from(parts.payload);
    new DataView(nonfinitePayload.buffer).setFloat32(0, Number.POSITIVE_INFINITY, true);
    const nonfiniteHeader = clone(parts.header);
    const eta = (nonfiniteHeader.fields as Header[])[0];
    eta.sha256 = await sha256(nonfinitePayload.subarray(0, eta.byte_length as number));
    nonfiniteHeader.payload_sha256 = await sha256(nonfinitePayload);
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, nonfiniteHeader, nonfinitePayload)), "nonfinite_field");
  });

  it("validates descriptor semantics, dtype, codec, unit, grid shape, offsets, and contiguous coverage", async () => {
    const frame = splitRenderRecording(fixture)[1];
    const parts = packetParts(frame);
    const cases: Array<{ code: string; mutate(header: Header): void }> = [
      { code: "unknown_field_semantic", mutate: (header) => ((header.fields as Header[])[0].semantic = "unknown") },
      { code: "unknown_field_dtype", mutate: (header) => ((header.fields as Header[])[0].data_type = "f64_le") },
      { code: "unsupported_codec", mutate: (header) => ((header.fields as Header[])[0].codec = "zstd") },
      { code: "invalid_field", mutate: (header) => ((header.fields as Header[])[0].unit = "foot") },
      { code: "invalid_grid", mutate: (header) => (((header.fields as Header[])[0].grid as Header).row_order = "north_to_south") },
      { code: "invalid_shape", mutate: (header) => ((header.fields as Header[])[0].element_count = 11) },
      { code: "invalid_field_length", mutate: (header) => ((header.fields as Header[])[0].byte_length = 47) },
      { code: "noncontiguous_fields", mutate: (header) => ((header.fields as Header[])[1].byte_offset = 49) },
      { code: "noncontiguous_fields", mutate: (header) => ((header.fields as Header[])[1].byte_offset = 0) },
    ];
    for (const testCase of cases) {
      const header = clone(parts.header);
      testCase.mutate(header);
      await expectDecodeCode(decodeRenderPacket(forgePacket(frame, header, parts.payload)), testCase.code);
    }
  });

  it("validates bitset_u1 unused bits and preserves immutable packed/unpacked views", async () => {
    const frame = splitRenderRecording(fixture)[1];
    const parts = packetParts(frame);
    const header = clone(parts.header);
    const wet = (header.fields as Header[]).at(-1) as Header;
    const payload = Uint8Array.from(parts.payload);
    payload[(wet.byte_offset as number) + (wet.byte_length as number) - 1] |= 0x80;
    wet.sha256 = await sha256(payload.subarray(wet.byte_offset as number, (wet.byte_offset as number) + (wet.byte_length as number)));
    header.payload_sha256 = await sha256(payload);
    await expectDecodeCode(decodeRenderPacket(forgePacket(frame, header, payload)), "invalid_bitset");

    const valid = await decodeRenderPacket(frame);
    if (valid.kind !== "frame") throw new Error("expected frame");
    const packed = valid.fields.wet_mask.data_type === "bitset_u1" ? valid.fields.wet_mask.toPackedBytes() : new Uint8Array();
    packed.fill(0);
    expect(valid.fields.wet_mask.at(1)).toBe(1);
  });

  it("validates georeference, transforms, events, provenance, and authoritative tick timing", async () => {
    const packets = splitRenderRecording(fixture);
    const scenarioParts = packetParts(packets[0]);
    const badGeoref = clone(scenarioParts.header);
    ((badGeoref.georeference as Header).origin_ecef_m as Header).x_m = 0;
    await expectDecodeCode(decodeRenderPacket(forgePacket(packets[0], badGeoref, scenarioParts.payload)), "invalid_georeference");
    const badAuthority = clone(scenarioParts.header);
    (badAuthority.provenance as Header).authority = "typescript";
    await expectDecodeCode(decodeRenderPacket(forgePacket(packets[0], badAuthority, scenarioParts.payload)), "invalid_provenance");

    const frameParts = packetParts(packets[1]);
    const badTransform = clone(frameParts.header);
    ((badTransform.transforms as Header[])[0]).rotation_xyzw = [0, 0, 0, 2];
    await expectDecodeCode(decodeRenderPacket(forgePacket(packets[1], badTransform, frameParts.payload)), "invalid_transform");
    const badEvent = clone(frameParts.header);
    ((badEvent.events as Header[])[0]).field_refs = ["missing"];
    await expectDecodeCode(decodeRenderPacket(forgePacket(packets[1], badEvent, frameParts.payload)), "invalid_event");
    const badTime = clone(frameParts.header);
    badTime.simulation_time_s = 10;
    await expectDecodeCode(decodeRenderPacket(forgePacket(packets[1], badTime, frameParts.payload)), "invalid_time");
  });
});

describe("recording and replay ordering", () => {
  it("rejects malformed length-prefixed recordings", async () => {
    expect(() => splitRenderRecording(new Uint8Array())).toThrowError(RenderProtocolDecodeError);
    expect(() => splitRenderRecording(fixture.subarray(0, 2))).toThrow(/u32 packet length/i);
    const badLength = Uint8Array.from(fixture);
    new DataView(badLength.buffer).setUint32(0, 0xffff_ffff, true);
    expect(() => splitRenderRecording(badLength)).toThrow(/length/i);
    const packets = splitRenderRecording(fixture);
    const withoutEnd = fixture.subarray(0, fixture.length - packets.at(-1)!.length - 4);
    await expectDecodeCode(ingestRenderRecording(withoutEnd), "incomplete_recording");
  });

  it("rejects sequence, scenario identity, tick/time, and end-state drift", async () => {
    const decoded = await decodeRenderRecording(fixture);
    const gap = new RenderReplayAdapter();
    gap.append(decoded[0]);
    expect(() => gap.append(decoded[2])).toThrow(/Expected sequence 1/);

    const packets = splitRenderRecording(fixture);
    const identityParts = packetParts(packets[1]);
    const identityHeader = clone(identityParts.header);
    identityHeader.scenario_sha256 = "0".repeat(64);
    const wrongIdentity = await decodeRenderPacket(forgePacket(packets[1], identityHeader, identityParts.payload));
    const identityAdapter = new RenderReplayAdapter();
    identityAdapter.append(decoded[0]);
    expect(() => identityAdapter.append(wrongIdentity)).toThrow(/scenario_id\/scenario_sha256/);

    const tickParts = packetParts(packets[2]);
    const tickHeader = clone(tickParts.header);
    tickHeader.solver_tick = 0;
    tickHeader.simulation_time_s = 0;
    const regressed = await decodeRenderPacket(forgePacket(packets[2], tickHeader, tickParts.payload));
    const tickAdapter = new RenderReplayAdapter();
    tickAdapter.append(decoded[0]);
    tickAdapter.append(decoded[1]);
    expect(() => tickAdapter.append(regressed)).toThrow(/solver_tick/);

    const endParts = packetParts(packets[4]);
    const endHeader = clone(endParts.header);
    endHeader.final_tick = 99;
    const badEnd = await decodeRenderPacket(forgePacket(packets[4], endHeader, endParts.payload));
    const endAdapter = new RenderReplayAdapter();
    decoded.slice(0, 4).forEach((packet: DecodedRenderPacket) => endAdapter.append(packet));
    expect(() => endAdapter.append(badEnd)).toThrow(/final_tick/);
  });

  it("emits typed replay errors", async () => {
    const packets = await decodeRenderRecording(fixture);
    const adapter = new RenderReplayAdapter();
    adapter.append(packets[0]);
    await expectReplayCode(Promise.resolve().then(() => adapter.append(packets[0])), "duplicate_scenario");
  });
});
