import { describe, expect, it } from "vitest";

import { crossedArrival, sonificationSignal, type SonificationFrame } from "../sonification";

const frame: SonificationFrame = {
  domain: "tsunami",
  timeS: 600,
  durationS: 3_600,
  amplitude: 0.5,
  energy: 0.25,
  arrivalS: 480,
  playing: true,
};

describe("timeline sonification mapping", () => {
  it("maps modeled amplitude, energy, and arrival to a bounded signal", () => {
    const signal = sonificationSignal(frame);
    expect(signal.frequencyHz).toBeGreaterThan(150);
    expect(signal.gain).toBeGreaterThan(0);
    expect(signal.gain).toBeLessThan(0.1);
    expect(signal.waveform).toBe("triangle");
  });

  it("uses domain-specific waveforms without changing the physics inputs", () => {
    expect(sonificationSignal({ ...frame, domain: "asteroid" }).waveform).toBe("sawtooth");
    expect(sonificationSignal({ ...frame, domain: "nuclear" }).waveform).toBe("square");
    expect(sonificationSignal({ ...frame, amplitude: 99, energy: -2 }).gain).toBeLessThan(0.1);
  });

  it("detects a first-arrival crossing in the playback direction only", () => {
    expect(crossedArrival(400, 500, 480)).toBe(true);
    expect(crossedArrival(500, 400, 480)).toBe(false);
    expect(crossedArrival(null, 500, 480)).toBe(false);
    expect(crossedArrival(400, 500, null)).toBe(false);
  });
});

