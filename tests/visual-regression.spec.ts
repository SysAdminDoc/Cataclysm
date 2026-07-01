import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const AXE_EXCLUDE = [".cesium-widget", ".cesium-viewer-toolbar"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const CANVAS_MASK = ".cesium-widget canvas";

function axeScan(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .exclude(AXE_EXCLUDE)
    .analyze();
}

async function seedAcknowledged(page: { addInitScript: (script: () => void) => Promise<void> }) {
  await page.addInitScript(() => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
    localStorage.setItem("tsunamisim.tour_completed_at", now);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
    localStorage.removeItem("tsunamisim.saved_scenarios");
  });
}

const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };

async function hideCesiumCanvas(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: `${CANVAS_MASK} { visibility: hidden !important; }`,
  });
}

test.describe("Visual regression — desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test("first-run disclaimer", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: /educational model/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await hideCesiumCanvas(page);

    await expect(page).toHaveScreenshot("desktop-first-run.png", {
      maxDiffPixelRatio: 0.01,
    });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("active preset cockpit", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    const chicxulub = page.locator('.preset-card:has-text("Chicxulub")');
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await expect(page.locator(".results").filter({ hasText: "Energy" })).toBeVisible({
      timeout: 10_000,
    });

    await expect(page).toHaveScreenshot("desktop-preset-active.png", {
      mask: [page.locator(CANVAS_MASK)],
      maxDiffPixelRatio: 0.01,
    });
  });

  test("SWE solver ready state", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    const chicxulub = page.locator('.preset-card:has-text("Chicxulub")');
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await expect(page.locator(".results").filter({ hasText: "Energy" })).toBeVisible({
      timeout: 10_000,
    });

    const runBtn = page.getByRole("button", { name: "Run solver" });
    await expect(runBtn).toBeVisible({ timeout: 5_000 });

    await expect(page).toHaveScreenshot("desktop-swe-ready.png", {
      mask: [page.locator(CANVAS_MASK)],
      maxDiffPixelRatio: 0.01,
    });
  });

  test("SWE solver running state", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    const chicxulub = page.locator('.preset-card:has-text("Chicxulub")');
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await expect(page.locator(".results").filter({ hasText: "Energy" })).toBeVisible({
      timeout: 10_000,
    });

    const runBtn = page.getByRole("button", { name: "Run solver" });
    await expect(runBtn).toBeVisible({ timeout: 5_000 });
    await runBtn.click();

    await page.waitForTimeout(1_000);

    await expect(page).toHaveScreenshot("desktop-swe-running.png", {
      mask: [page.locator(CANVAS_MASK)],
      maxDiffPixelRatio: 0.02,
    });
  });

  test("Settings modal", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await hideCesiumCanvas(page);

    await expect(page).toHaveScreenshot("desktop-settings.png", {
      maxDiffPixelRatio: 0.01,
    });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("Citations modal", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Citations", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await hideCesiumCanvas(page);

    await expect(page).toHaveScreenshot("desktop-citations.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("Log viewer", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Diagnostics log" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await hideCesiumCanvas(page);

    await expect(page).toHaveScreenshot("desktop-logviewer.png", {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe("Visual regression — narrow layout (390px)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(NARROW);
  });

  test("first-run disclaimer — narrow", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: /educational model/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await hideCesiumCanvas(page);

    await expect(page).toHaveScreenshot("narrow-first-run.png", {
      maxDiffPixelRatio: 0.01,
    });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("active preset — narrow", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    const chicxulub = page.locator('.preset-card:has-text("Chicxulub")');
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await expect(page.locator(".results").filter({ hasText: "Energy" })).toBeVisible({
      timeout: 10_000,
    });

    await expect(page).toHaveScreenshot("narrow-preset-active.png", {
      mask: [page.locator(CANVAS_MASK)],
      maxDiffPixelRatio: 0.01,
    });
  });

  test("Settings — narrow", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await hideCesiumCanvas(page);

    await expect(page).toHaveScreenshot("narrow-settings.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("Citations — narrow", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    await page.locator('.icon-button[title="View citations"]').click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await hideCesiumCanvas(page);

    await expect(page).toHaveScreenshot("narrow-citations.png", {
      maxDiffPixelRatio: 0.01,
    });
  });
});
