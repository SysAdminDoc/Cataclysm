// CesiumJS bootstrap. Loaded once on first use of <Globe />.
//
// Cesium needs its asset/worker paths configured before the first Viewer is
// constructed. vite.config.ts copies the assets to /cesium/ and defines a
// global `CESIUM_BASE_URL` for runtime.

import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

let configured = false;

export function configureCesium(): void {
  if (configured) return;
  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;
  const token = import.meta.env.VITE_CESIUM_TOKEN as string | undefined;
  if (token && token.length > 0) {
    Cesium.Ion.defaultAccessToken = token;
  }
  configured = true;
}

export function tokenConfigured(): boolean {
  const t = import.meta.env.VITE_CESIUM_TOKEN as string | undefined;
  return !!t && t.length > 0;
}
