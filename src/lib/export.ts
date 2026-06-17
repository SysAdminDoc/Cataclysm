/**
 * Scenario export helpers. v0.1.x shipped PNG-of-globe export; v0.3.0
 * adds WebM/MP4 timeline recording via the browser-native MediaRecorder
 * (no extra muxer dependency, works on Chromium/WebView2 and modern WKWebView).
 */

import type { InitialDisplacement, Preset } from "../types/scenario";
import { isTauri } from "./tauri";

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

function isForbiddenFilenameChar(ch: string): boolean {
  return ch.charCodeAt(0) <= 0x1f || '<>:"/\\|?*'.includes(ch);
}

function safeFilenamePart(value: string): string {
  const cleaned = value
    .trim()
    .split("")
    .map((ch) => (isForbiddenFilenameChar(ch) ? "-" : ch))
    .join("")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const base = cleaned || "custom-scenario";
  // Windows reserved device names (CON, NUL, COM1…) can make a download fail
  // or behave oddly on WebView2 — prefix to neutralise them.
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(base) ? `_${base}` : base;
}

export function suggestedFilename(meta: ScreenshotMeta, ext: "png" | "webm" | "mp4" = "png"): string {
  // Clamp the id so a very long preset/scenario name + timestamp can't blow
  // past path length limits (the extension is appended after the clamp).
  const id = safeFilenamePart(meta.preset?.id ?? "custom-scenario").slice(0, 64);
  const t = Math.round(meta.timeS / 60);
  return `tsunamisim-${id}-t${t}min-${timestampSuffix()}.${ext}`;
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
  a.download = safeFilenamePart(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Trigger a download of a Blob using the standard `<a download>` pattern. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFilenamePart(filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Yield to the download dispatch then release the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
}

function stampDemoWatermark(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const text = "BROWSER PREVIEW — APPROXIMATE";
  ctx.save();
  ctx.font = "bold 18px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const x = canvas.width / 2;
  const y = canvas.height - 30;
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  const m = ctx.measureText(text);
  ctx.fillRect(x - m.width / 2 - 12, y - 14, m.width + 24, 28);
  ctx.fillStyle = "#fab387";
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Full export flow — capture + download. Returns true if a screenshot was produced. */
export function exportGlobePng(meta: ScreenshotMeta): boolean {
  const sourceCanvas = findGlobeCanvas();
  if (!sourceCanvas) return false;
  if (!isTauri()) {
    const offscreen = document.createElement("canvas");
    offscreen.width = sourceCanvas.width;
    offscreen.height = sourceCanvas.height;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(sourceCanvas, 0, 0);
    stampDemoWatermark(offscreen);
    downloadDataUrl(offscreen.toDataURL("image/png"), suggestedFilename(meta, "png"));
    return true;
  }
  const url = captureGlobePng();
  if (!url) return false;
  downloadDataUrl(url, suggestedFilename(meta, "png"));
  return true;
}

/** F4-09 — Share-card export. Composites the bare globe canvas with a
 *  200-px-tall header strip containing preset name, key parameters,
 *  citation short-ref, and the project URL. The header strip is rendered
 *  to a 1200×800 share-card-friendly aspect via an offscreen canvas
 *  (no external library needed). Includes a footer "Educational only —
 *  not for evacuation" trust-signal to preserve product framing. */
export function exportGlobeShareCard(meta: ScreenshotMeta): boolean {
  const sourceCanvas = findGlobeCanvas();
  if (!sourceCanvas) return false;

  const W = 1200;
  const H = 800;
  const HEADER_H = 100;
  const FOOTER_H = 40;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  // Background — match the Catppuccin Mocha base so the card reads as
  // 'made by the same app' on dark or light social timelines.
  ctx.fillStyle = "#1e1e2e";
  ctx.fillRect(0, 0, W, H);

  // Globe canvas content fills the middle band.
  const globeY = HEADER_H;
  const globeH = H - HEADER_H - FOOTER_H;
  ctx.drawImage(sourceCanvas, 0, globeY, W, globeH);

  // Header strip.
  ctx.fillStyle = "#181825";
  ctx.fillRect(0, 0, W, HEADER_H);

  const presetName = meta.preset?.name ?? "Custom scenario";
  const date = meta.preset?.date ?? "—";
  const ref = meta.preset?.reference ?? "";
  const initialAmp = meta.initial?.peak_amplitude_m;
  const energyJ = meta.initial?.source_energy_j;
  const mwEq = meta.initial?.seismic_mw_equivalent;

  ctx.fillStyle = "#cdd6f4";
  ctx.font = "bold 28px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(presetName, 24, 16);

  ctx.fillStyle = "#a6adc8";
  ctx.font = "16px Inter, system-ui, sans-serif";
  ctx.fillText(date, 24, 52);

  // Parameter strip on the right side of the header.
  const params: string[] = [];
  if (initialAmp !== undefined && Number.isFinite(initialAmp)) {
    params.push(`A₀ ${initialAmp.toFixed(1)} m`);
  }
  if (mwEq !== undefined && Number.isFinite(mwEq)) {
    params.push(`M_w ≈ ${mwEq.toFixed(1)}`);
  }
  if (energyJ !== undefined && Number.isFinite(energyJ)) {
    const mt = energyJ / 4.184e15;
    if (mt >= 1) params.push(`E ≈ ${mt.toFixed(1)} Mt TNT`);
    else if (mt >= 1e-3) params.push(`E ≈ ${(mt * 1000).toFixed(1)} kt TNT`);
  }
  ctx.fillStyle = "#89b4fa";
  ctx.font = "bold 16px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(params.join("   ·   "), W - 24, 16);

  ctx.fillStyle = "#a6adc8";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillText(`t = ${(meta.timeS / 60).toFixed(0)} min`, W - 24, 52);

  if (ref) {
    ctx.fillStyle = "#6c7086";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(ref.slice(0, 100), W - 24, 76);
  }
  ctx.textAlign = "left";

  // Footer trust strip.
  ctx.fillStyle = "#11111b";
  ctx.fillRect(0, H - FOOTER_H, W, FOOTER_H);
  ctx.fillStyle = "#fab387";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(
    "TsunamiSimulator · Educational only · Not for evacuation · github.com/SysAdminDoc/TsunamiSimulator",
    24,
    H - FOOTER_H / 2,
  );

  if (!isTauri()) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(W / 2 - 180, H / 2 - 16, 360, 32);
    ctx.fillStyle = "#fab387";
    ctx.font = "bold 16px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BROWSER PREVIEW — APPROXIMATE", W / 2, H / 2);
    ctx.textAlign = "left";
  }

  const dataUrl = canvas.toDataURL("image/png");
  downloadDataUrl(dataUrl, suggestedFilename(meta, "png").replace(".png", "-share.png"));
  return true;
}

/** Pick the best video MIME the current WebView supports. WebM/VP9 is the
 *  most portable; Safari WKWebView only supports MP4/H.264. Fallback to
 *  whatever MediaRecorder.isTypeSupported reports as available. */
function pickVideoMime(): { mime: string; ext: "webm" | "mp4" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: { mime: string; ext: "webm" | "mp4" }[] = [
    { mime: "video/webm;codecs=vp9", ext: "webm" },
    { mime: "video/webm;codecs=vp8", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
    { mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
}

export type VideoExportOptions = {
  /** Frame rate of the captured stream, fps. Default 30. */
  fps?: number;
  /** Total record duration in milliseconds. Default 6 000 (6 s). */
  durationMs?: number;
  /** Bitrate in bits/sec. Default 6 Mbps. */
  bitsPerSecond?: number;
};

/** Record the live Cesium canvas to a video file via MediaRecorder +
 *  canvas.captureStream. Caller should drive the timeline scrub
 *  (SwePlayback Play) just before invoking so the recording captures
 *  the propagating-wave animation. */
export async function exportGlobeVideo(
  meta: ScreenshotMeta,
  opts: VideoExportOptions = {},
): Promise<{ ok: true; ext: "webm" | "mp4"; size: number } | { ok: false; reason: string }> {
  const canvas = findGlobeCanvas();
  if (!canvas) return { ok: false, reason: "Globe canvas not mounted" };
  const mime = pickVideoMime();
  if (!mime) {
    return {
      ok: false,
      reason: "MediaRecorder unsupported by this WebView — no video codecs available",
    };
  }
  const fps = Math.min(60, Math.max(1, Math.round(opts.fps ?? 30)));
  const durationMs = Math.min(30_000, Math.max(1_000, Math.round(opts.durationMs ?? 6_000)));
  const bitsPerSecond = Math.min(25_000_000, Math.max(500_000, Math.round(opts.bitsPerSecond ?? 6_000_000)));
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime.mime,
    bitsPerSecond,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  let settled = false;
  const stopped = new Promise<void>((resolve, reject) => {
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    recorder.onstop = () => settle(resolve);
    recorder.onerror = () => settle(() => reject(new Error("MediaRecorder failed while recording")));
    // Watchdog: some WebView2 codec paths never fire onstop/onerror, which
    // would hang `await stopped` forever and leave the capture stream live.
    setTimeout(
      () => settle(() => reject(new Error("Recording timed out (no stop event from MediaRecorder)"))),
      durationMs + 5_000,
    );
  });
  try {
    recorder.start();
    await new Promise((r) => setTimeout(r, durationMs));
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
  const blob = new Blob(chunks, { type: mime.mime });
  if (blob.size === 0) {
    return { ok: false, reason: "Video encoder produced an empty recording" };
  }
  downloadBlob(blob, suggestedFilename(meta, mime.ext));
  return { ok: true, ext: mime.ext, size: blob.size };
}

/** Export SWE simulation snapshots as a CZML document for playback in
 *  any CesiumJS viewer. Each snapshot's PNG becomes a time-interval
 *  rectangle overlay. */
export function exportCzml(
  meta: ScreenshotMeta,
  snapshots: import("../types/scenario").GridSnapshot[],
): boolean {
  if (!snapshots.length) return false;

  const epoch = "2024-01-01T00:00:00Z";
  const epochMs = new Date(epoch).getTime();

  function toIso(s: number): string {
    return new Date(epochMs + s * 1000).toISOString().replace(/\.000Z$/, "Z");
  }

  const tStart = snapshots[0].time_s;
  const tEnd = snapshots[snapshots.length - 1].time_s;
  const interval = `${toIso(tStart)}/${toIso(Math.max(tEnd, tStart + 1))}`;

  const materialIntervals: unknown[] = [];
  for (let k = 0; k < snapshots.length; k++) {
    const snap = snapshots[k];
    const next = k + 1 < snapshots.length ? snapshots[k + 1].time_s : tEnd + 1;
    materialIntervals.push({
      interval: `${toIso(snap.time_s)}/${toIso(next)}`,
      image: `data:image/png;base64,${snap.eta_png_b64}`,
      repeat: { cartesian2: [1, 1] },
      color: { rgba: [255, 255, 255, 230] },
    });
  }

  const [west, south, east, north] = snapshots[0].bbox;

  const czml = [
    {
      id: "document",
      name: meta.preset?.name ?? "TsunamiSimulator Export",
      version: "1.0",
      clock: {
        interval,
        currentTime: toIso(tStart),
        multiplier: 60,
        range: "LOOP_STOP",
        step: "SYSTEM_CLOCK_MULTIPLIER",
      },
    },
    {
      id: "wave-field",
      name: "SWE wave field",
      availability: interval,
      description: `TsunamiSimulator ${meta.preset?.name ?? "custom"} — ${snapshots.length} snapshots`,
      rectangle: {
        coordinates: { wsenDegrees: [west, south, east, north] },
        material: { image: { image: materialIntervals } },
        height: 0,
      },
    },
  ];

  const json = JSON.stringify(czml, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const presetId = meta.preset?.id ?? "custom-scenario";
  downloadBlob(blob, `tsunamisim-${safeFilenamePart(presetId)}.czml`);
  return true;
}
