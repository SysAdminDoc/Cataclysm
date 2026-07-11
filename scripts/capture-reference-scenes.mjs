import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = process.cwd();
const scenePath = path.join(root, "src", "data", "reference-scenes.json");
const fixturePath = path.join(root, "src", "data", "direct-hazard-capture-fixtures.json");
const registryPath = path.join(root, "src", "data", "earth-assets.json");
const baselinePath = path.join(root, "tests", "reference-baselines.json");
const outputDir = path.join(root, "artifacts", "visual-reference", "latest");
const args = process.argv.slice(2);
const mode = args.includes("--record") ? "record" : "verify";
const skipBuild = args.includes("--skip-build");
const filterValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const sceneFilter = filterValue("--scene");
const sceneFilters = sceneFilter ? new Set(sceneFilter.split(",").map((value) => value.trim()).filter(Boolean)) : null;
const resolutionFilter = filterValue("--resolution");
const approveTarget = filterValue("--approve");
const approvalReason = filterValue("--reason");
const port = 4189;
const origin = `http://127.0.0.1:${port}`;

if (approveTarget) {
  const expectedTarget = sceneFilter && resolutionFilter ? `${sceneFilter}@${resolutionFilter}` : null;
  if (!expectedTarget || expectedTarget !== approveTarget || !approvalReason?.trim()) {
    throw new Error("Approval requires one exact --scene, --resolution, matching --approve key, and non-empty --reason.");
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value, Object.keys(value).sort());
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? "unknown"}`);
}

function validateContract(contract, registry, fixtures) {
  if (contract.schemaVersion !== 1 || contract.captureContractVersion !== "1.0.0") {
    throw new Error("Unsupported reference-scene contract.");
  }
  if (contract.scenes.length !== 12 || new Set(contract.scenes.map((scene) => scene.id)).size !== 12) {
    throw new Error("HR-00 requires exactly 12 unique scene IDs.");
  }
  const expectedViewports = { "1440p": [2560, 1440], "4k": [3840, 2160] };
  for (const [id, dimensions] of Object.entries(expectedViewports)) {
    const actual = contract.viewports[id];
    if (!actual || actual.width !== dimensions[0] || actual.height !== dimensions[1]) {
      throw new Error(`${id} must be exactly ${dimensions[0]}x${dimensions[1]}.`);
    }
  }
  const assets = new Map(registry.assets.map((asset) => [asset.id, asset]));
  const styles = new Map(registry.style_bindings.map((style) => [style.id, style]));
  const permissionProfiles = new Map(registry.permission_profiles.map((profile) => [profile.id, profile]));
  const presetIds = new Set([
    "chicxulub", "eltanin", "tohoku_2011", "indian_ocean_2004", "lituya_bay_1958",
    "krakatoa_1883", "storegga", "hunga_tonga_2022", "cumbre_vieja_scenario",
    "poseidon_realistic", "poseidon_propaganda",
  ]);
  for (const scene of contract.scenes) {
    if (!/^[a-z0-9-]+$/.test(scene.id) || !Number.isFinite(scene.seed) || !Number.isFinite(scene.effectTimeMs)) {
      throw new Error(`${scene.id}: invalid ID, seed, or effect phase.`);
    }
    if (!Number.isFinite(Date.parse(scene.utc)) || scene.simulationTimeS < 0 || scene.simulationTimeS > 21_600) {
      throw new Error(`${scene.id}: invalid UTC or simulation time.`);
    }
    const cameraValues = Object.values(scene.camera);
    if (cameraValues.some((value) => !Number.isFinite(value))) throw new Error(`${scene.id}: invalid camera.`);
    const style = styles.get(scene.requestedStyleId);
    if (!style) throw new Error(`${scene.id}: unknown Earth style ${scene.requestedStyleId}.`);
    const visualAssets = scene.visualAssetIds.map((id) => assets.get(id));
    if (visualAssets.some((asset) => !asset)) throw new Error(`${scene.id}: unknown visual asset.`);
    if (!visualAssets.every((asset) => asset.quality_tiers.includes(scene.qualityTier))) {
      throw new Error(`${scene.id}: requested quality is not supported by every visual asset.`);
    }
    if (!visualAssets.every((asset) => permissionProfiles.get(asset.permission_profile_id)?.permissions.static_capture.decision === "allowed")) {
      throw new Error(`${scene.id}: a visual asset does not explicitly allow static capture.`);
    }
    if (style.imagery_asset_id !== scene.visualAssetIds[0] || style.terrain_asset_id !== scene.visualAssetIds[1]) {
      throw new Error(`${scene.id}: style binding and visual assets disagree.`);
    }
    for (const id of scene.dataAssetIds ?? []) if (!assets.has(id)) throw new Error(`${scene.id}: unknown data asset ${id}.`);
    if (scene.sourceRefs.some((ref) => /^https?:/i.test(ref))) throw new Error(`${scene.id}: external URLs are not source IDs.`);
    if (scene.workflow.kind === "preset" && !presetIds.has(scene.workflow.presetId)) {
      throw new Error(`${scene.id}: unknown preset ${scene.workflow.presetId}.`);
    }
    if (scene.workflow.runSolver && scene.simulationTimeS > 3_600) {
      throw new Error(`${scene.id}: capture time exceeds the current SWE run.`);
    }
    if (scene.workflow.kind.startsWith("direct-")) {
      if (!fixtures[scene.workflow.fixtureId]) throw new Error(`${scene.id}: missing Rust fixture.`);
      if (stableJson(fixtures[scene.workflow.fixtureId].center) !== stableJson(scene.workflow.request.center)) {
        throw new Error(`${scene.id}: fixture and request centers disagree.`);
      }
    }
  }
}

function pngDimensions(buffer) {
  if (buffer.toString("ascii", 1, 4) !== "PNG") throw new Error("Capture is not a PNG.");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function seedPreview() {
  const fixed = JSON.stringify("2026-01-01T00:00:00.000Z");
  localStorage.setItem("tsunamisim._settings_schema_version", "1");
  localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", fixed);
  localStorage.setItem("tsunamisim.tour_completed_at", fixed);
  localStorage.setItem("tsunamisim.token_banner_dismissed_at", fixed);
  localStorage.setItem("tsunamisim.theme", JSON.stringify("mocha"));
  localStorage.setItem("tsunamisim.globe_style", JSON.stringify("natural-earth-2"));
  localStorage.removeItem("tsunamisim.saved_scenarios");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${origin}.`);
}

