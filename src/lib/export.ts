/**
 * Scenario export helpers. v0.1.x shipped PNG-of-globe export; v0.3.0
 * adds WebM/MP4 timeline recording via the browser-native MediaRecorder
 * (no extra muxer dependency, works on Chromium/WebView2 and modern WKWebView).
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

export function suggestedFilename(meta: ScreenshotMeta, ext: "png" | "webm" | "mp4" = "png"): string {
  const id = meta.preset?.id ?? "custom-scenario";
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
  a.download = filename;
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
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Yield to the download dispatch then release the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
}

/** Full export flow — capture + download. Returns true if a screenshot was produced. */
export function exportGlobePng(meta: ScreenshotMeta): boolean {
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
  const stream = canvas.captureStream(opts.fps ?? 30);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime.mime,
    bitsPerSecond: opts.bitsPerSecond ?? 6_000_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start();
  await new Promise((r) => setTimeout(r, opts.durationMs ?? 6_000));
  recorder.stop();
  await stopped;
  const blob = new Blob(chunks, { type: mime.mime });
  downloadBlob(blob, suggestedFilename(meta, mime.ext));
  return { ok: true, ext: mime.ext, size: blob.size };
}
