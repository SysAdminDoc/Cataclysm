/**
 * Scenario export helpers. v0.1.x shipped PNG-of-globe export; v0.3.0
 * adds WebM/MP4 timeline recording via the browser-native MediaRecorder
 * (no extra muxer dependency, works on Chromium/WebView2 and modern WKWebView).
 */

import type { CoastalMeasurementProvenance, InitialDisplacement, Preset } from "../types/scenario";
import {
  buildModelProvenance,
  provenanceSummary,
  type ModelProvenanceInput,
} from "./model-provenance";
import { formatEmbeddedLengthValues, formatEnergy, formatLength, formatReadoutValue, quantityText, type UnitSystem } from "./units";
import { isTauri } from "./tauri";
import {
  assertEarthOperationAllowed,
  type EarthOperationPreflight,
} from "./earth-assets";
import { resolveSweImageryTiles } from "../render/cesium/swe-field-tiles";
import type { GeoPoint, HazardResult } from "../hazards/types";

export type ExportFailureCode =
  | "preflight"
  | "canvas"
  | "codec"
  | "clipboard"
  | "filesystem"
  | "download"
  | "cancelled"
  | "data";

export type ExportResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; code: ExportFailureCode; message: string; retryable: boolean };

const EXPORT_FAILURE_LABELS: Record<ExportFailureCode, string> = {
  preflight: "Preflight blocked",
  canvas: "Canvas capture failed",
  codec: "Video codec failed",
  clipboard: "Clipboard failed",
  filesystem: "Filesystem failed",
  download: "Download failed",
  cancelled: "Export cancelled",
  data: "Export data unavailable",
};

export function exportFailureLabel(code: ExportFailureCode): string {
  return EXPORT_FAILURE_LABELS[code];
}

function exportFailure(
  code: ExportFailureCode,
  message: string,
  retryable: boolean,
): { ok: false; code: ExportFailureCode; message: string; retryable: boolean } {
  return { ok: false, code, message, retryable };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unexpectedExportFailure(
  code: ExportFailureCode,
  action: string,
  error: unknown,
): { ok: false; code: ExportFailureCode; message: string; retryable: boolean } {
  console.error(`[export] ${action} failed`, error);
  if (error instanceof DOMException && error.name === "AbortError") {
    return exportFailure("cancelled", `${action} was cancelled.`, true);
  }
  return exportFailure(code, `${action} failed: ${errorMessage(error)}`, true);
}

function preflightMediaExport(
  operation: "static_capture" | "video_capture",
): EarthOperationPreflight | null {
  try {
    return assertEarthOperationAllowed(operation);
  } catch (error) {
    console.error(`[export] Earth asset ${operation} rights preflight blocked export`, error);
    return null;
  }
}

/** Find the Cesium globe canvas. */
function findGlobeCanvas(): HTMLCanvasElement | null {
  const w = document.querySelector(".cesium-widget canvas") as HTMLCanvasElement | null;
  return w;
}

function findAllGlobeCanvases(): HTMLCanvasElement[] {
  return Array.from(document.querySelectorAll(".cesium-widget canvas")) as HTMLCanvasElement[];
}

export type ScreenshotMeta = ModelProvenanceInput & {
  preset?: Preset | null;
  initial?: InitialDisplacement | null;
  timeS: number;
  fileId?: string;
};

export function preflightRunQuality(meta: ModelProvenanceInput): { ok: true } | { ok: false; reason: string } {
  const quality = meta.runQuality;
  if (!quality || quality.status !== "failed") return { ok: true };
  return { ok: false, reason: quality.failure ?? "Run failed numerical-integrity checks" };
}

function timestampSuffix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function isForbiddenFilenameChar(ch: string): boolean {
  return ch.charCodeAt(0) <= 0x1f || '<>:"/\\|?*'.includes(ch);
}

export function safeFilenamePart(value: string): string {
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
  const id = safeFilenamePart(meta.fileId ?? meta.preset?.id ?? "custom-scenario").slice(0, 64);
  const t = Math.round(meta.timeS / 60);
  return `cataclysm-${id}-t${t}min-${timestampSuffix()}.${ext}`;
}

/** Returns the globe canvas contents as a PNG data URL. */
export function captureGlobePng(): ExportResult<{ dataUrl: string }> {
  if (!preflightMediaExport("static_capture")) {
    return exportFailure("preflight", "Earth asset rights or attribution preflight blocked PNG capture.", false);
  }
  const canvas = findGlobeCanvas();
  if (!canvas) return exportFailure("canvas", "The globe canvas is not mounted yet.", true);
  try {
    return { ok: true, dataUrl: canvas.toDataURL("image/png") };
  } catch (err) {
    return unexpectedExportFailure("canvas", "PNG canvas capture", err);
  }
}

/** Trigger a download of the data URL using the standard `<a download>` pattern. */
export function downloadDataUrl(dataUrl: string, filename: string): ExportResult {
  let anchor: HTMLAnchorElement | null = null;
  try {
    anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = safeFilenamePart(filename);
    document.body.appendChild(anchor);
    anchor.click();
    return { ok: true };
  } catch (error) {
    return unexpectedExportFailure("download", "Browser download", error);
  } finally {
    anchor?.remove();
  }
}

/** Trigger a download of a Blob using the standard `<a download>` pattern. */
export function downloadBlob(blob: Blob, filename: string): ExportResult {
  let url: string | null = null;
  try {
    url = URL.createObjectURL(blob);
    return downloadDataUrl(url, filename);
  } catch (error) {
    return unexpectedExportFailure("download", "Blob download", error);
  } finally {
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        console.warn("[export] object URL cleanup failed", error);
      }
    }
  }
}

export async function copyExportText(text: string): Promise<ExportResult> {
  try {
    if (!navigator.clipboard?.writeText) {
      return exportFailure("clipboard", "Clipboard access is unavailable in this WebView.", true);
    }
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (error) {
    return unexpectedExportFailure("clipboard", "Clipboard copy", error);
  }
}

function usesApproximateBrowserSwe(meta: ModelProvenanceInput): boolean {
  return !isTauri() && /shallow-water-equation snapshot playback/i.test(meta.solverMode ?? "");
}

function stampApproximateSweWatermark(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const text = "BROWSER SWE PLAYBACK — APPROXIMATE";
  ctx.save();
  ctx.font = "bold 18px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const x = canvas.width / 2;
  const y = Math.max(30, canvas.height - 86);
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  const m = ctx.measureText(text);
  ctx.fillRect(x - m.width / 2 - 12, y - 14, m.width + 24, 28);
  ctx.fillStyle = "#fab387";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}...`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}...`;
}

