import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 1,
  // Concurrent Cesium/WebGL screenshots contend for renderer resources on the
  // Windows release runner. Bound concurrency and fail the gate if a retry was
  // needed instead of silently accepting an unstable visual result.
  workers: 3,
  failOnFlakyTests: true,
  snapshotPathTemplate: "{testDir}/__snapshots__/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4187",
    headless: true,
    locale: "en-US",
    timezoneId: "UTC",
    contextOptions: {
      reducedMotion: "reduce",
    },
    serviceWorkers: "block",
    deviceScaleFactor: 1,
  },
  webServer: {
    // This server refuses to preview a stale or unproven dist directory. The
    // npm test:e2e wrapper builds only when the deterministic source digest no
    // longer matches the recorded production artifact.
    command: "node scripts/serve-e2e-preview.mjs",
    port: 4187,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