const presetLabels = {
  chicxulub: "Chicxulub", eltanin: "Eltanin", tohoku_2011: "Tohoku",
  lituya_bay_1958: "Lituya Bay",
};

async function configureWorkflow(page, scene) {
  const workflow = scene.workflow;
  if (workflow.kind === "preset") {
    await page.locator(".preset-card", { hasText: presetLabels[workflow.presetId] }).first().click();
    await page.getByRole("button", { name: "Run simulation" }).waitFor({ state: "visible" });
    if (workflow.runSolver) {
      await page.getByRole("button", { name: "Run simulation" }).click();
      await page.getByRole("button", { name: "Re-run simulation" }).waitFor({ state: "visible", timeout: 30_000 });
      const solverTimeline = page.locator('.swe__row input[aria-label="Simulation timeline scrubber"]');
      if (await solverTimeline.count()) {
        const max = Number(await solverTimeline.getAttribute("max"));
        const frame = Math.round((scene.simulationTimeS / 3_600) * max);
        await solverTimeline.evaluate((element, value) => {
          const input = element;
          input.value = String(value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }, frame);
      }
    }
  } else if (workflow.kind.startsWith("direct-")) {
    const nuclear = workflow.kind === "direct-nuclear";
    await page.getByRole("button", { name: nuclear ? "Nuclear" : "Impact", exact: true }).click();
    if (nuclear) {
      await page.locator(".hazard__select").filter({ has: page.locator('option[value="airburst"]') }).selectOption(workflow.request.burst_type);
    }
    await page.locator(".hazard").getByRole("button", { name: /pick location on globe/i }).click();
    const coordinates = page.getByRole("form", { name: "Enter coordinates" });
    await coordinates.getByLabel("Latitude").fill(String(workflow.request.center.lat));
    await coordinates.getByLabel("Longitude").fill(String(workflow.request.center.lon));
    await coordinates.getByRole("button", { name: "Go" }).click();
    await page.getByRole("tab", { name: "Results" }).click();
    await page.locator(".hazard__results").waitFor({ state: "visible" });
  }
  const transport = page.locator('.simulation-transport input[aria-label="Scenario timeline scrubber"]');
  if (await transport.count()) {
    await transport.evaluate((element, value) => {
      const input = element;
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, scene.simulationTimeS);
  }
}

async function applyCaptureView(page, contract, scene) {
  const view = {
    sceneId: scene.id,
    utc: scene.utc,
    seed: scene.seed,
    qualityTier: scene.qualityTier,
    exposure: scene.exposure,
    simulationTimeS: scene.simulationTimeS,
    effectTimeMs: scene.effectTimeMs,
    camera: { ...scene.camera, verticalFovDeg: contract.defaultVerticalFovDeg },
  };
  await page.waitForFunction(() => document.documentElement.dataset.referenceBridgeReady === "true");
  // React StrictMode mounts, cleans up, and remounts effects in development;
  // wait for the final listener rather than dispatching into the first mount.
  await page.waitForTimeout(500);
  const bridgeDebug = await page.evaluate((detail) => {
    document.documentElement.dataset.referenceCaptureActive = "true";
    window.__CATACLYSM_APPLY_REFERENCE_VIEW__(detail);
    return {
      bridge: typeof window.__CATACLYSM_APPLY_REFERENCE_VIEW__,
      received: document.documentElement.dataset.referenceEventReceived,
      capture: window.__CATACLYSM_REFERENCE_CAPTURE__,
    };
  }, view);
  if (bridgeDebug.received !== scene.id || bridgeDebug.capture?.ready !== true) {
    throw new Error(`${scene.id}: capture bridge did not apply the requested view.`);
  }
  if (scene.workflow.kind.startsWith("direct-") && scene.effectTimeMs > 0) {
    await page.evaluate(() => {
      const button = document.querySelector(".hazard__detonate");
      if (!(button instanceof HTMLButtonElement)) throw new Error("Detonation control unavailable.");
      button.click();
    });
    const reapplied = await page.evaluate((detail) => {
      window.__CATACLYSM_APPLY_REFERENCE_VIEW__(detail);
      return window.__CATACLYSM_REFERENCE_CAPTURE__;
    }, view);
    if (reapplied?.ready !== true || reapplied.sceneId !== scene.id) {
      throw new Error(`${scene.id}: capture view did not reapply after the deterministic effect phase.`);
    }
  }
  return view;
}

async function collectRuntime(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const canvas = document.querySelector(".cesium-widget canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Cesium canvas unavailable.");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) throw new Error("WebGL unavailable.");
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    const samples = [];
    let previous = performance.now();
    for (let index = 0; index < 30; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      samples.push(now - previous);
      previous = now;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      capture: window.__CATACLYSM_REFERENCE_CAPTURE__,
      canvas: { cssWidth: rect.width, cssHeight: rect.height, bufferWidth: canvas.width, bufferHeight: canvas.height },
      page: {
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      gpu: {
        webglVersion: gl.getParameter(gl.VERSION), vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
      },
      frameIntervalsMs: samples,
    };
  });
}

