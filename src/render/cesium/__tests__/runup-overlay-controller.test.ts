import { describe, expect, it } from "vitest";
import {
  RunupOverlayController,
  type InundationPrimitivePresentation,
  type RunupLabelPresentation,
  type RunupOverlayHost,
  type RunupOverlayInput,
  type RunupPrimitivePresentation,
} from "../runup-overlay-controller";

interface Handle {
  id: number;
}

function point(overrides: Partial<RunupOverlayInput> = {}): RunupOverlayInput {
  return {
    id: "b",
    name: "Bravo",
    lat: 20,
    lon: -80,
    range_m: 1_000,
    offshore_amplitude_m: 1.234,
    runup_m: 5,
    arrival_time_s: 3_900,
    has_arrived: true,
    inundation_extent_m: 1_000,
    ...overrides,
  };
}

function harness() {
  let nextId = 1;
  const runupPrimitives = new Set<Handle>();
  const inundationPrimitives = new Set<Handle>();
  const labels = new Map<Handle, RunupLabelPresentation>();
  const runupBatches: RunupPrimitivePresentation[][] = [];
  const inundationBatches: InundationPrimitivePresentation[][] = [];
  let failInundation = false;
  let failLabelId: string | null = null;
  const host: RunupOverlayHost<Handle, Handle, Handle> = {
    createRunupPrimitive: (presentations) => {
      const handle = { id: nextId++ };
      runupPrimitives.add(handle);
      runupBatches.push(presentations.map((presentation) => ({ ...presentation })));
      return handle;
    },
    removeRunupPrimitive: (primitive) => {
      runupPrimitives.delete(primitive);
    },
    createInundationPrimitive: (presentations) => {
      if (failInundation) throw new Error("inundation construction failed");
      const handle = { id: nextId++ };
      inundationPrimitives.add(handle);
      inundationBatches.push(presentations.map((presentation) => ({ ...presentation })));
      return handle;
    },
    removeInundationPrimitive: (primitive) => {
      inundationPrimitives.delete(primitive);
    },
    createLabel: (presentation) => {
      if (presentation.id === failLabelId) throw new Error("label construction failed");
      const handle = { id: nextId++ };
      labels.set(handle, { ...presentation });
      return handle;
    },
    updateLabel: (label, presentation) => {
      labels.set(label, { ...presentation });
    },
    removeLabel: (label) => {
      labels.delete(label);
    },
  };
  const controller = new RunupOverlayController(host);
  return {
    controller,
    runupPrimitives,
    inundationPrimitives,
    labels,
    runupBatches,
    inundationBatches,
    setFailInundation: (value: boolean) => {
      failInundation = value;
    },
    setFailLabelId: (value: string | null) => {
      failLabelId = value;
    },
  };
}

