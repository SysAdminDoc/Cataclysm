import { test, expect, type Page } from "@playwright/test";

// Keyboard-only walkthrough of the golden path: pick a preset, run the
// solver, scrub the timeline, export. No pointer events — every action is
// focus + Enter/Space/Arrow. Complements the axe scans in smoke.spec.ts,
// which check static WCAG semantics but not keyboard operability.

async function seedAcknowledgedPreview(page: Page) {
  await page.addInitScript(() => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim._settings_schema_version", "5");
    localStorage.setItem("tsunamisim.launch_experience_seen_at", now);
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
    localStorage.setItem("tsunamisim.tour_completed_at", now);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
    localStorage.removeItem("tsunamisim.saved_scenarios");
  });
}

test.describe("Keyboard-only golden path", () => {
  test.beforeEach(async ({ page }) => {
    await seedAcknowledgedPreview(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("preset → Run & Watch → scrub → export without pointer events", async ({ page }) => {
    await page.goto("/");

    // 1. Activate the Chicxulub preset card from the keyboard.
    const chicxulub = page.locator(".preset-card").filter({
      has: page.getByText("Chicxulub Impact", { exact: true }),
    });
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.focus();
    await page.keyboard.press("Enter");
    const run = page.getByRole("button", { name: "Run & Watch" });
    await expect(run).toBeVisible({ timeout: 10_000 });
    await run.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status", { name: "Run and Watch: Understand" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".simulation-transport__frame")).toContainText("60");
    await expect(page.getByRole("slider", { name: "Simulation timeline scrubber" })).toHaveCount(0);

    const resultsTab = page.getByRole("tab", { name: "Results" });
    await resultsTab.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("What happened?")).toBeVisible({ timeout: 10_000 });

    // 2. Scrub the timeline with arrow keys.
    const scrubber = page.getByRole("slider", { name: "Scenario timeline scrubber" });
    await scrubber.focus();
    const before = await scrubber.inputValue();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const after = await scrubber.inputValue();
    expect(Number(after)).not.toBe(Number(before));

    // 3. Export the text report from the keyboard.
    const exportMenu = page.getByRole("button", { name: "Export", exact: true });
    await exportMenu.focus();
    await page.keyboard.press("Enter");
    const textExport = page.getByRole("button", { name: "Text", exact: true });
    await textExport.focus();
    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
    await page.keyboard.press("Enter");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("cataclysm");
  });

  test("modal focus trap: Settings opens, tab stays inside, Escape closes", async ({ page }) => {
    await page.goto("/");
    const settings = page.getByRole("button", { name: "Settings" });
    await settings.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Tab a full loop — focus must remain inside the dialog.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
      expect(inside).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("guided story remains keyboard-operable while the globe and controls stay available", async ({ page }) => {
    await page.goto("/");
    const launcher = page.getByRole("button", { name: /Guided training/i });
    await launcher.focus();
    await page.keyboard.press("Enter");
    const lessonItem = page.locator(".lesson-launcher__item").first();
    await lessonItem.focus();
    await page.keyboard.press("Enter");

    const lesson = page.locator(".lesson-card");
    await expect(lesson).toBeVisible();
    await expect(lesson.getByRole("button", { name: "Follow story" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tab", { name: "Setup" })).toHaveAttribute("data-story-highlight", "true");

    const next = lesson.getByRole("button", { name: "Next" });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(lesson.getByRole("heading", { name: "Propagation: what to watch" })).toBeVisible();
    await expect(page.locator(".section.swe")).toHaveAttribute("data-story-highlight", "true", { timeout: 15_000 });

    const explore = lesson.getByRole("button", { name: "Explore freely" });
    await explore.focus();
    await page.keyboard.press("Enter");
    await expect(explore).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-story-highlight='true']")).toHaveCount(0);

    await page.locator("#main-globe").focus();
    await expect(page.locator("#main-globe")).toBeFocused();
    await expect(lesson).toBeVisible();

    const skip = lesson.getByRole("button", { name: "Skip" });
    await skip.focus();
    await page.keyboard.press("Enter");
    await expect(lesson).toHaveCount(0);

    await lessonItem.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".lesson-card").getByRole("heading", { name: "Propagation: what to watch" })).toBeVisible();
    await expect(page.locator(".lesson-card").getByRole("button", { name: "Explore freely" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator(".lesson-card")).toHaveCount(0);
  });

  test("export popover restores focus after Escape and action selection", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Export", exact: true });
    await trigger.click();
    await expect(page.locator(".app__export-panel")).toBeVisible();
    await expect(page.locator(".app__export-panel")).toBeFocused();
    await expect(page.getByRole("region", { name: "Image" })).toContainText("Capture the current analytical view");
    await expect(page.getByRole("region", { name: "Replay" })).toContainText("Record the visible timeline");
    await expect(page.getByRole("region", { name: "Share" })).toContainText("reproducible scenario link");
    await expect(page.getByRole("region", { name: "Data" })).toContainText("interoperable GIS or Cesium files");
    await expect(page.locator(".icon-button__reason").first()).toContainText("Requires:");

    await page.keyboard.press("Escape");

    await expect(page.locator(".app__export-panel")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByRole("button", { name: /^PNG/ }).dispatchEvent("click");
    await expect(page.locator(".app__export-panel")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    const infoToast = page.locator('.app-toast[data-tone="info"]');
    await expect(infoToast).toHaveAttribute("role", "status");
    await expect(infoToast).toHaveAttribute("aria-live", "polite");
  });

  test("scenario and inspector tabs use roving focus with arrow, Home, and End keys", async ({ page }) => {
    await seedAcknowledgedPreview(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Create my own/i }).click();

    const scenarioTabs = page.locator(".scenario-tabs");
    const asteroid = scenarioTabs.getByRole("tab", { name: "Asteroid" });
    const nuclear = scenarioTabs.getByRole("tab", { name: "Nuclear" });
    const meteotsunami = scenarioTabs.getByRole("tab", { name: "Meteotsunami" });
    await asteroid.focus();
    await expect(asteroid).toHaveAttribute("tabindex", "0");
    await asteroid.press("ArrowRight");
    await expect(nuclear).toBeFocused();
    await expect(nuclear).toHaveAttribute("aria-selected", "true");
    await nuclear.press("End");
    await expect(meteotsunami).toBeFocused();
    await expect(meteotsunami).toHaveAttribute("aria-selected", "true");
    await meteotsunami.press("Home");
    await expect(asteroid).toBeFocused();
    await expect(asteroid).toHaveAttribute("aria-selected", "true");

    const inspector = page.locator(".inspector__tabs");
    const setup = inspector.getByRole("tab", { name: "Setup" });
    const results = inspector.getByRole("tab", { name: "Results" });
    const layers = inspector.getByRole("tab", { name: "Layers" });
    await setup.focus();
    await setup.press("ArrowRight");
    await expect(results).toBeFocused();
    await expect(results).toHaveAttribute("aria-selected", "true");
    await results.press("End");
    await expect(layers).toBeFocused();
    await expect(layers).toHaveAttribute("aria-selected", "true");
    await layers.press("Home");
    await expect(setup).toBeFocused();
    await expect(setup).toHaveAttribute("aria-selected", "true");
  });
});
