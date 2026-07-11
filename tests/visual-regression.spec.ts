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

async function seedAcknowledgedLatte(page: { addInitScript: (script: () => void) => Promise<void> }) {
  await page.addInitScript(() => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim._settings_schema_version", "1");
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
    localStorage.setItem("tsunamisim.tour_completed_at", now);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
    localStorage.setItem("tsunamisim.theme", JSON.stringify("latte"));
    localStorage.removeItem("tsunamisim.saved_scenarios");
  });
}

const DESKTOP = { width: 1440, height: 900 };

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
    await expect(page.getByRole("button", { name: "Run simulation" })).toBeVisible({ timeout: 10_000 });

    await expect(page).toHaveScreenshot("desktop-preset-active.png", {
      mask: [page.locator(CANVAS_MASK)],
      maxDiffPixelRatio: 0.01,
    });
  });

  test("isolated nuclear workspace", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Nuclear", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Direct effects workspace" })).toBeVisible();

    await expect(page).toHaveScreenshot("desktop-nuclear-workspace.png", {
      mask: [page.locator(CANVAS_MASK)],
      maxDiffPixelRatio: 0.01,
    });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("SWE solver ready state", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    const chicxulub = page.locator('.preset-card:has-text("Chicxulub")');
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    const runBtn = page.getByRole("button", { name: "Run simulation" });
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
    const runBtn = page.getByRole("button", { name: "Run simulation" });
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

  test("References modal", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    await page.getByRole("button", { name: "References", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await hideCesiumCanvas(page);

    await expect(page).toHaveScreenshot("desktop-references.png", {
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

  test("active workspace — light", async ({ page }) => {
    await seedAcknowledgedLatte(page);
    await page.goto("/");
    const tohoku = page.locator('.preset-card:has-text("Tohoku")');
    await expect(tohoku).toBeVisible({ timeout: 10_000 });
    await tohoku.click();
    await expect(page.getByRole("button", { name: "Run simulation" })).toBeVisible({ timeout: 10_000 });

    await expect(page).toHaveScreenshot("desktop-workspace-light.png", {
      mask: [page.locator(CANVAS_MASK)],
      maxDiffPixelRatio: 0.01,
    });
  });

  test("Settings — light", async ({ page }) => {
    await seedAcknowledgedLatte(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await hideCesiumCanvas(page);

    await expect(page).toHaveScreenshot("desktop-settings-light.png", {
      maxDiffPixelRatio: 0.01,
    });
  });
});
