import { describe, expect, it, vi } from "vitest";

import {
  applyCameraNavigation,
  CAMERA_ROTATION_STEP_RAD,
  cameraTranslationStepM,
  type CameraNavigationPort,
} from "../camera-navigation";

function camera(height = 10_000) {
  return {
    positionCartographic: { height },
    moveUp: vi.fn<(amount?: number) => void>(),
    moveDown: vi.fn<(amount?: number) => void>(),
    moveLeft: vi.fn<(amount?: number) => void>(),
    moveRight: vi.fn<(amount?: number) => void>(),
    rotateLeft: vi.fn<(amount?: number) => void>(),
    rotateRight: vi.fn<(amount?: number) => void>(),
    zoomIn: vi.fn<(amount?: number) => void>(),
    zoomOut: vi.fn<(amount?: number) => void>(),
  } satisfies CameraNavigationPort;
}

describe("camera navigation alternatives", () => {
  it("bounds the translation step at close and planetary views", () => {
    expect(cameraTranslationStepM(Number.NaN)).toBe(1_000);
    expect(cameraTranslationStepM(2_000)).toBe(1_000);
    expect(cameraTranslationStepM(100_000)).toBe(12_000);
    expect(cameraTranslationStepM(100_000_000)).toBe(2_000_000);
  });

  it.each([
    ["pan-up", "moveUp", 1_200],
    ["pan-down", "moveDown", 1_200],
    ["pan-left", "moveLeft", 1_200],
    ["pan-right", "moveRight", 1_200],
    ["zoom-in", "zoomIn", 1_200],
    ["zoom-out", "zoomOut", 1_200],
    ["rotate-left", "rotateLeft", CAMERA_ROTATION_STEP_RAD],
    ["rotate-right", "rotateRight", CAMERA_ROTATION_STEP_RAD],
  ] as const)("maps %s to the Cesium camera port", (action, method, expected) => {
    const port = camera();
    applyCameraNavigation(port, action);
    expect(port[method]).toHaveBeenCalledWith(expected);
  });
});
