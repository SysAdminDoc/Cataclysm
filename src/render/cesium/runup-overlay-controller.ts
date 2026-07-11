export interface RunupOverlayInput {
  id: string;
  name: string;
  lat: number;
  lon: number;
  range_m: number;
  offshore_amplitude_m: number;
  runup_m: number;
  arrival_time_s: number;
  has_arrived: boolean;
  inundation_extent_m: number;
}

export interface RunupPrimitivePresentation {
  id: string;
  lat: number;
  lon: number;
  heightM: number;
  colorCss: string;
  colorAlpha: 0.85;
  outlineColorCss: "#11111b";
  outlineAlpha: 0.6;
  outlineWidth: 1;
  width: 8;
}

export interface InundationPrimitivePresentation {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  segments: 40;
  colorCss: string;
  colorAlpha: 0.25;
  outlineAlpha: 0.7;
  outlineWidth: 2;
}

export interface RunupLabelPresentation {
  id: string;
  lat: number;
  lon: number;
  heightM: number;
  text: string;
}

export interface RunupOverlayHost<RunupPrimitive, InundationPrimitive, Label> {
  createRunupPrimitive: (
    presentations: readonly RunupPrimitivePresentation[],
  ) => RunupPrimitive;
  removeRunupPrimitive: (primitive: RunupPrimitive) => void;
  createInundationPrimitive: (
    presentations: readonly InundationPrimitivePresentation[],
  ) => InundationPrimitive;
  removeInundationPrimitive: (primitive: InundationPrimitive) => void;
  createLabel: (presentation: RunupLabelPresentation) => Label;
  updateLabel: (label: Label, presentation: RunupLabelPresentation) => void;
  removeLabel: (label: Label) => void;
}

export interface RunupOverlayDiagnostics {
  destroyed: boolean;
  ownedRunupPrimitiveCount: 0 | 1;
  ownedInundationPrimitiveCount: 0 | 1;
  ownedLabelCount: number;
  currentRunupItemCount: number;
  currentInundationItemCount: number;
  updateCount: number;
  clearCount: number;
  invalidInputCount: number;
  duplicateInputCount: number;
  createdRunupPrimitiveCount: number;
  removedRunupPrimitiveCount: number;
  createdInundationPrimitiveCount: number;
  removedInundationPrimitiveCount: number;
  createdLabelCount: number;
  updatedLabelCount: number;
  removedLabelCount: number;
  rollbackLabelUpdateCount: number;
  rollbackCount: number;
  failedUpdateCount: number;
}

interface OwnedLabel<Label> {
  handle: Label;
  presentation: RunupLabelPresentation;
}

interface NormalizedOverlay {
  runup: RunupPrimitivePresentation[];
  inundation: InundationPrimitivePresentation[];
  labels: RunupLabelPresentation[];
  invalidCount: number;
  duplicateCount: number;
}

const RUNUP_LOW = "#a6e3a1";
const RUNUP_MODERATE = "#f9e2af";
const RUNUP_HIGH = "#f38ba8";

function compareIds(left: RunupOverlayInput, right: RunupOverlayInput): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function runupColor(runupM: number): string {
  return runupM < 2 ? RUNUP_LOW : runupM < 10 ? RUNUP_MODERATE : RUNUP_HIGH;
}

function validBaseInput(input: RunupOverlayInput): boolean {
  return (
    typeof input.id === "string" &&
    input.id.trim().length > 0 &&
    typeof input.name === "string" &&
    input.name.trim().length > 0 &&
    typeof input.has_arrived === "boolean" &&
    Number.isFinite(input.lat) &&
    input.lat >= -90 &&
    input.lat <= 90 &&
    Number.isFinite(input.lon) &&
    input.lon >= -180 &&
    input.lon <= 180
  );
}

function labelPresentation(input: RunupOverlayInput, heightM: number): RunupLabelPresentation {
  const arrivalMin = input.arrival_time_s / 60;
  const arrivalLabel = !Number.isFinite(arrivalMin)
    ? "-"
    : arrivalMin < 60
      ? `T+${arrivalMin.toFixed(0)}m`
      : `T+${Math.floor(arrivalMin / 60)}h${String(Math.round(arrivalMin % 60)).padStart(2, "0")}`;
  const offshore = Number.isFinite(input.offshore_amplitude_m)
    ? input.offshore_amplitude_m.toFixed(2)
    : "-";
  return {
    id: input.id,
    lat: input.lat,
    lon: input.lon,
    heightM,
    text: `${input.name}\n${arrivalLabel}  -  ${input.runup_m.toFixed(1)} m runup\n${offshore} m offshore`,
  };
}

