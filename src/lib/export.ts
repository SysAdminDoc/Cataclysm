/**
 * Scenario export helpers. v0.1.x shipped PNG-of-globe export; v0.3.0
 * adds WebM/MP4 timeline recording via the browser-native MediaRecorder
 * (no extra muxer dependency, works on Chromium/WebView2 and modern WKWebView).
 */

import type { InitialDisplacement, Preset } from "../types/scenario";
import {
  buildModelProvenance,
  provenanceSummary,
  type ModelProvenanceInput,
} from "./model-provenance";
import { isTauri } from "./tauri";
import {
  assertEarthOperationAllowed,
  type EarthOperationPreflight,
} from "./earth-assets";

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
  const id = safeFilenamePart(meta.preset?.id ?? "custom-scenario").slice(0, 64);
  const t = Math.round(meta.timeS / 60);
  return `cataclysm-${id}-t${t}min-${timestampSuffix()}.${ext}`;
}

/** Returns the globe canvas contents as a PNG data URL, or null if it's not mountable. */
export function captureGlobePng(): string | null {
  if (!preflightMediaExport("static_capture")) return null;
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
  const line1 = `Cataclysm v${p.appVersion} | ${p.generatedAt} | ${p.scenarioType} | ${p.solverMode}`;
  const line2 = `${p.bathymetrySource} | ${citation} | ${p.limitation}`;
  const line3 = `Earth assets ${p.assetRegistryVersion}: ${p.visualAssetIds.join(", ")} | ${attributions.join(" · ")}`;

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
  if (!isTauri()) stampDemoWatermark(offscreen);
  stampProvenanceStrip(offscreen, meta, attributions);
  return offscreen;
}

/** Full export flow — capture + download. Returns true if a screenshot was produced. */
export function exportGlobePng(meta: ScreenshotMeta): boolean {
  if (!preflightRunQuality(meta).ok) return false;
  const preflight = preflightMediaExport("static_capture");
  if (!preflight) return false;
  const sourceCanvas = findGlobeCanvas();
  if (!sourceCanvas) return false;
  const stamped = copyGlobeWithProvenance(sourceCanvas, meta, preflight.attributions);
  if (!stamped) return false;
  downloadDataUrl(stamped.toDataURL("image/png"), suggestedFilename(meta, "png"));
  return true;
}

/** F4-09 — Share-card export. Composites the bare globe canvas with a
 *  200-px-tall header strip containing preset name, key parameters,
 *  citation short-ref, and the project URL. The header strip is rendered
 *  to a 1200×800 share-card-friendly aspect via an offscreen canvas
 *  (no external library needed). Includes a footer "Educational only —
 *  not for evacuation" trust-signal to preserve product framing. */
