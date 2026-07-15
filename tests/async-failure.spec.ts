import { expect, test } from "@playwright/test";

test("saved-scenario storage failure is distinct from empty and retryable", async ({ page }) => {
  await page.addInitScript(() => {
    const fixed = JSON.stringify("2026-07-14T12:00:00.000Z");
    localStorage.setItem("tsunamisim._settings_schema_version", "4");
    localStorage.setItem("tsunamisim.launch_experience_seen_at", fixed);
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", fixed);
    localStorage.setItem("tsunamisim.tour_completed_at", fixed);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", fixed);
    localStorage.setItem("tsunamisim.globe_style", JSON.stringify("natural-earth-2"));
    localStorage.setItem("tsunamisim.saved_scenarios", "{");
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Create my own/i }).click();
  await expect(page.getByText("Custom scenario", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByRole("alert")).toContainText("Saved scenario storage is unavailable");

  await page.evaluate(() => {
    localStorage.removeItem("tsunamisim.saved_scenarios");
  });
  await page.getByRole("button", { name: "Retry saved scenarios" }).click();
  await expect(page.getByText("No saved scenarios yet.")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
