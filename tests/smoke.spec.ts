import { test, expect } from "@playwright/test";

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

    await expect(page.locator(".results").filter({ hasText: "Energy" })).toBeVisible({ timeout: 10_000 });
  });

  test("export buttons are present in toolbar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "PNG", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Video", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Text", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Citations", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  });

  test("saves and reloads a custom scenario round trip", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(page.getByText("Custom scenario")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved scenario." })).toBeVisible();

    await page.getByRole("tab", { name: "Nuclear" }).click();
    await expect(page.getByRole("tab", { name: "Nuclear" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: /Load \(1\)/ }).click();
    await page.locator(".scenario-saved__load").filter({ hasText: /^Asteroid/ }).click();

    await expect(page.getByRole("tab", { name: "Asteroid" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("status").filter({ hasText: "Loaded scenario." })).toBeVisible();
  });
});
