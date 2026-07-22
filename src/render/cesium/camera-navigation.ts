export type CameraNavigationAction =
  | "pan-up"
  | "pan-down"
  | "pan-left"
  | "pan-right"
  | "rotate-left"
  | "rotate-right"
  | "zoom-in"
  | "zoom-out";

export type CameraNavigationPort = Readonly<{
  positionCartographic: Readonly<{ height: number }>;
  moveUp(amount?: number): void;
  moveDown(amount?: number): void;
  moveLeft(amount?: number): void;
  moveRight(amount?: number): void;
  rotateLeft(angle?: number): void;
  rotateRight(angle?: number): void;
  zoomIn(amount?: number): void;
  zoomOut(amount?: number): void;
}>;

export const CAMERA_ROTATION_STEP_RAD = Math.PI / 12;

export function cameraTranslationStepM(heightM: number): number {
  const finiteHeight = Number.isFinite(heightM) ? Math.abs(heightM) : 0;
  return Math.min(2_000_000, Math.max(1_000, finiteHeight * 0.12));
}

export function applyCameraNavigation(
  camera: CameraNavigationPort,
  action: CameraNavigationAction,
): void {
  const translationStepM = cameraTranslationStepM(camera.positionCartographic.height);
  switch (action) {
    case "pan-up": camera.moveUp(translationStepM); break;
    case "pan-down": camera.moveDown(translationStepM); break;
    case "pan-left": camera.moveLeft(translationStepM); break;
    case "pan-right": camera.moveRight(translationStepM); break;
    case "rotate-left": camera.rotateLeft(CAMERA_ROTATION_STEP_RAD); break;
    case "rotate-right": camera.rotateRight(CAMERA_ROTATION_STEP_RAD); break;
    case "zoom-in": camera.zoomIn(translationStepM); break;
    case "zoom-out": camera.zoomOut(translationStepM); break;
  }
}