function stampProvenanceStrip(
  canvas: HTMLCanvasElement,
  meta: ScreenshotMeta,
  attributions: string[],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const p = buildModelProvenance(meta);
  const stripH = 74;
  const pad = 16;
  const maxWidth = Math.max(120, canvas.width - pad * 2);
  const citation = p.citationUrl ? p.citationUrl : p.citationReference;
  const line1 = `Cataclysm v${p.appVersion} | ${p.generatedAt} | ${p.scenarioType} | ${p.solverMode} | Units ${p.unitSystem}`;
  const line2 = `${p.bathymetrySource} | ${citation} | ${p.limitation}`;
  const layerSummary = p.layerState.map((layer) => `${layer.id}:${layer.visible ? "on" : "off"}@${layer.opacityPct}%`).join(",") || "defaults";
  const line3 = `Layers ${layerSummary} | Evidence ${p.evidenceIds.join(", ") || "none"} | Earth assets ${p.assetRegistryVersion}: ${p.visualAssetIds.join(", ")} | ${attributions.join(" · ")}`;

  ctx.save();
  ctx.fillStyle = "rgba(17, 17, 27, 0.86)";
  ctx.fillRect(0, Math.max(0, canvas.height - stripH), canvas.width, stripH);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = "bold 12px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#cdd6f4";
  ctx.fillText(ellipsize(ctx, line1, maxWidth), pad, canvas.height - stripH + 10);
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#fab387";
  ctx.fillText(ellipsize(ctx, line2, maxWidth), pad, canvas.height - stripH + 31);
  ctx.fillStyle = "#a6adc8";
  ctx.fillText(ellipsize(ctx, line3, maxWidth), pad, canvas.height - stripH + 49);
  ctx.restore();
}

function copyGlobeWithProvenance(
  sourceCanvas: HTMLCanvasElement,
  meta: ScreenshotMeta,
  attributions: string[],
): HTMLCanvasElement | null {
  const offscreen = document.createElement("canvas");
  offscreen.width = sourceCanvas.width;
  offscreen.height = sourceCanvas.height;
  const ctx = offscreen.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(sourceCanvas, 0, 0);
  if (usesApproximateBrowserSwe(meta)) stampApproximateSweWatermark(offscreen);
  stampProvenanceStrip(offscreen, meta, attributions);
  return offscreen;
}

/** Full export flow — capture + download. */
export function exportGlobePng(meta: ScreenshotMeta): ExportResult {
  const quality = preflightRunQuality(meta);
  if (!quality.ok) return exportFailure("preflight", quality.reason, false);
  const preflight = preflightMediaExport("static_capture");
  if (!preflight) return exportFailure("preflight", "Earth asset rights or attribution preflight blocked PNG export.", false);
  const sourceCanvas = findGlobeCanvas();
  if (!sourceCanvas) return exportFailure("canvas", "The globe canvas is not mounted yet.", true);
  try {
    const stamped = copyGlobeWithProvenance(sourceCanvas, meta, preflight.attributions);
    if (!stamped) return exportFailure("canvas", "A 2D canvas context could not be created for PNG export.", true);
    return downloadDataUrl(stamped.toDataURL("image/png"), suggestedFilename(meta, "png"));
  } catch (error) {
    return unexpectedExportFailure("canvas", "PNG export", error);
  }
}

/** F4-09 — Share-card export. Composites the bare globe canvas with a
 *  200-px-tall header strip containing preset name, key parameters,
 *  citation short-ref, and the project URL. The header strip is rendered
 *  to a 1200×800 share-card-friendly aspect via an offscreen canvas
 *  (no external library needed). Includes a footer "Educational only —
 *  not for evacuation" trust-signal to preserve product framing. */
export function exportGlobeShareCard(meta: ScreenshotMeta): ExportResult {
  const quality = preflightRunQuality(meta);
  if (!quality.ok) return exportFailure("preflight", quality.reason, false);
  const preflight = preflightMediaExport("static_capture");
  if (!preflight) return exportFailure("preflight", "Earth asset rights or attribution preflight blocked share-card export.", false);
  const sourceCanvas = findGlobeCanvas();
  if (!sourceCanvas) return exportFailure("canvas", "The globe canvas is not mounted yet.", true);

  try {
  const W = 1200;
  const H = 800;
  const HEADER_H = 100;
  const FOOTER_H = 58;
  const provenance = buildModelProvenance(meta);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return exportFailure("canvas", "A 2D canvas context could not be created for the share card.", true);

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

  const presetName = provenance.scenarioName;
  const date = meta.preset?.date ?? "Custom";
  const ref = meta.preset?.reference ?? "";
  const initialAmp = meta.initial?.peak_amplitude_m;
  const energyJ = meta.initial?.source_energy_j;
  const mwEq = meta.initial?.seismic_mw_equivalent;
  const exportFormatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("en-US", options).format(value);

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
    params.push(`A₀ ${quantityText(formatLength(initialAmp, exportFormatNumber, provenance.unitSystem))}`);
  }
  if (mwEq !== undefined && Number.isFinite(mwEq)) {
    params.push(`M_w ≈ ${mwEq.toFixed(1)}`);
  }
  if (energyJ !== undefined && Number.isFinite(energyJ)) {
    const energy = formatEnergy(energyJ, exportFormatNumber, provenance.unitSystem);
    params.push(`E ≈ ${quantityText(energy)}${energy.anchor ? ` (${energy.anchor})` : ""}`);
  }
  ctx.fillStyle = "#89b4fa";
  ctx.font = "bold 16px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(params.join("   ·   "), W - 24, 16);

  ctx.fillStyle = "#a6adc8";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillText(`${provenance.scenarioType} | t = ${(meta.timeS / 60).toFixed(0)} min`, W - 24, 52);

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
  ctx.textBaseline = "top";
  ctx.fillText(
    `Cataclysm v${provenance.appVersion} | Units ${provenance.unitSystem} | Layers ${provenance.layerState.filter((layer) => layer.visible).map((layer) => layer.id).join(", ") || "defaults"} | ${provenance.generatedAt} | ${provenance.solverMode}`,
    24,
    H - FOOTER_H + 10,
  );
  ctx.fillStyle = "#a6adc8";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillText(
    `${provenance.bathymetryAssetId} | Earth assets ${provenance.assetRegistryVersion} | ${preflight.attributions.join(" · ")} | ${provenance.limitation}`,
    24,
    H - FOOTER_H + 32,
  );

  if (usesApproximateBrowserSwe(meta)) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(W / 2 - 180, H / 2 - 16, 360, 32);
    ctx.fillStyle = "#fab387";
    ctx.font = "bold 16px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BROWSER SWE PLAYBACK — APPROXIMATE", W / 2, H / 2);
    ctx.textAlign = "left";
  }

  const dataUrl = canvas.toDataURL("image/png");
  return downloadDataUrl(dataUrl, suggestedFilename(meta, "png").replace(".png", "-share.png"));
  } catch (error) {
    return unexpectedExportFailure("canvas", "Share-card export", error);
  }
}

export type ComparisonExportMeta = {
  metaA: ScreenshotMeta;
  metaB: ScreenshotMeta;
  labelA?: string;
  labelB?: string;
  storyTitle?: string;
  storySummary?: readonly string[];
};

