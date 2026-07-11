import * as Cesium from "cesium";
import { describe, expect, it, vi } from "vitest";
import {
  CesiumInteractionOwnershipHost,
  type CesiumInteractionMode,
} from "../cesium-interaction-host";
import { InteractionOwnershipController } from "../interaction-ownership-controller";

function harness() {
  const canvas = document.createElement("canvas");
  let destroyed = false;
  let picked: Cesium.Cartesian3 | undefined = Cesium.Cartesian3.fromDegrees(12, 34);
  const entities = new Set<Cesium.Entity>();
  const remove = vi.fn((entity: Cesium.Entity) => entities.delete(entity));
  const viewer = {
    canvas,
    isDestroyed: () => destroyed,
    scene: {
      camera: {
        pickEllipsoid: () => picked,
      },
      globe: {
        ellipsoid: Cesium.Ellipsoid.WGS84,
      },
    },
    entities: {
      contains: (entity: Cesium.Entity) => entities.has(entity),
      remove,
    },
  } as unknown as Cesium.Viewer;
  return {
    canvas,
    entities,
    remove,
    viewer,
    setDestroyed: (value: boolean) => { destroyed = value; },
    setPicked: (value: Cesium.Cartesian3 | undefined) => { picked = value; },
  };
}

function click(handler: Cesium.ScreenSpaceEventHandler): void {
  const action = handler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (!action) throw new Error("expected left-click action");
  (action as unknown as (event: { position: Cesium.Cartesian2 }) => void)({
    position: new Cesium.Cartesian2(1, 1),
  });
}

describe("CesiumInteractionOwnershipHost", () => {
  it("maps pick clicks to WGS84 degrees and owns cursor/Escape teardown", () => {
    const test = harness();
    const positions: Array<[number, number]> = [];
    let cancels = 0;
    const mode: CesiumInteractionMode = {
      kind: "pick",
      onPosition: (lat, lon) => positions.push([lat, lon]),
      onCancel: () => cancels++,
    };
    const host = new CesiumInteractionOwnershipHost(test.viewer);
    const handler = host.attachHandler(mode, 1);
    const listener = host.attachListener(mode, 1);

    expect(test.canvas.style.cursor).toBe("crosshair");
    click(handler);
    expect(positions).toHaveLength(1);
    expect(positions[0][0]).toBeCloseTo(34, 8);
    expect(positions[0][1]).toBeCloseTo(12, 8);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(cancels).toBe(1);

    host.detachListener(listener);
    host.detachListener(listener);
    host.detachHandler(handler);
    host.detachHandler(handler);
    expect(handler.isDestroyed()).toBe(true);
    expect(test.canvas.style.cursor).toBe("");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(cancels).toBe(1);
  });

  it("uses inspect cursor, ignores missed ellipsoid picks, and enforces one owned pair", () => {
    const test = harness();
    let positions = 0;
    const mode: CesiumInteractionMode = {
      kind: "inspect",
      onPosition: () => positions++,
      onCancel() {},
    };
    const host = new CesiumInteractionOwnershipHost(test.viewer);
    const handler = host.attachHandler(mode, 7);
    const listener = host.attachListener(mode, 7);
    expect(listener.generation).toBe(7);
    expect(test.canvas.style.cursor).toBe("help");
    test.setPicked(undefined);
    click(handler);
    expect(positions).toBe(0);
    expect(() => host.attachHandler(mode, 8)).toThrow(/already owns/i);
    expect(() => host.attachListener(mode, 8)).toThrow(/already owns/i);
    host.detachListener(listener);
    host.detachHandler(handler);
  });

  it("integrates with ownership controller and removes its inspect entity on disable", () => {
    const test = harness();
    const host = new CesiumInteractionOwnershipHost(test.viewer);
    const controller = new InteractionOwnershipController(host);
    const mode: CesiumInteractionMode = {
      kind: "inspect",
      onPosition() {},
      onCancel: () => controller.disable(),
    };
    const lease = controller.enable(mode);
    if (!lease) throw new Error("expected interaction lease");
    const entity = new Cesium.Entity();
    test.entities.add(entity);
    expect(controller.ownEntity(lease.generation, entity)).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(test.entities.size).toBe(0);
    expect(test.remove).toHaveBeenCalledWith(entity);
    expect(test.canvas.style.cursor).toBe("");
    expect(controller.diagnostics()).toMatchObject({
      enabled: false,
      ownedHandlerCount: 0,
      ownedListenerCount: 0,
      ownedEntityCount: 0,
    });
  });

  it("tears down listeners/handlers safely and skips entity removal after viewer destruction", () => {
    const test = harness();
    let cancels = 0;
    const mode: CesiumInteractionMode = {
      kind: "pick",
      onPosition() {},
      onCancel: () => cancels++,
    };
    const host = new CesiumInteractionOwnershipHost(test.viewer);
    const handler = host.attachHandler(mode, 1);
    const listener = host.attachListener(mode, 1);
    const entity = new Cesium.Entity();
    test.entities.add(entity);
    test.setDestroyed(true);

    expect(() => host.detachListener(listener)).not.toThrow();
    expect(() => host.detachHandler(handler)).not.toThrow();
    expect(() => host.removeEntity(entity)).not.toThrow();
    expect(test.remove).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(cancels).toBe(0);
    expect(() => host.attachHandler(mode, 2)).toThrow(/destroyed/i);
  });
});
