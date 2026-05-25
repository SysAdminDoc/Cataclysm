/**
 * Scenario export helpers. v0.1.x ships PNG-of-globe export. v0.3.0 will
 * add MP4 timeline recording + CZML deep-link import.
 */

import type { InitialDisplacement, Preset } from "../types/scenario";

/** Find the Cesium globe canvas. */
function findGlobeCanvas(): HTMLCanvasElement | null {
  // Cesium adds class `cesium-widget` to its container; the canvas lives inside.
  const w = document.querySelector(".cesium-widget canvas") as HTMLCanvasElement | null;
  return w;
}

export type ScreenshotMeta = {
  preset?: Preset | null;
  initial?: InitialDisplacement | null;
  timeS: number;
};

function timestampSuffix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function suggestedFilename(meta: ScreenshotMeta): string {
  const id = meta.preset?.id ?? "custom-scenario";
  const t = Math.round(meta.timeS / 60);
  return `tsunamisim-${id}-t${t}min-${timestampSuffix()}.png`;
}

/** Returns the globe canvas contents as a PNG data URL, or null if it's not mountable. */
export function captureGlobePng(): string | null {
  const canvas = findGlobeCanvas();
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.error("Failed to capture globe canvas:", err);
    return null;
  }
}

/** Trigger a download of the data URL using the standard `<a download>` pattern. */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Full export flow — capture + download. Returns true if a screenshot was produced. */
export function exportGlobePng(meta: ScreenshotMeta): boolean {
  const url = captureGlobePng();
  if (!url) return false;
  downloadDataUrl(url, suggestedFilename(meta));
  return true;
}
