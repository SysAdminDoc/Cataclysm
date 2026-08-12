/**
 * Small, local Web Audio presentation layer for the simulation timeline.
 *
 * The inputs are already-produced Rust/render quantities. This module only
 * maps them to an educational tone; it never advances a simulation, derives a
 * hazard threshold, or presents audio as an operational warning.
 */

export type SonificationDomain = "tsunami" | "asteroid" | "nuclear";

export type SonificationFrame = Readonly<{
  domain: SonificationDomain;
  timeS: number;
  durationS: number;
  /** Presentation-normalized modeled amplitude, in [0, 1]. */
  amplitude: number;
  /** Presentation-normalized modeled energy proxy, in [0, 1]. */
  energy: number;
  /** First modeled arrival/onset, or null when the source has no arrival. */
  arrivalS: number | null;
  playing: boolean;
}>;

export type SonificationSignal = Readonly<{
  frequencyHz: number;
  gain: number;
  waveform: OscillatorType;
}>;

const DOMAIN_BASE_FREQUENCY: Record<SonificationDomain, number> = {
  tsunami: 150,
  asteroid: 92,
  nuclear: 118,
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

export function sonificationSignal(frame: SonificationFrame): SonificationSignal {
  const amplitude = clamp(frame.amplitude);
  const energy = clamp(frame.energy);
  const durationS = Number.isFinite(frame.durationS) && frame.durationS > 0 ? frame.durationS : 1;
  const timeRatio = clamp(frame.timeS / durationS);
  const arrivalBoost = frame.arrivalS !== null && Number.isFinite(frame.arrivalS) && frame.timeS >= frame.arrivalS
    ? 1
    : 0;
  return {
    // Amplitude changes pitch, while the energy proxy contributes to loudness.
    // The slow time term keeps a scrubbed/played timeline perceptibly moving
    // even when a field is temporarily near zero.
    frequencyHz: DOMAIN_BASE_FREQUENCY[frame.domain]
      + amplitude * 210
      + energy * 95
      + timeRatio * 35
      + arrivalBoost * 25,
    gain: 0.012 + amplitude * 0.035 + energy * 0.018,
    waveform: frame.domain === "asteroid" ? "sawtooth" : frame.domain === "nuclear" ? "square" : "triangle",
  };
}

export function crossedArrival(
  previousTimeS: number | null,
  currentTimeS: number,
  arrivalS: number | null,
): boolean {
  if (previousTimeS === null || arrivalS === null) return false;
  return Number.isFinite(previousTimeS)
    && Number.isFinite(currentTimeS)
    && Number.isFinite(arrivalS)
    && previousTimeS < arrivalS
    && currentTimeS >= arrivalS;
}

type AudioContextWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

/** Best-effort controller. Audio failure is deliberately silent and isolated
 * from solver/replay state. The caller must opt in and provide a user-driven
 * timeline play action so browser autoplay policies are respected. */
export class SonificationController {
  private enabled = false;
  private volume = 0.35;
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private oscillator: OscillatorNode | null = null;
  private previousTimeS: number | null = null;
  private previousArrivalS: number | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume);
    if (this.masterGain && this.context) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.03);
    }
  }

  sync(frame: SonificationFrame): void {
    const shouldPlay = this.enabled && frame.playing;
    if (!shouldPlay) {
      this.stop();
      this.previousTimeS = Number.isFinite(frame.timeS) ? frame.timeS : null;
      this.previousArrivalS = frame.arrivalS;
      return;
    }

    const signal = sonificationSignal(frame);
    if (!this.ensureAudio(frame.domain)) {
      this.previousTimeS = frame.timeS;
      this.previousArrivalS = frame.arrivalS;
      return;
    }

    const context = this.context;
    const oscillator = this.oscillator;
    const filter = this.filter;
    const masterGain = this.masterGain;
    if (!context || !oscillator || !filter || !masterGain) return;

    void context.resume().catch(() => {
      // Autoplay policy or an unavailable device must not affect the run.
    });
    const now = context.currentTime;
    oscillator.type = signal.waveform;
    oscillator.frequency.setTargetAtTime(signal.frequencyHz, now, 0.04);
    filter.frequency.setTargetAtTime(380 + signal.frequencyHz * 1.8, now, 0.08);
    masterGain.gain.setTargetAtTime(signal.gain * this.volume, now, 0.08);

    if (crossedArrival(this.previousTimeS, frame.timeS, frame.arrivalS)
      || (this.previousArrivalS !== frame.arrivalS && frame.arrivalS !== null && frame.timeS >= frame.arrivalS)) {
      this.playArrivalPulse(signal.frequencyHz, now);
    }
    this.previousTimeS = frame.timeS;
    this.previousArrivalS = frame.arrivalS;
  }

  stop(): void {
    if (this.context && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.04);
    }
  }

  /** Best-effort local completion accent. The caller gates this with the
   * persisted opt-in, classroom lock, and unfocused-window policy. */
  playCompletionChime(): void {
    if (!this.enabled || !this.ensureAudio("tsunami")) return;
    const context = this.context;
    if (!context) return;
    void context.resume().catch(() => {
      // Autoplay policy or an unavailable device must not affect the run.
    });
    const start = context.currentTime + 0.02;
    this.playArrivalPulse(260, start);
    this.playArrivalPulse(330, start + 0.18);
    this.playArrivalPulse(440, start + 0.36);
  }

  destroy(): void {
    this.stop();
    this.oscillator?.stop();
    this.oscillator?.disconnect();
    this.filter?.disconnect();
    this.masterGain?.disconnect();
    void this.context?.close().catch(() => {
      // Closing an already-suspended context is harmless.
    });
    this.oscillator = null;
    this.filter = null;
    this.masterGain = null;
    this.context = null;
  }

  private ensureAudio(domain: SonificationDomain): boolean {
    if (this.context) return true;
    if (typeof window === "undefined") return false;
    const audioWindow = window as AudioContextWindow;
    const Context = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!Context) return false;
    try {
      const context = new Context();
      const masterGain = context.createGain();
      const filter = context.createBiquadFilter();
      const oscillator = context.createOscillator();
      oscillator.type = domain === "asteroid" ? "sawtooth" : domain === "nuclear" ? "square" : "triangle";
      oscillator.frequency.value = DOMAIN_BASE_FREQUENCY[domain];
      filter.type = "lowpass";
      filter.frequency.value = 560;
      masterGain.gain.value = 0.0001;
      oscillator.connect(filter);
      filter.connect(masterGain);
      masterGain.connect(context.destination);
      oscillator.start();
      this.context = context;
      this.masterGain = masterGain;
      this.filter = filter;
      this.oscillator = oscillator;
      return true;
    } catch {
      return false;
    }
  }

  private playArrivalPulse(frequencyHz: number, now: number): void {
    const context = this.context;
    const masterGain = this.masterGain;
    if (!context || !masterGain) return;
    try {
      const pulse = context.createOscillator();
      const gain = context.createGain();
      pulse.type = "sine";
      pulse.frequency.value = Math.min(900, Math.max(220, frequencyHz * 1.7));
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.002, this.volume * 0.045), now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      pulse.connect(gain);
      gain.connect(masterGain);
      pulse.start(now);
      pulse.stop(now + 0.24);
      pulse.addEventListener("ended", () => {
        pulse.disconnect();
        gain.disconnect();
      }, { once: true });
    } catch {
      // Optional arrival accent; the continuous tone remains best effort.
    }
  }
}
