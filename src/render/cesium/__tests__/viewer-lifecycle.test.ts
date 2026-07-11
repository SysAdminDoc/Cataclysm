import { describe, expect, it } from "vitest";

import { ViewerLifecycle } from "../viewer-lifecycle";

describe("ViewerLifecycle", () => {
  it("destroys children in reverse order before the viewer", () => {
    const order: string[] = [];
    const viewer = {};
    const lifecycle = new ViewerLifecycle(viewer, 7, () => order.push("viewer"));
    lifecycle.own("listeners", () => order.push("listener"));
    lifecycle.ownSystem(() => order.push("system"));

    lifecycle.destroy();
    lifecycle.destroy();

    expect(order).toEqual(["system", "listener", "viewer"]);
    expect(lifecycle.diagnostics()).toEqual({
      generation: 7,
      destroyed: true,
      viewer_destroyed: true,
      resources: {
        entities: 0,
        primitives: 0,
        imagery: 0,
        textures: 0,
        rafs: 0,
        handlers: 0,
        listeners: 0,
        pendingAsync: 0,
      },
    });
  });

  it("leaks no resources across 100 viewer generations", () => {
    let viewersDestroyed = 0;
    for (let generation = 1; generation <= 100; generation += 1) {
      const lifecycle = new ViewerLifecycle({}, generation, () => { viewersDestroyed += 1; });
      lifecycle.own("entities", () => {});
      lifecycle.own("primitives", () => {});
      lifecycle.own("imagery", () => {});
      lifecycle.own("textures", () => {});
      lifecycle.own("rafs", () => {});
      lifecycle.own("handlers", () => {});
      lifecycle.own("listeners", () => {});
      lifecycle.own("pendingAsync", () => {});
      lifecycle.destroy();
      expect(Object.values(lifecycle.diagnostics().resources).every((count) => count === 0)).toBe(true);
    }
    expect(viewersDestroyed).toBe(100);
  });
});
