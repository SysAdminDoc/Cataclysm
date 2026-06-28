import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 1,
  snapshotPathTemplate: "{testDir}/__snapshots__/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4187",
    headless: true,
  },
  webServer: {
    command: "npx vite preview --host 127.0.0.1 --port 4187 --strictPort",
    port: 4187,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