export function exportComparisonPng(opts: ComparisonExportMeta): ExportResult {
  const qualityA = preflightRunQuality(opts.metaA);
  const qualityB = preflightRunQuality(opts.metaB);
  if (!qualityA.ok) return exportFailure("preflight", qualityA.reason, false);
  if (!qualityB.ok) return exportFailure("preflight", qualityB.reason, false);
  const preflight = preflightMediaExport("static_capture");
  if (!preflight) return exportFailure("preflight", "Earth asset rights or attribution preflight blocked comparison export.", false);
  const canvases = findAllGlobeCanvases();
  if (canvases.length < 2) return exportFailure("canvas", "Both comparison globe canvases must be mounted.", true);
  const [srcA, srcB] = canvases;

  try {
  const GAP = 4;
  const LABEL_H = opts.storyTitle ? 60 : 36;
  const storySummary = opts.storySummary?.slice(0, 2) ?? [];
  const FOOTER_H = storySummary.length > 0 ? 70 : 50;
  const paneW = Math.max(srcA.width, srcB.width);
  const paneH = Math.max(srcA.height, srcB.height);
  const W = paneW * 2 + GAP;
  const H = LABEL_H + paneH + FOOTER_H;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return exportFailure("canvas", "A 2D canvas context could not be created for comparison export.", true);

  ctx.fillStyle = "#1e1e2e";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#181825";
  ctx.fillRect(0, 0, W, LABEL_H);
  ctx.font = "bold 16px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  if (opts.storyTitle) {
    ctx.fillStyle = "#cdd6f4";
    ctx.textAlign = "center";
    ctx.fillText(ellipsize(ctx, opts.storyTitle, W - 24), W / 2, 16);
  }
  ctx.fillStyle = "#89b4fa";
  ctx.textAlign = "center";
  const labelY = opts.storyTitle ? 43 : LABEL_H / 2;
  ctx.fillText(opts.labelA ?? "Slot A", paneW / 2, labelY);
  ctx.fillText(opts.labelB ?? "Slot B", paneW + GAP + paneW / 2, labelY);

  ctx.drawImage(srcA, 0, LABEL_H, paneW, paneH);
  ctx.fillStyle = "#313244";
  ctx.fillRect(paneW, LABEL_H, GAP, paneH);
  ctx.drawImage(srcB, paneW + GAP, LABEL_H, paneW, paneH);

  if (usesApproximateBrowserSwe(opts.metaA) || usesApproximateBrowserSwe(opts.metaB)) {
    stampApproximateSweWatermark(canvas);
  }

  const provA = buildModelProvenance(opts.metaA);
  const provB = buildModelProvenance(opts.metaB);
  ctx.fillStyle = "#11111b";
  ctx.fillRect(0, H - FOOTER_H, W, FOOTER_H);
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "#cdd6f4";
  ctx.fillText(
    `A: ${provA.scenarioName} | ${provA.scenarioType} | Units ${provA.unitSystem}`,
    12, H - FOOTER_H + 8,
  );
  ctx.fillText(
    `B: ${provB.scenarioName} | ${provB.scenarioType} | Units ${provB.unitSystem}`,
    12, H - FOOTER_H + 26,
  );
  ctx.textAlign = "right";
  ctx.fillStyle = "#fab387";
  ctx.fillText(
    `Cataclysm v${provA.appVersion} | ${provA.limitation}`,
    W - 12, H - FOOTER_H + 8,
  );
  ctx.fillStyle = "#a6adc8";
  ctx.fillText(
    `${provA.generatedAt} | Earth assets ${provA.assetRegistryVersion} | ${preflight.attributions.join(" · ")}`,
    W - 12,
    H - FOOTER_H + 26,
  );
  if (storySummary.length > 0) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#a6e3a1";
    ctx.fillText(
      ellipsize(ctx, storySummary.join(" · "), W - 24),
      12,
      H - FOOTER_H + 48,
    );
  }

  const dataUrl = canvas.toDataURL("image/png");
  return downloadDataUrl(dataUrl, `cataclysm-compare-${timestampSuffix()}.png`);
  } catch (error) {
    return unexpectedExportFailure("canvas", "Comparison PNG export", error);
  }
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
): Promise<ExportResult<{ ext: "webm" | "mp4"; size: number }>> {
  const qualityPreflight = preflightRunQuality(meta);
  if (!qualityPreflight.ok) return exportFailure("preflight", qualityPreflight.reason, false);
  const preflight = preflightMediaExport("video_capture");
  if (!preflight) {
    return exportFailure("preflight", "Earth asset rights or live attribution preflight blocked video export.", false);
  }
  const canvas = findGlobeCanvas();
  if (!canvas) return exportFailure("canvas", "The globe canvas is not mounted yet.", true);
  const mime = pickVideoMime();
  if (!mime) {
    return exportFailure("codec", "MediaRecorder is unavailable or no supported video codec was found.", false);
  }
  const fps = Math.min(60, Math.max(1, Math.round(opts.fps ?? 30)));
  const durationMs = Math.min(30_000, Math.max(1_000, Math.round(opts.durationMs ?? 6_000)));
  const bitsPerSecond = Math.min(25_000_000, Math.max(500_000, Math.round(opts.bitsPerSecond ?? 6_000_000)));
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  const chunks: BlobPart[] = [];
  try {
    try {
      stream = canvas.captureStream(fps);
    } catch (error) {
      return unexpectedExportFailure("canvas", "Video canvas capture", error);
    }
    recorder = new MediaRecorder(stream, {
      mimeType: mime.mime,
      bitsPerSecond,
    });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    let settled = false;
    const stopped = new Promise<void>((resolve, reject) => {
      const settle = (operation: () => void) => {
        if (settled) return;
        settled = true;
        operation();
      };
      recorder!.onstop = () => settle(resolve);
      recorder!.onerror = () => settle(() => reject(new Error("MediaRecorder failed while recording")));
      durationTimer = setTimeout(() => {
        try {
          if (recorder!.state !== "inactive") recorder!.stop();
          else settle(resolve);
        } catch (error) {
          settle(() => reject(error));
        }
      }, durationMs);
      watchdogTimer = setTimeout(
        () => settle(() => reject(new Error("Recording timed out because MediaRecorder emitted no stop event"))),
        durationMs + 5_000,
      );
    });
    recorder.start();
    await stopped;
    const blob = new Blob(chunks, { type: mime.mime });
    if (blob.size === 0) {
      return exportFailure("codec", "The video encoder produced an empty recording.", true);
    }
    const displayUnitSystem = meta.unitSystem ?? "metric";
    const download = downloadBlob(
      blob,
      suggestedFilename(meta, mime.ext).replace(`.${mime.ext}`, `-${displayUnitSystem}.${mime.ext}`),
    );
    if (!download.ok) return download;
    return { ok: true, ext: mime.ext, size: blob.size };
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotSupportedError") {
      return exportFailure("codec", `The selected ${mime.mime} codec could not start.`, false);
    }
    return unexpectedExportFailure("codec", "Video export", error);
  } finally {
    if (durationTimer) clearTimeout(durationTimer);
    if (watchdogTimer) clearTimeout(watchdogTimer);
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch (error) {
        console.warn("[export] MediaRecorder cleanup failed", error);
      }
    }
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    for (const track of stream?.getTracks() ?? []) track.stop();
  }
}

