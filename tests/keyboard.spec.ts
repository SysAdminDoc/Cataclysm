import { test, expect } from "@playwright/test";

// Keyboard-only walkthrough of the golden path: pick a preset, run the
// solver, scrub the timeline, export. No pointer events — every action is
// focus + Enter/Space/Arrow. Complements the axe scans in smoke.spec.ts,
// which check static WCAG semantics but not keyboard operability.

async function seedAcknowledgedPreview(page: { addInitScript: (script: () => void) => Promise<void> }) {
  await page.addInitScript(() => {
    const now = JSON.stringify(new Date().toISOString());
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

  test("preset → run solver → scrub → export without pointer events", async ({ page }) => {
    await page.goto("/");

    // 1. Activate the Chicxulub preset card from the keyboard.
    const chicxulub = page.locator('.preset-card:has-text("Chicxulub")');
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".results").filter({ hasText: "Energy" })).toBeVisible({ timeout: 10_000 });

    // 2. Run the SWE solver (browser preview computes demo frames instantly).
    const run = page.getByRole("button", { name: /Run solver/ });
    await expect(run).toBeVisible({ timeout: 10_000 });
    await run.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Frame \d+\/\d+/)).toBeVisible({ timeout: 20_000 });

    // 3. Scrub the timeline with arrow keys.
    const scrubber = page.getByRole("slider", { name: "Simulation timeline scrubber" });
    await scrubber.focus();
    const before = await scrubber.inputValue();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const after = await scrubber.inputValue();
    expect(Number(after)).not.toBe(Number(before));

    // 4. Export the text report from the keyboard.
    const exportMenu = page.getByRole("button", { name: "Export", exact: true });
    await exportMenu.focus();
    await page.keyboard.press("Enter");
    const textExport = page.getByRole("button", { name: "Text", exact: true });
    await textExport.focus();
    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
    await page.keyboard.press("Enter");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("tsunamisim");
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
});
