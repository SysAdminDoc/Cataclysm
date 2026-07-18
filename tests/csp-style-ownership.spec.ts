import { expect, test } from "@playwright/test";

test("keeps runtime inline style attributes inside the Cesium widget", async ({ page }) => {
  await page.addInitScript(() => {
    const fixed = JSON.stringify("2026-07-17T00:00:00.000Z");
    localStorage.setItem("tsunamisim._settings_schema_version", "5");
    localStorage.setItem("tsunamisim.launch_experience_seen_at", fixed);
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", fixed);
    localStorage.setItem("tsunamisim.tour_completed_at", fixed);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", fixed);
  });
  await page.goto("/");
  await expect(page.locator(".cesium-widget canvas")).toBeVisible({ timeout: 15_000 });

  const inventory = await page.locator("[style]").evaluateAll((elements) =>
    elements.map((element) => ({
      tag: element.tagName.toLowerCase(),
      className: element.getAttribute("class") ?? "",
      style: element.getAttribute("style") ?? "",
      ownedByCesium: Boolean(element.closest(".cesium-widget, .cesium-viewer")),
    })),
  );

  expect(inventory.length).toBeGreaterThan(0);
  expect(inventory.filter((entry) => !entry.ownedByCesium)).toEqual([]);
});