export type DeterministicVideoOptions = {
  fps?: number;
  totalFrames: number;
  width?: number;
  height?: number;
  bitsPerSecond?: number;
  onProgress?: (frame: number, total: number) => void;
  renderFrame: (frameIndex: number) => Promise<void>;
};

export function isDeterministicVideoSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

export async function exportDeterministicVideo(
  meta: ScreenshotMeta,
  opts: DeterministicVideoOptions,
): Promise<ExportResult<{ ext: "mp4"; size: number }>> {
  if (!isDeterministicVideoSupported()) {
    return exportFailure("codec", "WebCodecs VideoEncoder is not available in this runtime.", false);
  }
  const qualityPreflight = preflightRunQuality(meta);
  if (!qualityPreflight.ok) return exportFailure("preflight", qualityPreflight.reason, false);
  const preflight = preflightMediaExport("video_capture");
  if (!preflight) {
    return exportFailure("preflight", "Earth asset rights or live attribution preflight blocked video export.", false);
  }
  const canvas = findGlobeCanvas();
  if (!canvas) return exportFailure("canvas", "The globe canvas is not mounted yet.", true);
  const fps = Math.min(60, Math.max(1, Math.round(opts.fps ?? 30)));
  const totalFrames = Math.min(3600, Math.max(2, opts.totalFrames));
  const width = opts.width ?? canvas.width;
  const height = opts.height ?? canvas.height;
  const bitsPerSecond = opts.bitsPerSecond ?? 6_000_000;

  const codec = "avc1.42001f";
  // Probe support BEFORE allocating any encoder so an unsupported config
  // cannot leak an encoder handle through an early return.
  let supported: VideoEncoderSupport;
  try {
    supported = await VideoEncoder.isConfigSupported({
      codec, width, height, bitrate: bitsPerSecond, framerate: fps,
    });
  } catch (error) {
    return unexpectedExportFailure("codec", "Deterministic video config probe", error);
  }
  if (!supported.supported) {
    return exportFailure("codec", `H.264 Baseline at ${width}x${height} is not supported by this encoder.`, false);
  }

  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
  });

  // Surface async encoder errors to the awaiting caller. Throwing inside the
  // encoder's error callback runs on the codec thread and would never reach
  // the try/catch below, so record it and check after each await point.
  let encoderError: Error | null = null;
  let encodedFrames = 0;
  const encoder = new VideoEncoder({
    output: (chunk, chunkMeta) => muxer.addVideoChunk(chunk, chunkMeta ?? undefined),
    error: (e) => { encoderError = e instanceof Error ? e : new Error(String(e)); },
  });
  encoder.configure({ codec, width, height, bitrate: bitsPerSecond, framerate: fps });

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (encoderError) throw encoderError;
      await opts.renderFrame(i);
      await new Promise((r) => requestAnimationFrame(r));
      // Backpressure: never let the encode queue grow unbounded across a long
      // frame sequence — wait for the codec to drain before feeding more.
      while (encoder.encodeQueueSize > 8 && !encoderError) {
        await new Promise((r) => setTimeout(r, 4));
      }
      if (encoderError) throw encoderError;
      const frame = new VideoFrame(canvas, {
        timestamp: (i * 1_000_000) / fps,
        duration: 1_000_000 / fps,
      });
      const keyFrame = i % (fps * 2) === 0;
      encoder.encode(frame, { keyFrame });
      frame.close();
      encodedFrames++;
      opts.onProgress?.(encodedFrames, totalFrames);
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: "video/mp4" });
    if (blob.size === 0) {
      return exportFailure("codec", "The deterministic encoder produced an empty file.", true);
    }
    const displayUnitSystem = meta.unitSystem ?? "metric";
    const download = downloadBlob(
      blob,
      suggestedFilename(meta, "mp4").replace(".mp4", `-deterministic-${displayUnitSystem}.mp4`),
    );
    if (!download.ok) return download;
    return { ok: true, ext: "mp4", size: blob.size };
  } catch (error) {
    return unexpectedExportFailure("codec", "Deterministic video export", error);
  } finally {
    try { encoder.close(); } catch { /* already closed */ }
  }
}

export type DirectHazardExportData = Readonly<{
  result: HazardResult;
  polygons?: readonly Readonly<{ label: string; color: string; points: readonly GeoPoint[] }>[] | null;
}>;

function cssHexRgba(color: string, alpha = 96): [number, number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return [203, 166, 247, alpha];
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
    alpha,
  ];
}

function kmlColor(color: string, alpha = "66"): string {
  const [red, green, blue] = cssHexRgba(color, 255);
  return `${alpha}${blue.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${red.toString(16).padStart(2, "0")}`;
}

function closeGeoPoints(points: readonly GeoPoint[]): readonly GeoPoint[] {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || (first.lat === last.lat && first.lon === last.lon)) return points;
  return [...points, first];
}

function directHazardProperties(meta: ScreenshotMeta, data: DirectHazardExportData) {
  const provenance = buildModelProvenance(meta);
  return {
    app_version: provenance.appVersion,
    authority: data.result.authority,
    citation_reference: provenance.citationReference,
    citation_url: provenance.citationUrl,
    evidence_ids: provenance.evidenceIds,
    layer_state: provenance.layerState,
    generated_at: provenance.generatedAt,
    display_unit_system: provenance.unitSystem,
    model_version: data.result.modelVersion,
    scenario: provenance.scenarioName,
    scenario_type: provenance.scenarioType,
    solver_mode: provenance.solverMode,
    limitation: provenance.limitation,
  };
}

