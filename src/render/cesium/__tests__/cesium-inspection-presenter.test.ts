import * as Cesium from "cesium";
import { describe, expect, it, vi } from "vitest";
import { CesiumInspectionPresenter } from "../cesium-inspection-presenter";

class FakeEntityCollection {
  readonly values: Cesium.Entity[] = [];

  add(options: ConstructorParameters<typeof Cesium.Entity>[0]): Cesium.Entity {
    const entity = new Cesium.Entity(options);
    this.values.push(entity);
    return entity;
  }

  contains(entity: Cesium.Entity): boolean {
    return this.values.includes(entity);
  }

  remove(entity: Cesium.Entity): boolean {
    const index = this.values.indexOf(entity);
    if (index < 0) return false;
    this.values.splice(index, 1);
    return true;
  }
}

function harness() {
  const entities = new FakeEntityCollection();
  const requestRender = vi.fn();
  let destroyed = false;
  const viewer = {
    entities,
    scene: { requestRender },
    isDestroyed: () => destroyed,
  } as unknown as Cesium.Viewer;
  return {
    entities,
    requestRender,
    viewer,
    destroyViewer() { destroyed = true; },
  };
}

describe("CesiumInspectionPresenter", () => {
  it("preserves marker and label styling", () => {
    const test = harness();
    const presenter = new CesiumInspectionPresenter(test.viewer, 4);
    presenter.present({ lat: 10, lon: 20, text: "Inspection result" });

    const entity = presenter.entity;
    expect(entity?.point?.pixelSize?.getValue()).toBe(10);
    expect(entity?.point?.color?.getValue()).toEqual(Cesium.Color.fromCssColorString("#89dceb"));
    expect(entity?.point?.outlineColor?.getValue()).toEqual(Cesium.Color.fromCssColorString("#11111b"));
    expect(entity?.point?.outlineWidth?.getValue()).toBe(2);
    expect(entity?.label?.text?.getValue()).toBe("Inspection result");
    expect(entity?.label?.font?.getValue()).toBe("11px Inter, sans-serif");
    expect(entity?.label?.fillColor?.getValue()).toEqual(Cesium.Color.fromCssColorString("#cdd6f4"));
    expect(entity?.label?.outlineWidth?.getValue()).toBe(2);
    expect(entity?.label?.verticalOrigin?.getValue()).toBe(Cesium.VerticalOrigin.BOTTOM);
    expect(entity?.label?.showBackground?.getValue()).toBe(true);
    expect(entity?.label?.backgroundColor?.getValue().alpha).toBeCloseTo(0.92);
  });

  it("updates one stable entity handle in place", () => {
    const test = harness();
    const presenter = new CesiumInspectionPresenter(test.viewer, 1);
    presenter.present({ lat: 10, lon: 20, text: "First" });
    const first = presenter.entity;
    presenter.present({ lat: -5, lon: 140, text: "Second" });

    expect(presenter.entity).toBe(first);
    expect(test.entities.values).toEqual([first]);
    expect(first?.label?.text?.getValue()).toBe("Second");
    expect(presenter.diagnostics).toMatchObject({
      active_entities: 1,
      cumulative: { created: 1, updated: 1, removed: 0 },
      resources: { entities: 1 },
    });
  });

  it("rejects invalid coordinates and clears an active marker", () => {
    const test = harness();
    const presenter = new CesiumInspectionPresenter(test.viewer, 2);
    presenter.present({ lat: 0, lon: 0, text: "Valid" });
    const diagnostics = presenter.present({ lat: Number.NaN, lon: 0, text: "Invalid" });

    expect(test.entities.values).toHaveLength(0);
    expect(diagnostics).toMatchObject({
      active_entities: 0,
      last_update: { removed: 1, invalid_inputs: 1 },
      resources: { entities: 0 },
    });
  });

  it("keeps unchanged presentations allocation-free", () => {
    const test = harness();
    const presenter = new CesiumInspectionPresenter(test.viewer, 3);
    const value = { lat: 1, lon: 2, text: "Same" };
    presenter.present(value);
    const diagnostics = presenter.present(value);

    expect(test.entities.values).toHaveLength(1);
    expect(diagnostics).toMatchObject({
      last_update: { unchanged: 1 },
      cumulative: { created: 1, updated: 0, unchanged: 1 },
    });
    expect(test.requestRender).toHaveBeenCalledOnce();
  });

  it("returns to zero resources through 100 complete result cycles", () => {
    const test = harness();
    const presenter = new CesiumInspectionPresenter(test.viewer, 5);
    for (let cycle = 0; cycle < 100; cycle += 1) {
      presenter.present({ lat: cycle % 90, lon: cycle % 180, text: `Result ${cycle}` });
      expect(presenter.diagnostics.active_entities).toBe(1);
      presenter.clear();
      expect(presenter.diagnostics.resources.entities).toBe(0);
      expect(test.entities.values).toHaveLength(0);
    }

    expect(presenter.diagnostics).toMatchObject({
      active_entities: 0,
      cumulative: { created: 100, removed: 100 },
      resources: { entities: 0 },
    });
  });

  it("destroys safely and remains idempotent after the viewer is gone", () => {
    const test = harness();
    const presenter = new CesiumInspectionPresenter(test.viewer, 6);
    presenter.present({ lat: 0, lon: 0, text: "Result" });
    test.destroyViewer();

    presenter.destroy();
    presenter.destroy();
    presenter.clear();
    expect(presenter.diagnostics).toMatchObject({
      destroyed: true,
      active_entities: 0,
      resources: { entities: 0 },
    });
    expect(() => presenter.present({ lat: 0, lon: 0, text: "Late" })).toThrow(
      "CesiumInspectionPresenter is destroyed.",
    );
  });
});
