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
    localStorage.setItem("tsunamisim._settings_schema_version", "3");
    localStorage.setItem("tsunamisim.launch_experience_seen_at", now);
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
    localStorage.setItem("tsunamisim.tour_completed_at", now);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
    localStorage.removeItem("tsunamisim.saved_scenarios");
  });
}

async function seedAcknowledgedLatte(page: { addInitScript: (script: () => void) => Promise<void> }) {
  await page.addInitScript(() => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim._settings_schema_version", "3");
    localStorage.setItem("tsunamisim.launch_experience_seen_at", now);
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

async function hideCesiumWidget(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: ".cesium-widget { visibility: hidden !important; }",
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

  test("reduced-motion launch cinematic", async ({ page }) => {
    await page.goto("/?launchExperience=1&launchMotion=reduce&launchHold=1");
    const dialog = page.getByRole("dialog", { name: "Cataclysm" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toHaveAttribute("data-reduced-motion", "true");
    await expect(page.locator('.app__globe-status[data-status="loading"]')).toHaveCount(0, { timeout: 15_000 });
    await hideCesiumWidget(page);

    await expect(page).toHaveScreenshot("desktop-launch-cinematic.png", {
      maxDiffPixelRatio: 0.01,
      timeout: 15_000,
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
    await expect(page.getByRole("button", { name: "Run & Watch" })).toBeVisible({ timeout: 10_000 });

    await expect(page).toHaveScreenshot("desktop-preset-active.png", {
      mask: [page.locator(CANVAS_MASK)],
      maxDiffPixelRatio: 0.01,
    });
  });

  test("direct what-if preview", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Explore a what-if/i }).click();
    await expect(page.getByRole("button", { name: "Run & Watch" })).toBeVisible();

    await expect(page).toHaveScreenshot("desktop-direct-preview.png", {
      mask: [page.locator(CANVAS_MASK)],
      maxDiffPixelRatio: 0.01,
    });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("isolated nuclear workspace", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Nuclear", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Direct effects workspace" })).toBeVisible();
    await expect(page.locator('.app__globe-status[data-status="loading"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(CANVAS_MASK)).toBeVisible({ timeout: 15_000 });

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
    await page.getByRole("button", { name: "Run & Watch" }).click();
    await expect(page.getByRole("button", { name: "Re-run simulation" })).toBeVisible({ timeout: 20_000 });
    const pause = page.getByRole("button", { name: "Pause" });
    if (await pause.isVisible()) await pause.click();

    await expect(page).toHaveScreenshot("desktop-swe-ready.png", {
      mask: [page.locator(CANVAS_MASK)],
      maxDiffPixelRatio: 0.01,
    });
  });

  test("SWE solver playback state", async ({ page }) => {
    await seedAcknowledged(page);
    await page.goto("/");
    const chicxulub = page.locator('.preset-card:has-text("Chicxulub")');
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await page.getByRole("button", { name: "Run & Watch" }).click();
    await expect(page.getByText(/Frame \d+\/\d+/)).toBeVisible({ timeout: 20_000 });
    const pause = page.getByRole("button", { name: "Pause" });
    if (await pause.isVisible()) await pause.click();

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
    await expect(page.getByRole("button", { name: "Run & Watch" })).toBeVisible({ timeout: 10_000 });

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