const contract = JSON.parse(await readFile(scenePath, "utf8"));
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const fixtures = JSON.parse(await readFile(fixturePath, "utf8"));
const baselines = JSON.parse(await readFile(baselinePath, "utf8"));
validateContract(contract, registry, fixtures);

if (!skipBuild) run(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/c", "npm", "run", "build"] : ["run", "build"]);
if (!sceneFilter && !resolutionFilter) await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore", windowsHide: true });
const gitCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim();
const selectedScenes = contract.scenes.filter((scene) => !sceneFilters || sceneFilters.has(scene.id));
const selectedViewports = Object.entries(contract.viewports).filter(([id]) => !resolutionFilter || id === resolutionFilter);
if (!selectedScenes.length || !selectedViewports.length) throw new Error("Scene or resolution filter matched nothing.");
const runManifest = [];
let browser;

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  for (const [resolution, viewport] of selectedViewports) {
    for (const scene of selectedScenes) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce", serviceWorkers: "block" });
      await context.addInitScript(seedPreview);
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin && ["http:", "https:"].includes(url.protocol)) await route.abort("blockedbyclient");
        else await route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => console.error(`[capture:${scene.id}]`, error));
      page.on("console", (message) => {
        if (message.type() === "error") console.error(`[capture:${scene.id}]`, message.text());
      });
      await page.goto(`${origin}/?referenceCapture=1&referenceScene=${encodeURIComponent(scene.id)}`, { waitUntil: "domcontentloaded" });
      await page.locator('.app__globe-status[data-status="connecting"]').waitFor({ state: "detached", timeout: 20_000 });
      if (await page.locator('.app__globe-status[data-status="failed"]').count()) {
        throw new Error(`${scene.id}: Earth imagery failed before capture.`);
      }
      await configureWorkflow(page, scene);
      await applyCaptureView(page, contract, scene);
      await page.waitForTimeout(250);
      const runtime = await collectRuntime(page);
      const sortedFrames = [...runtime.frameIntervalsMs].sort((left, right) => left - right);
      if (runtime.page.innerWidth !== viewport.width || runtime.page.innerHeight !== viewport.height || runtime.page.scrollWidth !== viewport.width || runtime.page.scrollHeight !== viewport.height) {
        throw new Error(`${scene.id}@${resolution}: viewport overflow or size mismatch.`);
      }
      if (runtime.canvas.cssWidth !== viewport.width || runtime.canvas.cssHeight !== viewport.height || runtime.canvas.bufferWidth !== viewport.width || runtime.canvas.bufferHeight !== viewport.height) {
        throw new Error(`${scene.id}@${resolution}: canvas is not true-resolution.`);
      }
      const earthSession = runtime.capture?.earthSession;
      if (
        !earthSession ||
        earthSession.imageryAssetId !== scene.visualAssetIds[0] ||
        earthSession.terrainAssetId !== scene.visualAssetIds[1] ||
        !["ready", "degraded"].includes(earthSession.health)
      ) {
        throw new Error(`${scene.id}@${resolution}: active Earth session does not match the approved assets: ${JSON.stringify(earthSession)}.`);
      }
      const image = await page.screenshot({ animations: "disabled" });
      const dimensions = pngDimensions(image);
      if (dimensions.width !== viewport.width || dimensions.height !== viewport.height) throw new Error(`${scene.id}@${resolution}: PNG dimensions disagree.`);
      const key = `${scene.id}@${resolution}`;
      const sceneHash = sha256(Buffer.from(JSON.stringify(scene)));
      const imageHash = sha256(image);
      const software = /swiftshader|llvmpipe|software/i.test([runtime.gpu.renderer, runtime.gpu.unmaskedRenderer].filter(Boolean).join(" "));
      const metadata = {
        schemaVersion: 1, captureContractVersion: contract.captureContractVersion, sceneId: scene.id, resolution,
        sceneSha256: sceneHash, pngSha256: imageHash, gitCommit, capturedAt: new Date().toISOString(),
        browser: browser.version(), os: process.platform, viewport, ...runtime,
        earthRegistryVersion: registry.registry_version,
        earthAssets: scene.visualAssetIds.map((id) => {
          const asset = registry.assets.find((candidate) => candidate.id === id);
          return { id: asset.id, providerId: asset.provider_id, version: asset.version };
        }),
        frameTimingMs: { samples: sortedFrames.length, p50: percentile(sortedFrames, 0.5), p95: percentile(sortedFrames, 0.95), max: sortedFrames.at(-1) },
        softwareRenderer: software, sourceRefs: scene.sourceRefs, expectedVisualAssetIds: scene.visualAssetIds,
        requestSha256: sha256(Buffer.from(JSON.stringify(scene.workflow))), fixtureSha256: scene.workflow.fixtureId ? sha256(Buffer.from(JSON.stringify(fixtures[scene.workflow.fixtureId]))) : null,
      };
      const imagePath = path.join(outputDir, `${key}.png`);
      await writeFile(imagePath, image);
      await writeFile(path.join(outputDir, `${key}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
      runManifest.push(metadata);
      if (mode === "verify") {
        const approved = baselines.entries[key];
        if (!approved) throw new Error(`${key}: no approved baseline. Review the candidate and approve only this scene/resolution.`);
        if (approved.pngSha256 !== imageHash || approved.sceneSha256 !== sceneHash) throw new Error(`${key}: visual or scene contract drifted from its reviewed baseline.`);
      }
      await context.close();
      console.log(`${mode === "verify" ? "verified" : "recorded"} ${key} ${imageHash}`);
    }
  }
  let priorCaptures = [];
  if (sceneFilter || resolutionFilter) {
    try {
      priorCaptures = JSON.parse(await readFile(path.join(outputDir, "capture-manifest.json"), "utf8")).captures ?? [];
    } catch {
      // A filtered first run starts a new local candidate manifest.
    }
  }
  const replacedKeys = new Set(runManifest.map((entry) => `${entry.sceneId}@${entry.resolution}`));
  const captures = [...priorCaptures.filter((entry) => !replacedKeys.has(`${entry.sceneId}@${entry.resolution}`)), ...runManifest]
    .sort((left, right) => `${left.sceneId}@${left.resolution}`.localeCompare(`${right.sceneId}@${right.resolution}`));
  await writeFile(path.join(outputDir, "capture-manifest.json"), `${JSON.stringify({ schemaVersion: 1, gitCommit, captures }, null, 2)}\n`);
  if (approveTarget) {
    const candidate = runManifest.find((entry) => `${entry.sceneId}@${entry.resolution}` === approveTarget);
    if (!candidate || runManifest.length !== 1) throw new Error("Approval requires filters that produce exactly one scene/resolution candidate.");
    const previous = baselines.entries[approveTarget];
    const approver = spawnSync("git", ["config", "user.name"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim();
    baselines.entries[approveTarget] = {
      pngSha256: candidate.pngSha256,
      sceneSha256: candidate.sceneSha256,
      width: candidate.viewport.width,
      height: candidate.viewport.height,
      review: {
        reason: approvalReason.trim(), approver, approvedAt: new Date().toISOString(),
        previousPngSha256: previous?.pngSha256 ?? null, commit: gitCommit,
      },
    };
    await writeFile(baselinePath, `${JSON.stringify(baselines, null, 2)}\n`);
    console.log(`approved ${approveTarget}`);
  }
} finally {
  await browser?.close();
  server.kill();
}
