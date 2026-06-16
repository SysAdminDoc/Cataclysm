import { test, expect } from "@playwright/test";

test.describe("TsunamiSimulator browser preview", () => {
  test("loads the app shell and renders a globe canvas", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app__brand")).toBeVisible();
    await expect(page.locator(".app__title")).toHaveText("TsunamiSimulator");

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

    const resultsPanel = page.locator(".results-panel");
    await expect(resultsPanel).toBeVisible({ timeout: 10_000 });
  });

  test("export buttons are present in toolbar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('button:has-text("PNG")')).toBeVisible();
    await expect(page.locator('button:has-text("Share")')).toBeVisible();
    await expect(page.locator('button:has-text("Video")')).toBeVisible();
    await expect(page.locator('button:has-text("Text")')).toBeVisible();
    await expect(page.locator('button:has-text("Citations")')).toBeVisible();
    await expect(page.locator('button:has-text("Settings")')).toBeVisible();
  });
});
