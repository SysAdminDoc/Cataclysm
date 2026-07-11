import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function seedAcknowledgedPreview(page: { addInitScript: (script: () => void) => Promise<void> }) {
  await page.addInitScript(() => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
    localStorage.setItem("tsunamisim.tour_completed_at", now);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
    localStorage.removeItem("tsunamisim.saved_scenarios");
  });
}

test.describe("TsunamiSimulator browser preview", () => {
  test.beforeEach(async ({ page }) => {
    await seedAcknowledgedPreview(page);
  });

  test("loads the app shell and renders a globe canvas", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app__brand")).toBeVisible();
    await expect(page.locator(".app__title")).toHaveText("Cataclysm");

    const canvas = page.locator(".cesium-widget canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
  });

  test("preset selector lists at least one preset", async ({ page }) => {
    await page.goto("/");
    const presetButtons = page.locator(".preset-card");
    await expect(presetButtons.first()).toBeVisible({ timeout: 10_000 });
    const count = await presetButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("selecting Chicxulub loads source readout", async ({ page }) => {
    await page.goto("/");
    const chicxulub = page.locator('.preset-card:has-text("Chicxulub")');
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();

    await expect(page.locator(".results").filter({ hasText: "Energy" })).toBeVisible({ timeout: 10_000 });
  });

  test("export menu exposes all supported formats", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("button", { name: "PNG", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Video", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Text", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "KML", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Link", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "References", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  });

  test("nuclear hazard mode reveals the client-side detonation controls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    // Hazard-mode switch lives in the header, distinct from the scenario
    // source tabs (which are role=tab).
    await page.getByRole("button", { name: "Nuclear", exact: true }).click();

    const panel = page.locator(".hazard");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText("Nuclear detonation")).toBeVisible();
    await expect(panel.getByRole("button", { name: /pick location on globe/i })).toBeVisible();
    // Weapon preset picker from the ported NukeMap table.
    await expect(panel.getByRole("option", { name: /Little Boy \(Hiroshima\)/ })).toBeAttached();
  });

  test("saves and reloads a custom scenario round trip", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(page.getByText("Custom scenario", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved scenario." })).toBeVisible();

    await page.getByRole("tab", { name: "Nuclear" }).click();
    await expect(page.getByRole("tab", { name: "Nuclear" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: /Load \(1\)/ }).click();
    await page.locator(".scenario-saved__load").filter({ hasText: /^Asteroid/ }).click();

    await expect(page.getByRole("tab", { name: "Asteroid" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("status").filter({ hasText: "Loaded scenario." })).toBeVisible();
  });

  test("cancelling globe pick mode does not trip the recovery boundary", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await page.getByRole("button", { name: "Pick on globe" }).click();
    const pickBanner = page.locator(".app__globe-pickbanner");
    await expect(pickBanner).toBeVisible();
    await pickBanner.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(page.locator(".app")).toHaveAttribute("data-compare", "true");
    await expect(page.locator(".app__globe-tag", { hasText: "Slot B" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Automated accessibility regression checks (axe-core)
// ---------------------------------------------------------------------------
// Scoped to WCAG 2.x A/AA conformance rules for the local verification gate.
// Best-practice and AAA rules remain advisory. Cesium's WebGL canvas and
// internal widgets are excluded (GPU-rendered 3D scene with no DOM semantics).
const AXE_EXCLUDE = [".cesium-widget", ".cesium-viewer-toolbar"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function axeScan(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .exclude(AXE_EXCLUDE)
    .analyze();
}

test.describe("Accessibility (axe-core WCAG A/AA)", () => {
  test("first-run disclaimer dialog has no violations", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: /educational model/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("main cockpit has no violations", async ({ page }) => {
    await seedAcknowledgedPreview(page);
    await page.goto("/");
    await expect(page.locator(".app__title")).toHaveText("Cataclysm", { timeout: 10_000 });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("Settings dialog has no violations", async ({ page }) => {
    await seedAcknowledgedPreview(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("LogViewer dialog has no violations", async ({ page }) => {
    await seedAcknowledgedPreview(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Diagnostics log" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("cockpit with active preset has no violations", async ({ page }) => {
    await seedAcknowledgedPreview(page);
    await page.goto("/");
    const chicxulub = page.locator('.preset-card:has-text("Chicxulub")');
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await expect(page.locator(".results").filter({ hasText: "Energy" })).toBeVisible({ timeout: 10_000 });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });
});