function normalize(inputs: readonly RunupOverlayInput[]): NormalizedOverlay {
  const valid = inputs.filter(validBaseInput);
  const invalidCount = inputs.length - valid.length;
  const groups = new Map<string, RunupOverlayInput[]>();
  for (const input of valid) {
    const group = groups.get(input.id);
    if (group) group.push(input);
    else groups.set(input.id, [input]);
  }
  let duplicateCount = 0;
  const unique: RunupOverlayInput[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) unique.push(group[0]);
    else duplicateCount += group.length;
  }
  unique.sort(compareIds);

  const runup: RunupPrimitivePresentation[] = [];
  const inundation: InundationPrimitivePresentation[] = [];
  const labels: RunupLabelPresentation[] = [];
  for (const input of unique) {
    const colorCss = runupColor(input.runup_m);
    if (input.has_arrived && Number.isFinite(input.runup_m) && input.runup_m >= 0.1) {
      const heightM = Math.min(Math.max(input.runup_m * 500, 5_000), 800_000);
      runup.push({
        id: input.id,
        lat: input.lat,
        lon: input.lon,
        heightM,
        colorCss,
        colorAlpha: 0.85,
        outlineColorCss: "#11111b",
        outlineAlpha: 0.6,
        outlineWidth: 1,
        width: 8,
      });
      labels.push(labelPresentation(input, heightM));
    }
    if (
      input.has_arrived &&
      Number.isFinite(input.inundation_extent_m) &&
      input.inundation_extent_m >= 100
    ) {
      inundation.push({
        id: `inundation-${input.id}`,
        lat: input.lat,
        lon: input.lon,
        radiusM: Math.min(Math.max(input.inundation_extent_m, 200), 50_000),
        segments: 40,
        colorCss,
        colorAlpha: 0.25,
        outlineAlpha: 0.7,
        outlineWidth: 2,
      });
    }
  }
  return { runup, inundation, labels, invalidCount, duplicateCount };
}

function presentationsEqual(
  left: RunupLabelPresentation,
  right: RunupLabelPresentation,
): boolean {
  return (
    left.id === right.id &&
    left.lat === right.lat &&
    left.lon === right.lon &&
    left.heightM === right.heightM &&
    left.text === right.text
  );
}

export class RunupOverlayController<RunupPrimitive, InundationPrimitive, Label> {
  private readonly host: RunupOverlayHost<RunupPrimitive, InundationPrimitive, Label>;
  private runupPrimitive: RunupPrimitive | null = null;
  private inundationPrimitive: InundationPrimitive | null = null;
  private labels = new Map<string, OwnedLabel<Label>>();
  private destroyed = false;
  private currentRunupItemCount = 0;
  private currentInundationItemCount = 0;
  private updateCount = 0;
  private clearCount = 0;
  private invalidInputCount = 0;
  private duplicateInputCount = 0;
  private createdRunupPrimitiveCount = 0;
  private removedRunupPrimitiveCount = 0;
  private createdInundationPrimitiveCount = 0;
  private removedInundationPrimitiveCount = 0;
  private createdLabelCount = 0;
  private updatedLabelCount = 0;
  private removedLabelCount = 0;
  private rollbackLabelUpdateCount = 0;
  private rollbackCount = 0;
  private failedUpdateCount = 0;

  constructor(host: RunupOverlayHost<RunupPrimitive, InundationPrimitive, Label>) {
    this.host = host;
  }