describe("RunupOverlayController", () => {
  it("validates, deduplicates, sorts, and preserves presentation calculations", () => {
    const { controller, runupBatches, inundationBatches, labels } = harness();
    controller.update([
      point({ id: "z", name: "Zulu", runup_m: 2, inundation_extent_m: 80_000 }),
      point({ id: "a", name: "Alpha", runup_m: 0.2, arrival_time_s: 600 }),
      point({ id: "bad", lat: 100 }),
      point({ id: "duplicate", name: "One" }),
      point({ id: "duplicate", name: "Two" }),
    ]);

    expect(runupBatches[0].map((entry) => entry.id)).toEqual(["a", "z"]);
    expect(runupBatches[0][0]).toMatchObject({
      heightM: 5_000,
      colorCss: "#a6e3a1",
      colorAlpha: 0.85,
      outlineColorCss: "#11111b",
      outlineAlpha: 0.6,
      outlineWidth: 1,
      width: 8,
    });
    expect(inundationBatches[0].map((entry) => entry.id)).toEqual([
      "inundation-a",
      "inundation-z",
    ]);
    expect(inundationBatches[0][1]).toMatchObject({
      radiusM: 50_000,
      segments: 40,
      colorCss: "#f9e2af",
      colorAlpha: 0.25,
      outlineAlpha: 0.7,
      outlineWidth: 2,
    });
    expect([...labels.values()][0].text).toBe("Alpha\nT+10m  -  0.2 m runup\n1.23 m offshore");
    expect(controller.diagnostics()).toMatchObject({
      ownedRunupPrimitiveCount: 1,
      ownedInundationPrimitiveCount: 1,
      ownedLabelCount: 2,
      invalidInputCount: 1,
      duplicateInputCount: 2,
    });
  });

  it("keeps label handles stable and removes only labels no longer present", () => {
    const { controller, labels } = harness();
    controller.update([point({ id: "a" }), point({ id: "b" })]);
    const initialHandles = [...labels.keys()];
    controller.update([
      point({ id: "a", runup_m: 8 }),
      point({ id: "b" }),
      point({ id: "c" }),
    ]);
    expect(labels.has(initialHandles[0])).toBe(true);
    expect(labels.has(initialHandles[1])).toBe(true);
    expect(labels.size).toBe(3);
    controller.update([point({ id: "a", runup_m: 8 })]);
    expect(labels.has(initialHandles[0])).toBe(true);
    expect(labels.size).toBe(1);
    expect(controller.diagnostics()).toMatchObject({
      createdLabelCount: 3,
      updatedLabelCount: 1,
      removedLabelCount: 2,
      ownedLabelCount: 1,
    });
  });

  it("rolls back a partially constructed primitive update", () => {
    const {
      controller,
      runupPrimitives,
      inundationPrimitives,
      labels,
      setFailInundation,
    } = harness();
    controller.update([point({ id: "a" })]);
    const originalRunup = [...runupPrimitives][0];
    const originalInundation = [...inundationPrimitives][0];
    const originalLabel = [...labels.keys()][0];
    setFailInundation(true);
    expect(() => controller.update([point({ id: "a", runup_m: 12 })])).toThrow(
      "inundation construction failed",
    );
    expect([...runupPrimitives]).toEqual([originalRunup]);
    expect([...inundationPrimitives]).toEqual([originalInundation]);
    expect([...labels.keys()]).toEqual([originalLabel]);
    expect(controller.diagnostics()).toMatchObject({
      ownedRunupPrimitiveCount: 1,
      ownedInundationPrimitiveCount: 1,
      ownedLabelCount: 1,
      rollbackCount: 1,
      failedUpdateCount: 1,
      createdRunupPrimitiveCount: 2,
      removedRunupPrimitiveCount: 1,
    });
  });

  it("restores updated labels when later label construction fails", () => {
    const { controller, labels, runupPrimitives, inundationPrimitives, setFailLabelId } = harness();
    controller.update([point({ id: "a", name: "Original" })]);
    const originalRunup = [...runupPrimitives][0];
    const originalInundation = [...inundationPrimitives][0];
    const originalLabel = [...labels.entries()][0];
    setFailLabelId("b");
    expect(() =>
      controller.update([
        point({ id: "a", name: "Changed", runup_m: 7 }),
        point({ id: "b" }),
      ]),
    ).toThrow("label construction failed");
    expect(labels.get(originalLabel[0])).toEqual(originalLabel[1]);
    expect([...runupPrimitives]).toEqual([originalRunup]);
    expect([...inundationPrimitives]).toEqual([originalInundation]);
    expect(controller.diagnostics()).toMatchObject({
      ownedLabelCount: 1,
      rollbackLabelUpdateCount: 1,
      rollbackCount: 1,
      failedUpdateCount: 1,
    });
  });

  it("leaves zero primitives and labels after 100 update/clear cycles", () => {
    const { controller, runupPrimitives, inundationPrimitives, labels } = harness();
    for (let cycle = 0; cycle < 100; cycle += 1) {
      controller.update([
        point({ id: "a", runup_m: 1 + cycle / 10 }),
        point({ id: "b", inundation_extent_m: 200 + cycle }),
      ]);
      controller.clear();
      expect(runupPrimitives.size).toBe(0);
      expect(inundationPrimitives.size).toBe(0);
      expect(labels.size).toBe(0);
      expect(controller.diagnostics()).toMatchObject({
        ownedRunupPrimitiveCount: 0,
        ownedInundationPrimitiveCount: 0,
        ownedLabelCount: 0,
      });
    }
    controller.destroy();
    controller.destroy();
    expect(controller.diagnostics()).toMatchObject({
      destroyed: true,
      updateCount: 100,
      clearCount: 100,
      createdRunupPrimitiveCount: 100,
      removedRunupPrimitiveCount: 100,
      createdInundationPrimitiveCount: 100,
      removedInundationPrimitiveCount: 100,
      createdLabelCount: 200,
      removedLabelCount: 200,
      ownedRunupPrimitiveCount: 0,
      ownedInundationPrimitiveCount: 0,
      ownedLabelCount: 0,
    });
  });
});