export function exportGlobeShareCard(meta: ScreenshotMeta): boolean {
  if (!preflightRunQuality(meta).ok) return false;
  const preflight = preflightMediaExport("static_capture");
  if (!preflight) return false;
  const sourceCanvas = findGlobeCanvas();
  if (!sourceCanvas) return false;

  const W = 1200;
  const H = 800;
  const HEADER_H = 100;
  const FOOTER_H = 58;
  const provenance = buildModelProvenance(meta);
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

  const presetName = provenance.scenarioName;
  const date = meta.preset?.date ?? "Custom";
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
    `Cataclysm v${provenance.appVersion} | ${provenance.generatedAt} | ${provenance.solverMode}`,
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

export type ComparisonExportMeta = {
  metaA: ScreenshotMeta;
  metaB: ScreenshotMeta;
  labelA?: string;
  labelB?: string;
};

export function exportComparisonPng(opts: ComparisonExportMeta): boolean {
  if (!preflightRunQuality(opts.metaA).ok || !preflightRunQuality(opts.metaB).ok) return false;
  const preflight = preflightMediaExport("static_capture");
  if (!preflight) return false;
  const canvases = findAllGlobeCanvases();
  if (canvases.length < 2) return false;
  const [srcA, srcB] = canvases;

  const GAP = 4;
  const LABEL_H = 36;
  const FOOTER_H = 50;
  const paneW = Math.max(srcA.width, srcB.width);
  const paneH = Math.max(srcA.height, srcB.height);
  const W = paneW * 2 + GAP;
  const H = LABEL_H + paneH + FOOTER_H;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  ctx.fillStyle = "#1e1e2e";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#181825";
  ctx.fillRect(0, 0, W, LABEL_H);
  ctx.font = "bold 16px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#89b4fa";
  ctx.textAlign = "center";
  ctx.fillText(opts.labelA ?? "Slot A", paneW / 2, LABEL_H / 2);
  ctx.fillText(opts.labelB ?? "Slot B", paneW + GAP + paneW / 2, LABEL_H / 2);

  ctx.drawImage(srcA, 0, LABEL_H, paneW, paneH);
  ctx.fillStyle = "#313244";
  ctx.fillRect(paneW, LABEL_H, GAP, paneH);
  ctx.drawImage(srcB, paneW + GAP, LABEL_H, paneW, paneH);

  if (!isTauri()) {
    stampDemoWatermark(canvas);
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
    `A: ${provA.scenarioName} | ${provA.scenarioType}`,
    12, H - FOOTER_H + 8,
  );
  ctx.fillText(
    `B: ${provB.scenarioName} | ${provB.scenarioType}`,
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

  const dataUrl = canvas.toDataURL("image/png");
  downloadDataUrl(dataUrl, `cataclysm-compare-${timestampSuffix()}.png`);
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
  const qualityPreflight = preflightRunQuality(meta);
  if (!qualityPreflight.ok) return { ok: false, reason: qualityPreflight.reason };
  const preflight = preflightMediaExport("video_capture");
  if (!preflight) {
    return { ok: false, reason: "Earth asset rights or live attribution preflight blocked video export" };
  }
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
  if (!preflightRunQuality(meta).ok) return false;
  if (!snapshots.length) return false;
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

  // Time-tagged CZML ImageProperty: each element is only { interval, image }.
  // repeat/color/transparent belong to the ImageMaterial level (below), not
  // inside these interval elements, or a strict CzmlDataSource ignores them.
  const materialIntervals: unknown[] = [];
  for (let k = 0; k < snapshots.length; k++) {
    const snap = snapshots[k];
    const next = k + 1 < snapshots.length ? snapshots[k + 1].time_s : tEnd + 1;
    materialIntervals.push({
      interval: `${toIso(snap.time_s)}/${toIso(next)}`,
      image: `data:image/png;base64,${snap.eta_png_b64}`,
    });
  }

  const [west, south, east, north] = snapshots[0].bbox;

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
    {
      id: "wave-field",
      name: "SWE wave field",
      availability: interval,
      description: `Cataclysm ${provenance.scenarioName} - ${snapshots.length} snapshots. ${provenance.limitation}`,
      properties: {
        appVersion: provenance.appVersion,
        assetRegistryVersion: provenance.assetRegistryVersion,
        bathymetryAssetId: provenance.bathymetryAssetId,
        bathymetrySource: provenance.bathymetrySource,
        citationReference: provenance.citationReference,
        citationUrl: provenance.citationUrl,
        generatedAt: provenance.generatedAt,
        scenarioType: provenance.scenarioType,
        solverMode: provenance.solverMode,
        solverAssetIds: provenance.solverAssetIds,
        visualAssetIds: provenance.visualAssetIds,
        heightField: snapshots[0].height_field,
      },
      rectangle: {
        coordinates: { wsenDegrees: [west, south, east, north] },
        material: {
          image: {
            image: materialIntervals,
            repeat: { cartesian2: [1, 1] },
            color: { rgba: [255, 255, 255, 230] },
            // The eta PNGs carry their own alpha for land/dry cells; without
            // this the rectangle renders opaque and hides the globe beneath.
            transparent: true,
          },
        },
        height: 0,
      },
    },
  ];

  const json = JSON.stringify(czml, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const presetId = meta.preset?.id ?? "custom-scenario";
  downloadBlob(blob, `cataclysm-${safeFilenamePart(presetId)}.czml`);
  return true;
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
};

export function exportGeoJson(
  points: RunupPoint[],
  meta: ScreenshotMeta,
  isochrones?: import("../types/scenario").Isochrone[] | null,
): boolean {
  if (!preflightRunQuality(meta).ok) return false;
  if (!points.length && !(isochrones && isochrones.length)) return false;
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
      generated_at: provenance.generatedAt,
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
  downloadBlob(blob, `cataclysm-${safeFilenamePart(presetId)}-inundation.geojson`);
  return true;
}

export function exportKml(
  meta: ScreenshotMeta,
  runupPoints: RunupPoint[],
): boolean {
  if (!preflightRunQuality(meta).ok) return false;
  const provenance = buildModelProvenance(meta);
  const provenanceText = provenanceSummary({ ...meta, generatedAt: provenance.generatedAt });
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
      <name>Source cavity (r=${Math.round(cavityR / 1000)} km)</name>
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
      <description>Runup: ${p.runup_m.toFixed(1)} m\nArrival: T+${Math.round(p.arrival_time_s / 60)} min\nInundation: ${Math.round(p.inundation_extent_m)} m</description>
      <Style><IconStyle><color>ff00aaff</color><scale>0.8</scale></IconStyle></Style>
      <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
    </Placemark>`);
  }

  if (sourcePlacemarks.length === 0 && runupPlacemarks.length === 0) return false;

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Cataclysm — ${escapeXml(name)}</name>
  <description>${escapeXml(provenanceText)}</description>
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
  downloadBlob(blob, `cataclysm-${safeFilenamePart(presetId)}.kml`);
  return true;
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

export function exportGaugeCsv(
  series: import("../types/scenario").GaugeTimeSeries[],
  solverMode: string,
  bathymetrySource: string,
  runQuality?: import("../types/scenario").RunQualityRecord | null,
): boolean {
  if (series.length === 0) return false;
  if (!preflightRunQuality({ runQuality }).ok) return false;

  const header = "gauge_name,lat_deg,lon_deg,time_s,eta_m,solver_mode,bathymetry_source,horizontal_crs,vertical_datum,vertical_axis,run_quality,cfl_number,mass_drift_pct,energy_drift_pct";
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
          `EPSG:4326,idealized_mean_sea_level,positive_up,${runQuality?.status ?? "unavailable"},${runQuality?.cfl_number ?? ""},${runQuality?.mass_drift_pct ?? ""},${runQuality?.energy_drift_pct ?? ""}`,
      );
    }
  }

  const blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv" });
  downloadBlob(blob, `cataclysm-gauges-${timestampSuffix()}.csv`);
  return true;
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