const EXPORT_NUMBER_FORMATTER = (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat("en-US", options).format(value);

function directHazardDisplayReadout(data: DirectHazardExportData, unitSystem: UnitSystem) {
  return data.result.readout.map((item) => ({
    ...item,
    value: formatReadoutValue(item.value, EXPORT_NUMBER_FORMATTER, unitSystem),
    hint: item.hint
      ? formatEmbeddedLengthValues(item.hint, EXPORT_NUMBER_FORMATTER, unitSystem)
      : item.hint,
  }));
}

export function buildDirectHazardGeoJson(meta: ScreenshotMeta, data: DirectHazardExportData) {
  const common = directHazardProperties(meta, data);
  const center = data.result.center;
  const features = [
    {
      type: "Feature" as const,
      properties: {
        ...common,
        kind: "effects_origin",
        casualties: data.result.casualties ?? null,
        casualty_models: data.result.casualtyModels ?? [],
        casualty_spread: data.result.casualtySpread ?? null,
        readout: directHazardDisplayReadout(data, meta.unitSystem ?? "metric"),
      },
      geometry: { type: "Point" as const, coordinates: [round5(center.lon), round5(center.lat)] },
    },
    ...data.result.rings.map((ring, index) => ({
      type: "Feature" as const,
      properties: {
        ...common,
        kind: "effect_ring",
        index,
        label: ring.label,
        category: ring.category,
        radius_m: round5(ring.radiusM),
        color: ring.color,
        description: ring.description ?? null,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [circlePolygon(center.lat, center.lon, ring.radiusM, 72)],
      },
    })),
    ...(data.polygons ?? []).map((polygon, index) => ({
      type: "Feature" as const,
      properties: {
        ...common,
        kind: "hazard_polygon",
        index,
        label: polygon.label,
        color: polygon.color,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [closeGeoPoints(polygon.points).map((point) => [round5(point.lon), round5(point.lat)])],
      },
    })),
  ];
  return {
    type: "FeatureCollection" as const,
    properties: {
      ...common,
      geometry_notice: "Circular effect thresholds and supplied fallout polygons are Rust-result-derived screening geometry.",
    },
    features,
  };
}

export function buildDirectHazardCzml(meta: ScreenshotMeta, data: DirectHazardExportData) {
  const provenance = buildModelProvenance(meta);
  const common = directHazardProperties(meta, data);
  const center = data.result.center;
  return [
    {
      id: "document",
      name: `Cataclysm — ${provenance.scenarioName}`,
      version: "1.0",
      description: provenanceSummary({ ...meta, generatedAt: provenance.generatedAt }),
    },
    {
      id: "effects-origin",
      name: `${provenance.scenarioName} — Effects origin`,
      description: `${data.result.modelVersion}; ${provenance.limitation}`,
      properties: {
        ...common,
        casualties: data.result.casualties ?? null,
        casualty_models: data.result.casualtyModels ?? [],
        casualty_spread: data.result.casualtySpread ?? null,
        readout: directHazardDisplayReadout(data, provenance.unitSystem),
      },
      position: { cartographicDegrees: [center.lon, center.lat, 0] },
      point: {
        pixelSize: 10,
        color: { rgba: [245, 224, 220, 255] },
        outlineColor: { rgba: [17, 17, 27, 255] },
        outlineWidth: 2,
      },
    },
    ...data.result.rings.map((ring, index) => ({
      id: `effect-ring-${index + 1}`,
      name: ring.label,
      description: ring.description
        ? formatEmbeddedLengthValues(ring.description, EXPORT_NUMBER_FORMATTER, provenance.unitSystem)
        : `${ring.category} threshold at ${quantityText(formatLength(ring.radiusM, EXPORT_NUMBER_FORMATTER, provenance.unitSystem))}`,
      properties: { ...common, category: ring.category, radius_m: ring.radiusM, color: ring.color },
      position: { cartographicDegrees: [center.lon, center.lat, 0] },
      ellipse: {
        semiMajorAxis: ring.radiusM,
        semiMinorAxis: ring.radiusM,
        height: 0,
        material: { solidColor: { color: { rgba: cssHexRgba(ring.color, 76) } } },
        outline: true,
        outlineColor: { rgba: cssHexRgba(ring.color, 220) },
      },
    })),
    ...(data.polygons ?? []).map((polygon, index) => ({
      id: `hazard-polygon-${index + 1}`,
      name: polygon.label,
      properties: { ...common, color: polygon.color },
      polygon: {
        positions: {
          cartographicDegrees: polygon.points.flatMap((point) => [point.lon, point.lat, 0]),
        },
        material: { solidColor: { color: { rgba: cssHexRgba(polygon.color, 82) } } },
        outline: true,
        outlineColor: { rgba: cssHexRgba(polygon.color, 220) },
      },
    })),
  ];
}

export function buildDirectHazardKml(meta: ScreenshotMeta, data: DirectHazardExportData): string {
  const provenance = buildModelProvenance(meta);
  const provenanceText = provenanceSummary({ ...meta, generatedAt: provenance.generatedAt });
  const length = (meters: number) => quantityText(formatLength(meters, EXPORT_NUMBER_FORMATTER, provenance.unitSystem));
  const center = data.result.center;
  const casualtyModels = escapeXml(JSON.stringify(data.result.casualtyModels ?? []));
  const casualtySpread = escapeXml(JSON.stringify(data.result.casualtySpread ?? null));
  const ringPlacemarks = data.result.rings.map((ring) => {
    const coordinates = circlePolygon(center.lat, center.lon, ring.radiusM, 72)
      .map(([lon, lat]) => `${lon},${lat},0`)
      .join(" ");
    return `
    <Placemark>
      <name>${escapeXml(ring.label)}</name>
      <description>${escapeXml(`${ring.description ? formatEmbeddedLengthValues(ring.description, EXPORT_NUMBER_FORMATTER, provenance.unitSystem) : ring.category}\nRadius: ${length(ring.radiusM)}\nModel: ${data.result.modelVersion}`)}</description>
      <ExtendedData><Data name="category"><value>${escapeXml(ring.category)}</value></Data><Data name="radius_m"><value>${ring.radiusM}</value></Data></ExtendedData>
      <Style><LineStyle><color>${kmlColor(ring.color, "dd")}</color><width>2</width></LineStyle><PolyStyle><color>${kmlColor(ring.color)}</color></PolyStyle></Style>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>`;
  });
  const polygonPlacemarks = (data.polygons ?? []).map((polygon) => {
    const points = closeGeoPoints(polygon.points);
    const coordinates = points.map((point) => `${point.lon},${point.lat},0`).join(" ");
    return `
    <Placemark>
      <name>${escapeXml(polygon.label)}</name>
      <Style><LineStyle><color>${kmlColor(polygon.color, "dd")}</color><width>2</width></LineStyle><PolyStyle><color>${kmlColor(polygon.color)}</color></PolyStyle></Style>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Cataclysm — ${escapeXml(provenance.scenarioName)}</name>
  <description>${escapeXml(provenanceText)}</description>
  <ExtendedData><Data name="display_unit_system"><value>${provenance.unitSystem}</value></Data></ExtendedData>
  <Placemark>
    <name>${escapeXml(provenance.scenarioName)} — Effects origin</name>
    <description>${escapeXml(`${data.result.modelVersion}; ${provenance.limitation}`)}</description>
    <ExtendedData><Data name="casualty_models"><value>${casualtyModels}</value></Data><Data name="casualty_spread"><value>${casualtySpread}</value></Data></ExtendedData>
    <Point><coordinates>${center.lon},${center.lat},0</coordinates></Point>
  </Placemark>
  <Folder><name>Effect thresholds</name>${ringPlacemarks.join("")}</Folder>
  <Folder><name>Hazard polygons</name>${polygonPlacemarks.join("")}</Folder>
</Document>
</kml>`;
}

/** Export SWE simulation snapshots as a CZML document for playback in
 *  any CesiumJS viewer. Each snapshot's PNG becomes a time-interval
 *  rectangle overlay. */
export function exportCzml(
  meta: ScreenshotMeta,
  snapshots: import("../types/scenario").GridSnapshot[],
  directHazard?: DirectHazardExportData | null,
): ExportResult {
  const quality = preflightRunQuality(meta);
  if (!quality.ok) return exportFailure("preflight", quality.reason, false);
  if (directHazard) {
    try {
      const blob = new Blob([JSON.stringify(buildDirectHazardCzml(meta, directHazard), null, 2)], { type: "application/json" });
      return downloadBlob(blob, `cataclysm-${safeFilenamePart(meta.fileId ?? directHazard.result.kind)}.czml`);
    } catch (error) {
      return unexpectedExportFailure("data", "Direct-hazard CZML serialization", error);
    }
  }
  if (!snapshots.length) return exportFailure("data", "Run the SWE simulation before exporting CZML.", true);
  try {
  const provenance = buildModelProvenance({
    ...meta,
    solverMode: meta.solverMode ?? "Shallow-water-equation snapshot playback",
  });

  const epoch = "2024-01-01T00:00:00Z";
  const epochMs = new Date(epoch).getTime();

  function toIso(s: number): string {
    return new Date(epochMs + s * 1000).toISOString().replace(/\.000Z$/, "Z");
  }

  const tStart = snapshots[0].time_s;
  const tEnd = snapshots[snapshots.length - 1].time_s;
  const interval = `${toIso(tStart)}/${toIso(Math.max(tEnd, tStart + 1))}`;

  const layouts = snapshots.map(resolveSweImageryTiles);
  const firstLayout = layouts[0];
  const sameRectangle = (left: readonly number[], right: readonly number[]) =>
    left.length === right.length && left.every((value, index) => value === right[index]);
  const layoutIsStable = firstLayout.length > 0 && layouts.every((layout) =>
    layout.length === firstLayout.length
    && layout.every((tile, index) => sameRectangle(tile.bbox, firstLayout[index].bbox)));
  if (!layoutIsStable) {
    return exportFailure(
      "data",
      "Simulation frames have an invalid or inconsistent imagery layout. Run the SWE simulation again before exporting CZML.",
      true,
    );
  }

  const commonProperties = {
    appVersion: provenance.appVersion,
    assetRegistryVersion: provenance.assetRegistryVersion,
    bathymetryAssetId: provenance.bathymetryAssetId,
    bathymetrySource: provenance.bathymetrySource,
    citationReference: provenance.citationReference,
    citationUrl: provenance.citationUrl,
    evidenceIds: provenance.evidenceIds,
    layerState: provenance.layerState,
    generatedAt: provenance.generatedAt,
    displayUnitSystem: provenance.unitSystem,
    scenarioType: provenance.scenarioType,
    solverMode: provenance.solverMode,
    solverAssetIds: provenance.solverAssetIds,
    visualAssetIds: provenance.visualAssetIds,
    heightField: snapshots[0].height_field,
  };

  const waveFields = firstLayout.map((firstTile, tileIndex) => {
    // Time-tagged CZML ImageProperty elements contain only interval + image.
    // repeat/color/transparent belong to the ImageMaterial level below.
    const materialIntervals = snapshots.map((snapshot, snapshotIndex) => {
      const next = snapshotIndex + 1 < snapshots.length
        ? snapshots[snapshotIndex + 1].time_s
        : tEnd + 1;
      return {
        interval: `${toIso(snapshot.time_s)}/${toIso(next)}`,
        image: `data:image/png;base64,${layouts[snapshotIndex][tileIndex].pngBase64}`,
      };
    });
    const [west, south, east, north] = firstTile.bbox;
    return {
      id: tileIndex === 0 ? "wave-field" : `wave-field-${tileIndex + 1}`,
      name: firstLayout.length === 1
        ? "SWE wave field"
        : `SWE wave field ${tileIndex + 1}/${firstLayout.length}`,
      availability: interval,
      description: `Cataclysm ${provenance.scenarioName} - ${snapshots.length} snapshots. ${provenance.limitation}`,
      properties: commonProperties,
      rectangle: {
        coordinates: { wsenDegrees: [west, south, east, north] },
        material: {
          image: {
            image: materialIntervals,
            repeat: { cartesian2: [1, 1] },
            color: { rgba: [255, 255, 255, 230] },
            // The eta PNGs carry alpha for land/dry cells; without this the
            // rectangle hides the globe beneath.
            transparent: true,
          },
        },
        height: 0,
      },
    };
  });

  const czml = [
    {
      id: "document",
      name: meta.preset?.name ?? "Cataclysm Export",
      version: "1.0",
      description: provenanceSummary({ ...meta, solverMode: provenance.solverMode, generatedAt: provenance.generatedAt }),
      clock: {
        interval,
        currentTime: toIso(tStart),
        multiplier: 60,
        range: "LOOP_STOP",
        step: "SYSTEM_CLOCK_MULTIPLIER",
      },
    },
    ...waveFields,
  ];

  const json = JSON.stringify(czml, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const presetId = meta.preset?.id ?? "custom-scenario";
  return downloadBlob(blob, `cataclysm-${safeFilenamePart(presetId)}.czml`);
  } catch (error) {
    return unexpectedExportFailure("data", "CZML serialization", error);
  }
}

export type RunupPoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  runup_m: number;
  arrival_time_s: number;
  inundation_extent_m: number;
  offshore_amplitude_m: number;
  beach_slope_deg: number;
  offshore_depth_m: number;
  slope_provenance: CoastalMeasurementProvenance;
  depth_provenance: CoastalMeasurementProvenance;
  quantitative_confidence: "low" | "medium" | "high";
  quantitative_label: "illustrative" | "screening_estimate" | "quantitative";
};

export function exportGeoJson(
  points: RunupPoint[],
  meta: ScreenshotMeta,
  isochrones?: import("../types/scenario").Isochrone[] | null,
  directHazard?: DirectHazardExportData | null,
): ExportResult {
  const quality = preflightRunQuality(meta);
  if (!quality.ok) return exportFailure("preflight", quality.reason, false);
  if (directHazard) {
    try {
      const blob = new Blob([JSON.stringify(buildDirectHazardGeoJson(meta, directHazard), null, 2)], { type: "application/geo+json" });
      return downloadBlob(blob, `cataclysm-${safeFilenamePart(meta.fileId ?? directHazard.result.kind)}-effects.geojson`);
    } catch (error) {
      return unexpectedExportFailure("data", "Direct-hazard GeoJSON serialization", error);
    }
  }
  if (!points.length && !(isochrones && isochrones.length)) {
    return exportFailure("data", "No runup points or arrival isochrones are available for GeoJSON export.", true);
  }
  try {
  const provenance = buildModelProvenance(meta);

  const isochroneFeatures = (isochrones ?? []).map((iso) => ({
    type: "Feature" as const,
    properties: {
      kind: "arrival_isochrone",
      arrival_time_s: round5(iso.time_s),
      arrival_time_min: round5(iso.time_s / 60),
    },
    geometry: {
      type: "MultiLineString" as const,
      coordinates: iso.lines.map((line) => line.map(([lon, lat]) => [round5(lon), round5(lat)])),
    },
  }));

  const features = points.map((p) => {
    const r = Math.max(p.inundation_extent_m, 50);
    const coords = circlePolygon(p.lat, p.lon, r);
    return {
      type: "Feature" as const,
      properties: {
        id: p.id,
        name: p.name,
        runup_m: round5(p.runup_m),
        arrival_time_s: round5(p.arrival_time_s),
        inundation_extent_m: round5(p.inundation_extent_m),
        offshore_amplitude_m: round5(p.offshore_amplitude_m),
        beach_slope_deg: round5(p.beach_slope_deg),
        offshore_depth_m: round5(p.offshore_depth_m),
        quantitative_confidence: p.quantitative_confidence,
        quantitative_label: p.quantitative_label,
        slope_sample_id: p.slope_provenance.sample_id,
        slope_record_id: p.slope_provenance.record_id,
        slope_source: p.slope_provenance.source,
        slope_method: p.slope_provenance.method,
        slope_datum: p.slope_provenance.datum,
        slope_resolution: p.slope_provenance.resolution,
        slope_observed_or_published: p.slope_provenance.observed_or_published,
        slope_confidence: p.slope_provenance.confidence,
        slope_uncertainty_value: p.slope_provenance.uncertainty_value,
        slope_uncertainty_unit: p.slope_provenance.uncertainty_unit,
        slope_placeholder: p.slope_provenance.placeholder,
        depth_sample_id: p.depth_provenance.sample_id,
        depth_record_id: p.depth_provenance.record_id,
        depth_source: p.depth_provenance.source,
        depth_method: p.depth_provenance.method,
        depth_datum: p.depth_provenance.datum,
        depth_resolution: p.depth_provenance.resolution,
        depth_observed_or_published: p.depth_provenance.observed_or_published,
        depth_confidence: p.depth_provenance.confidence,
        depth_uncertainty_value: p.depth_provenance.uncertainty_value,
        depth_uncertainty_unit: p.depth_provenance.uncertainty_unit,
        depth_placeholder: p.depth_provenance.placeholder,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [coords],
      },
    };
  });

  const fc = {
    type: "FeatureCollection" as const,
    properties: {
      app_version: provenance.appVersion,
      asset_registry_version: provenance.assetRegistryVersion,
      bathymetry_asset_id: provenance.bathymetryAssetId,
      bathymetry_source: provenance.bathymetrySource,
      citation_reference: provenance.citationReference,
      citation_url: provenance.citationUrl,
      evidence_ids: provenance.evidenceIds,
      layer_state: provenance.layerState,
      generated_at: provenance.generatedAt,
      display_unit_system: provenance.unitSystem,
      geometry_notice: "First-order circular inundation discs from runup and beach-slope estimates.",
      model_notice: provenance.limitation,
      scenario: provenance.scenarioName,
      scenario_type: provenance.scenarioType,
      solver_mode: provenance.solverMode,
      solver_asset_ids: provenance.solverAssetIds,
      visual_asset_ids: provenance.visualAssetIds,
      height_field: provenance.heightField,
      time_s: round5(meta.timeS),
    },
    features: [...features, ...isochroneFeatures],
  };

  const json = JSON.stringify(fc, null, 2);
  const blob = new Blob([json], { type: "application/geo+json" });
  const presetId = meta.preset?.id ?? "custom-scenario";
  return downloadBlob(blob, `cataclysm-${safeFilenamePart(presetId)}-inundation.geojson`);
  } catch (error) {
    return unexpectedExportFailure("data", "GeoJSON serialization", error);
  }
}

export function exportKml(
  meta: ScreenshotMeta,
  runupPoints: RunupPoint[],
  directHazard?: DirectHazardExportData | null,
): ExportResult {
  const quality = preflightRunQuality(meta);
  if (!quality.ok) return exportFailure("preflight", quality.reason, false);
  if (directHazard) {
    try {
      const blob = new Blob([buildDirectHazardKml(meta, directHazard)], { type: "application/vnd.google-earth.kml+xml" });
      return downloadBlob(blob, `cataclysm-${safeFilenamePart(meta.fileId ?? directHazard.result.kind)}.kml`);
    } catch (error) {
      return unexpectedExportFailure("data", "Direct-hazard KML serialization", error);
    }
  }
  try {
  const provenance = buildModelProvenance(meta);
  const provenanceText = provenanceSummary({ ...meta, generatedAt: provenance.generatedAt });
  const length = (meters: number) => quantityText(formatLength(meters, EXPORT_NUMBER_FORMATTER, provenance.unitSystem));
  const name = provenance.scenarioName;
  const center = meta.initial?.center;
  const cavityR = meta.initial?.cavity_radius_m ?? 0;

  const sourcePlacemarks: string[] = [];
  const runupPlacemarks: string[] = [];

  if (center) {
    sourcePlacemarks.push(`
    <Placemark>
      <name>${escapeXml(name)} — Source</name>
      <description>${escapeXml(provenanceText)}</description>
      <Style><IconStyle><color>ff0000ff</color><scale>1.2</scale></IconStyle></Style>
      <Point><coordinates>${center.lon_deg},${center.lat_deg},0</coordinates></Point>
    </Placemark>`);

    if (cavityR > 500) {
      const ring = circlePolygon(center.lat_deg, center.lon_deg, cavityR, 64);
      const coords = ring.map(([lon, lat]) => `${lon},${lat},0`).join(" ");
      sourcePlacemarks.push(`
    <Placemark>
      <name>Source cavity (r=${escapeXml(length(cavityR))})</name>
      <Style><LineStyle><color>ff4444ff</color><width>2</width></LineStyle>
      <PolyStyle><color>334444ff</color></PolyStyle></Style>
      <Polygon><outerBoundaryIs><LinearRing>
        <coordinates>${coords}</coordinates>
      </LinearRing></outerBoundaryIs></Polygon>
    </Placemark>`);
    }
  }

  for (const p of runupPoints) {
    if (!Number.isFinite(p.runup_m) || p.runup_m <= 0) continue;
    runupPlacemarks.push(`
    <Placemark>
      <name>${escapeXml(p.name)}</name>
      <description>${escapeXml(`Runup: ~${length(p.runup_m)}\nArrival: T+${Math.round(p.arrival_time_s / 60)} min\nInundation: ${length(p.inundation_extent_m)}\n${p.quantitative_label}; ${p.quantitative_confidence} confidence\nSlope: ${p.beach_slope_deg} deg (${p.slope_provenance.sample_id}; ${p.slope_provenance.record_id})\nDepth: ${length(p.offshore_depth_m)} (${p.depth_provenance.sample_id}; ${p.depth_provenance.record_id})`)}</description>
      <ExtendedData>
        <Data name="slope_record_id"><value>${escapeXml(p.slope_provenance.record_id)}</value></Data>
        <Data name="depth_record_id"><value>${escapeXml(p.depth_provenance.record_id)}</value></Data>
        <Data name="quantitative_label"><value>${p.quantitative_label}</value></Data>
        <Data name="quantitative_confidence"><value>${p.quantitative_confidence}</value></Data>
      </ExtendedData>
      <Style><IconStyle><color>ff00aaff</color><scale>0.8</scale></IconStyle></Style>
      <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
    </Placemark>`);
  }

  if (sourcePlacemarks.length === 0 && runupPlacemarks.length === 0) {
    return exportFailure("data", "No source or coastal runup data is available for KML export.", true);
  }

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Cataclysm — ${escapeXml(name)}</name>
  <description>${escapeXml(provenanceText)}</description>
  <ExtendedData><Data name="display_unit_system"><value>${provenance.unitSystem}</value></Data></ExtendedData>
  <Folder>
    <name>Source</name>${sourcePlacemarks.join("")}
  </Folder>
  <Folder>
    <name>Coastal runup points</name>${runupPlacemarks.join("")}
  </Folder>
</Document>
</kml>`;

  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  const presetId = meta.preset?.id ?? "custom-scenario";
  return downloadBlob(blob, `cataclysm-${safeFilenamePart(presetId)}.kml`);
  } catch (error) {
    return unexpectedExportFailure("data", "KML serialization", error);
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function round5(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100_000) / 100_000;
}

function clampNumber(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function normaliseLon(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

export function exportRunupCsv(points: RunupPoint[], unitSystem: UnitSystem = "metric"): ExportResult {
  if (points.length === 0) return exportFailure("data", "No coastal runup points are available for CSV export.", true);
  try {
  const text = (value: string | null) => encodeSpreadsheetSafeCsvText(value ?? "");
  const header = [
    "point_id", "name", "lat_deg", "lon_deg", "runup_m", "offshore_amplitude_m",
    "arrival_time_s", "inundation_extent_m", "beach_slope_deg", "offshore_depth_m",
    "quantitative_label", "quantitative_confidence", "slope_sample_id", "slope_record_id",
    "slope_source", "slope_source_url", "slope_method", "slope_datum", "slope_resolution",
    "slope_observed_or_published", "slope_confidence", "slope_uncertainty_value",
    "slope_uncertainty_unit", "slope_uncertainty_basis", "slope_placeholder",
    "depth_sample_id", "depth_record_id", "depth_source", "depth_source_url", "depth_method",
    "depth_datum", "depth_resolution", "depth_observed_or_published", "depth_confidence",
    "depth_uncertainty_value", "depth_uncertainty_unit", "depth_uncertainty_basis", "depth_placeholder",
    "display_unit_system",
  ];
  const rows = [header.join(",")];
  for (const point of points) {
    const slope = point.slope_provenance;
    const depth = point.depth_provenance;
    rows.push([
      text(point.id), text(point.name), point.lat, point.lon, point.runup_m,
      point.offshore_amplitude_m, point.arrival_time_s, point.inundation_extent_m,
      point.beach_slope_deg, point.offshore_depth_m, text(point.quantitative_label),
      text(point.quantitative_confidence), text(slope.sample_id), text(slope.record_id),
      text(slope.source), text(slope.source_url), text(slope.method), text(slope.datum),
      text(slope.resolution), text(slope.observed_or_published), text(slope.confidence),
      slope.uncertainty_value ?? "", text(slope.uncertainty_unit), text(slope.uncertainty_basis),
      slope.placeholder, text(depth.sample_id), text(depth.record_id), text(depth.source),
      text(depth.source_url), text(depth.method), text(depth.datum), text(depth.resolution),
      text(depth.observed_or_published), text(depth.confidence), depth.uncertainty_value ?? "",
      text(depth.uncertainty_unit), text(depth.uncertainty_basis), depth.placeholder, text(unitSystem),
    ].join(","));
  }
  const blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv" });
  return downloadBlob(blob, `cataclysm-coastal-runup-${timestampSuffix()}.csv`);
  } catch (error) {
    return unexpectedExportFailure("data", "Coastal runup CSV serialization", error);
  }
}

export function exportGaugeCsv(
  series: import("../types/scenario").GaugeTimeSeries[],
  solverMode: string,
  bathymetrySource: string,
  runQuality?: import("../types/scenario").RunQualityRecord | null,
  unitSystem: UnitSystem = "metric",
): ExportResult {
  if (series.length === 0) return exportFailure("data", "No gauge samples are available for CSV export.", true);
  const quality = preflightRunQuality({ runQuality });
  if (!quality.ok) return exportFailure("preflight", quality.reason, false);

  try {
  const header = "gauge_name,lat_deg,lon_deg,time_s,eta_m,solver_mode,bathymetry_source,horizontal_crs,vertical_datum,vertical_axis,run_quality,cfl_number,mass_drift_pct,energy_drift_pct,display_unit_system";
  const rows: string[] = [header];
  for (const ts of series) {
    const name = encodeSpreadsheetSafeCsvText(ts.gauge.name);
    const lat = round5(ts.gauge.lat_deg);
    const lon = round5(ts.gauge.lon_deg);
    const mode = encodeSpreadsheetSafeCsvText(solverMode);
    const bathy = encodeSpreadsheetSafeCsvText(bathymetrySource);
    for (const s of ts.samples) {
      rows.push(
        `${name},${lat},${lon},${s.time_s.toFixed(1)},${s.eta_m.toFixed(4)},${mode},${bathy},` +
          `EPSG:4326,idealized_mean_sea_level,positive_up,${runQuality?.status ?? "unavailable"},${runQuality?.cfl_number ?? ""},${runQuality?.mass_drift_pct ?? ""},${runQuality?.energy_drift_pct ?? ""},${unitSystem}`,
      );
    }
  }

  const blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv" });
  return downloadBlob(blob, `cataclysm-gauges-${timestampSuffix()}.csv`);
  } catch (error) {
    return unexpectedExportFailure("data", "Gauge CSV serialization", error);
  }
}

const SPREADSHEET_FORMULA_PREFIX = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/u;

/**
 * Encode an untrusted text cell for CSV consumed by desktop spreadsheets.
 * A leading apostrophe forces text interpretation in Excel and LibreOffice;
 * ASCII/full-width formula initiators and leading controls are neutralized
 * before RFC 4180 quoting. Trusted numeric columns deliberately bypass this
 * encoder so negative and scientific values remain machine-readable numbers.
 */
export function encodeSpreadsheetSafeCsvText(value: string): string {
  const safe = SPREADSHEET_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (/[",\t\r\n]/u.test(safe)) {
    return '"' + safe.replace(/"/g, '""') + '"';
  }
  return safe;
}

function circlePolygon(lat: number, lon: number, radius_m: number, n = 32): number[][] {
  const coords: number[][] = [];
  const R = 6_371_008.8;
  const safeLat = clampNumber(Number.isFinite(lat) ? lat : 0, -89.999, 89.999);
  const safeLon = normaliseLon(lon);
  const safeRadiusM = clampNumber(Number.isFinite(radius_m) ? radius_m : 0, 0, 50_000);
  const cosLat = Math.max(Math.abs(Math.cos((safeLat * Math.PI) / 180)), 1e-6);
  for (let i = 0; i <= n; i++) {
    const angle = (2 * Math.PI * i) / n;
    const dlat = (safeRadiusM * Math.cos(angle)) / R;
    const dlon = (safeRadiusM * Math.sin(angle)) / (R * cosLat);
    coords.push([
      round5(normaliseLon(safeLon + (dlon * 180) / Math.PI)),
      round5(clampNumber(safeLat + (dlat * 180) / Math.PI, -90, 90)),
    ]);
  }
  return coords;
}
