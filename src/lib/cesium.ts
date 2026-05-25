// CesiumJS bootstrap. Loaded once on first use of <Globe />.
//
// Cesium needs its asset/worker paths configured before the first Viewer is
// constructed. vite.config.ts copies the assets to /cesium/ and defines a
// global `CESIUM_BASE_URL` for runtime.
//
// Token resolution priority:
//   1. Token from persistent settings store (user-pasted in Settings panel)
//   2. VITE_CESIUM_TOKEN env var (fallback for `npm run dev` workflow)
// Both paths avoid bundling the token in the production JS — the env var is
// only inlined when the developer sets it during their own build.

import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

let configured = false;
let cachedToken: string | null = null;

export function configureCesium(): void {
  if (configured) return;
  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;
  configured = true;
}

/**
 * Synchronously check whether a token is available right now. This is used as
 * the v0.0.x gate on whether the Cesium viewer should even mount. For new
 * tokens entered via the Settings UI, call `primeCesiumToken(token)` first.
 */
export function tokenConfigured(): boolean {
  if (cachedToken && cachedToken.length > 0) return true;
  const envTok = import.meta.env.VITE_CESIUM_TOKEN as string | undefined;
  return !!envTok && envTok.length > 0;
}

/**
 * Prime the Cesium default token. Called by the Settings UI when the user
 * pastes a token, and during app boot from persisted settings. Passing
 * null/empty clears the cached token (so ion-backed styles fail-fast back
 * to OSM rather than retrying with a stale value).
 */
export function primeCesiumToken(token: string | null | undefined): void {
  const trimmed = (token ?? "").trim();
  if (!trimmed) {
    const envTok = import.meta.env.VITE_CESIUM_TOKEN as string | undefined;
    if (envTok && envTok.length > 0) {
      Cesium.Ion.defaultAccessToken = envTok;
      cachedToken = envTok;
    } else {
      // Explicit clear — Cesium ion APIs will now reject and the Globe
      // fallback path will choose OSM.
      Cesium.Ion.defaultAccessToken = "";
      cachedToken = null;
    }
    return;
  }
  Cesium.Ion.defaultAccessToken = trimmed;
  cachedToken = trimmed;
}