  update(inputs: readonly RunupOverlayInput[] | null | undefined): void {
    if (this.destroyed) return;
    const normalized = normalize(inputs ?? []);
    this.invalidInputCount += normalized.invalidCount;
    this.duplicateInputCount += normalized.duplicateCount;

    let nextRunup: RunupPrimitive | null = null;
    let nextInundation: InundationPrimitive | null = null;
    const createdLabels = new Map<string, OwnedLabel<Label>>();
    const updatedLabels: Array<{ owned: OwnedLabel<Label>; previous: RunupLabelPresentation }> = [];
    try {
      if (normalized.runup.length > 0) {
        nextRunup = this.host.createRunupPrimitive(normalized.runup);
        this.createdRunupPrimitiveCount += 1;
      }
      if (normalized.inundation.length > 0) {
        nextInundation = this.host.createInundationPrimitive(normalized.inundation);
        this.createdInundationPrimitiveCount += 1;
      }
      for (const presentation of normalized.labels) {
        const current = this.labels.get(presentation.id);
        if (!current) {
          const handle = this.host.createLabel(presentation);
          this.createdLabelCount += 1;
          createdLabels.set(presentation.id, { handle, presentation });
        } else if (!presentationsEqual(current.presentation, presentation)) {
          const previous = current.presentation;
          updatedLabels.push({ owned: current, previous });
          this.host.updateLabel(current.handle, presentation);
          this.updatedLabelCount += 1;
          current.presentation = presentation;
        }
      }
    } catch (error) {
      for (const { owned, previous } of updatedLabels.reverse()) {
        this.host.updateLabel(owned.handle, previous);
        owned.presentation = previous;
        this.rollbackLabelUpdateCount += 1;
      }
      for (const { handle } of createdLabels.values()) {
        this.host.removeLabel(handle);
        this.removedLabelCount += 1;
      }
      if (nextInundation !== null) this.removeInundation(nextInundation);
      if (nextRunup !== null) this.removeRunup(nextRunup);
      this.rollbackCount += 1;
      this.failedUpdateCount += 1;
      throw error;
    }

    const previousRunup = this.runupPrimitive;
    const previousInundation = this.inundationPrimitive;
    this.runupPrimitive = nextRunup;
    this.inundationPrimitive = nextInundation;
    if (previousRunup !== null) this.removeRunup(previousRunup);
    if (previousInundation !== null) this.removeInundation(previousInundation);

    const desiredIds = new Set(normalized.labels.map((label) => label.id));
    for (const [id, owned] of this.labels) {
      if (desiredIds.has(id)) continue;
      this.host.removeLabel(owned.handle);
      this.removedLabelCount += 1;
      this.labels.delete(id);
    }
    for (const [id, owned] of createdLabels) this.labels.set(id, owned);

    this.currentRunupItemCount = normalized.runup.length;
    this.currentInundationItemCount = normalized.inundation.length;
    this.updateCount += 1;
  }

  clear(): void {
    if (this.destroyed) return;
    this.releaseAll();
    this.clearCount += 1;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.releaseAll();
    this.destroyed = true;
  }

  diagnostics(): RunupOverlayDiagnostics {
    return {
      destroyed: this.destroyed,
      ownedRunupPrimitiveCount: this.runupPrimitive === null ? 0 : 1,
      ownedInundationPrimitiveCount: this.inundationPrimitive === null ? 0 : 1,
      ownedLabelCount: this.labels.size,
      currentRunupItemCount: this.currentRunupItemCount,
      currentInundationItemCount: this.currentInundationItemCount,
      updateCount: this.updateCount,
      clearCount: this.clearCount,
      invalidInputCount: this.invalidInputCount,
      duplicateInputCount: this.duplicateInputCount,
      createdRunupPrimitiveCount: this.createdRunupPrimitiveCount,
      removedRunupPrimitiveCount: this.removedRunupPrimitiveCount,
      createdInundationPrimitiveCount: this.createdInundationPrimitiveCount,
      removedInundationPrimitiveCount: this.removedInundationPrimitiveCount,
      createdLabelCount: this.createdLabelCount,
      updatedLabelCount: this.updatedLabelCount,
      removedLabelCount: this.removedLabelCount,
      rollbackLabelUpdateCount: this.rollbackLabelUpdateCount,
      rollbackCount: this.rollbackCount,
      failedUpdateCount: this.failedUpdateCount,
    };
  }

  private releaseAll(): void {
    if (this.runupPrimitive !== null) {
      this.removeRunup(this.runupPrimitive);
      this.runupPrimitive = null;
    }
    if (this.inundationPrimitive !== null) {
      this.removeInundation(this.inundationPrimitive);
      this.inundationPrimitive = null;
    }
    for (const { handle } of this.labels.values()) {
      this.host.removeLabel(handle);
      this.removedLabelCount += 1;
    }
    this.labels.clear();
    this.currentRunupItemCount = 0;
    this.currentInundationItemCount = 0;
  }

  private removeRunup(primitive: RunupPrimitive): void {
    this.host.removeRunupPrimitive(primitive);
    this.removedRunupPrimitiveCount += 1;
  }

  private removeInundation(primitive: InundationPrimitive): void {
    this.host.removeInundationPrimitive(primitive);
    this.removedInundationPrimitiveCount += 1;
  }
}
