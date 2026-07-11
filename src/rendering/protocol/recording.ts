import type { DecodedRenderPacket } from "../../types/render-protocol";
import {
  DEFAULT_RENDER_PROTOCOL_LIMITS,
  RenderProtocolDecodeError,
  decodeRenderPacket,
  type RenderProtocolDecoderOptions,
} from "./decoder";
import { RenderReplayAdapter } from "./replay";

function recordingBytes(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new RenderProtocolDecodeError("invalid_recording", "Recording must be an ArrayBuffer or Uint8Array.");
}

export function splitRenderRecording(input: unknown, options: RenderProtocolDecoderOptions = {}): readonly Uint8Array[] {
  const bytes = recordingBytes(input);
  const maximumPacket = options.limits?.max_packet_bytes ?? DEFAULT_RENDER_PROTOCOL_LIMITS.max_packet_bytes;
  const packets: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 4) throw new RenderProtocolDecodeError("truncated_recording", "Recording ends inside a u32 packet length.");
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
    offset += 4;
    if (length === 0 || length > maximumPacket) throw new RenderProtocolDecodeError("recording_packet_length", "Recording packet length is invalid or exceeds its cap.");
    const end = offset + length;
    if (!Number.isSafeInteger(end) || end > bytes.byteLength) throw new RenderProtocolDecodeError("truncated_recording", "Recording packet exceeds the available bytes.");
    packets.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (packets.length === 0) throw new RenderProtocolDecodeError("empty_recording", "Recording contains no packets.");
  return Object.freeze(packets);
}

export async function decodeRenderRecording(
  input: unknown,
  options: RenderProtocolDecoderOptions = {},
): Promise<readonly DecodedRenderPacket[]> {
  const decoded: DecodedRenderPacket[] = [];
  for (const packet of splitRenderRecording(input, options)) decoded.push(await decodeRenderPacket(packet, options));
  return Object.freeze(decoded);
}

export async function ingestRenderRecording(
  input: unknown,
  options: RenderProtocolDecoderOptions = {},
): Promise<RenderReplayAdapter> {
  const adapter = new RenderReplayAdapter(options);
  for (const packet of splitRenderRecording(input, options)) await adapter.ingest(packet);
  if (!adapter.complete) throw new RenderProtocolDecodeError("incomplete_recording", "Recording has no valid end packet.");
  return adapter;
}
