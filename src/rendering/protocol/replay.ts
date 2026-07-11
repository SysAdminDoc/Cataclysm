import type {
  DecodedEndPacket,
  DecodedFramePacket,
  DecodedRenderPacket,
  DecodedScenarioPacket,
  RendererNeutralFrameView,
} from "../../types/render-protocol";
import { decodeRenderPacket, type RenderProtocolDecoderOptions } from "./decoder";

export class RenderReplayError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RenderReplayError";
    this.code = code;
  }
}

function replayFail(code: string, message: string): never {
  throw new RenderReplayError(code, message);
}

/** Exact projection of authoritative frame state; no interpolation or physics. */
export function toRendererNeutralFrameView(
  packet: DecodedFramePacket,
  scenario: DecodedScenarioPacket,
): RendererNeutralFrameView {
  if (
    packet.header.scenario_id !== scenario.header.scenario_id ||
    packet.header.scenario_sha256 !== scenario.header.scenario_sha256
  ) replayFail("scenario_mismatch", "Frame and scenario identities differ.");
  return Object.freeze({
    sequence: packet.prelude.sequence,
    scenario_id: packet.header.scenario_id,
    scenario_sha256: packet.header.scenario_sha256,
    solver_tick: packet.header.solver_tick,
    simulation_time_s: packet.header.simulation_time_s,
    tick_duration_s: packet.header.tick_duration_s,
    payload_sha256: packet.header.payload_sha256,
    keyframe: packet.header.keyframe,
    base_sequence: packet.header.base_sequence,
    georeference: scenario.header.georeference,
    transforms: packet.header.transforms,
    events: packet.header.events,
    fields: packet.fields,
  });
}

export class RenderReplayAdapter {
  readonly #decoderOptions: RenderProtocolDecoderOptions;
  #scenario: DecodedScenarioPacket | null = null;
  #end: DecodedEndPacket | null = null;
  #frames: DecodedFramePacket[] = [];
  #lastSequence: bigint | null = null;

  constructor(decoderOptions: RenderProtocolDecoderOptions = {}) {
    this.#decoderOptions = decoderOptions;
  }

  get scenario(): DecodedScenarioPacket | null { return this.#scenario; }
  get end(): DecodedEndPacket | null { return this.#end; }
  get complete(): boolean { return this.#end !== null; }
  get frame_count(): number { return this.#frames.length; }
  get frames(): readonly DecodedFramePacket[] { return Object.freeze([...this.#frames]); }

  async ingest(input: unknown): Promise<DecodedRenderPacket> {
    const packet = await decodeRenderPacket(input, this.#decoderOptions);
    this.append(packet);
    return packet;
  }

  append(packet: DecodedRenderPacket): void {
    if (this.#end) replayFail("replay_complete", "No packet may follow the end packet.");
    if (packet.kind === "scenario") this.#appendScenario(packet);
    else if (packet.kind === "frame") this.#appendFrame(packet);
    else this.#appendEnd(packet);
  }

  frameAtSequence(sequence: bigint): RendererNeutralFrameView | null {
    const scenario = this.#scenario;
    const packet = this.#frames.find((frame) => frame.prelude.sequence === sequence);
    return scenario && packet ? toRendererNeutralFrameView(packet, scenario) : null;
  }

  frameAtTick(tick: number): RendererNeutralFrameView | null {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("tick must be a nonnegative safe integer.");
    const scenario = this.#scenario;
    const packet = this.#frames.find((frame) => frame.header.solver_tick === tick);
    return scenario && packet ? toRendererNeutralFrameView(packet, scenario) : null;
  }

  #requireNextSequence(sequence: bigint): void {
    if (this.#lastSequence === null) replayFail("missing_scenario", "Replay must begin with a scenario packet.");
    const expected = this.#lastSequence + 1n;
    if (sequence !== expected) replayFail("sequence_discontinuity", `Expected sequence ${expected}, received ${sequence}.`);
  }

  #sameIdentity(packet: DecodedFramePacket | DecodedEndPacket): void {
    const scenario = this.#scenario;
    if (!scenario) replayFail("missing_scenario", "Packet arrived before the scenario packet.");
    if (
      packet.header.scenario_id !== scenario.header.scenario_id ||
      packet.header.scenario_sha256 !== scenario.header.scenario_sha256
    ) replayFail("scenario_mismatch", "Packet scenario_id/scenario_sha256 does not match the replay.");
  }

  #appendScenario(packet: DecodedScenarioPacket): void {
    if (this.#scenario) replayFail("duplicate_scenario", "Replay already has a scenario packet.");
    if (packet.prelude.sequence !== 0n) replayFail("scenario_sequence", "Scenario sequence must be zero.");
    this.#scenario = packet;
    this.#lastSequence = 0n;
  }

  #appendFrame(packet: DecodedFramePacket): void {
    this.#sameIdentity(packet);
    this.#requireNextSequence(packet.prelude.sequence);
    const scenario = this.#scenario as DecodedScenarioPacket;
    if (packet.header.tick_duration_s !== scenario.header.tick_duration_s) {
      replayFail("tick_duration_mismatch", "Frame tick_duration_s differs from the scenario.");
    }
    const previous = this.#frames.at(-1);
    if (previous) {
      if (packet.header.solver_tick <= previous.header.solver_tick) replayFail("tick_regression", "solver_tick must increase strictly.");
      if (packet.header.simulation_time_s <= previous.header.simulation_time_s) replayFail("time_regression", "simulation_time_s must increase strictly.");
    }
    this.#frames.push(packet);
    this.#lastSequence = packet.prelude.sequence;
  }

  #appendEnd(packet: DecodedEndPacket): void {
    this.#sameIdentity(packet);
    this.#requireNextSequence(packet.prelude.sequence);
    if (packet.header.frame_count !== this.#frames.length) replayFail("frame_count_mismatch", "End frame_count differs from received frames.");
    const expectedFinalTick = this.#frames.at(-1)?.header.solver_tick ?? 0;
    if (packet.header.final_tick !== expectedFinalTick) replayFail("final_tick_mismatch", "End final_tick differs from the final frame.");
    this.#end = packet;
    this.#lastSequence = packet.prelude.sequence;
  }
}
