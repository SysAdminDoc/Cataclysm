import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const THEMES = ["mocha", "latte"] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const AXE_EXCLUDE = [".cesium-widget", ".cesium-viewer-toolbar"];

async function seedWorkspace(page: Page, theme: (typeof THEMES)[number]) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((selectedTheme) => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim._settings_schema_version", "1");
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
    localStorage.setItem("tsunamisim.tour_completed_at", now);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
    localStorage.setItem("tsunamisim.theme", JSON.stringify(selectedTheme));
    localStorage.setItem("tsunamisim.globe_style", JSON.stringify("natural-earth-2"));
    localStorage.removeItem("tsunamisim.saved_scenarios");
  }, theme);
}

async function assertWcagAa(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of AXE_EXCLUDE) builder = builder.exclude(selector);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  expect(violations).toEqual([]);
}

async function assertUniqueIds(page: Page) {
  const duplicates = await page.locator("[id]").evaluateAll((nodes) => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      const id = node.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1);
  });
  expect(duplicates).toEqual([]);
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  const tohoku = page.locator('.preset-card:has-text("Tohoku")');
  await expect(tohoku).toBeVisible({ timeout: 10_000 });
  await tohoku.click();
  await expect(tohoku).toHaveAttribute("aria-pressed", "true");
  return tohoku;
}

async function assertAccessiblePage(page: Page) {
  await assertWcagAa(page);
  await assertUniqueIds(page);
}

for (const theme of THEMES) {
  test.describe(`WCAG AA desktop — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await seedWorkspace(page, theme);
    });

    test("setup, selected, and hover states", async ({ page }) => {
      const activePreset = await openWorkspace(page);
      await activePreset.hover();
      await assertAccessiblePage(page);
    });

    test("results state", async ({ page }) => {
      await openWorkspace(page);
      await page.getByRole("tab", { name: "Results" }).click();
      await expect(page.locator("#inspector-panel")).toBeVisible();
      await assertAccessiblePage(page);
    });

    test("layers state", async ({ page }) => {
      await openWorkspace(page);
      await page.getByRole("tab", { name: "Layers" }).click();
      await expect(page.getByText("SWE water field")).toBeVisible();
      await assertAccessiblePage(page);
    });

    test("comparison workspace", async ({ page }) => {
      await openWorkspace(page);
      const compare = page.getByRole("button", { name: "Compare", exact: true });
      await compare.click();
      await compare.focus();
      await expect(page.locator(".app")).toHaveAttribute("data-compare", "true");
      await page.getByLabel("Compare against").selectOption("chicxulub");
      await assertAccessiblePage(page);
    });

    for (const hazard of ["Impact", "Nuclear"] as const) {
      test(`${hazard.toLowerCase()} workspace`, async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: hazard, exact: true }).click();
        const workspace = page.getByRole("complementary", { name: "Direct effects workspace" });
        await expect(workspace).toBeVisible();
        await page.locator(".hazard").getByRole("button", { name: /pick location on globe/i }).click();
        const coordinates = page.getByRole("form", { name: "Enter coordinates" });
        await expect(coordinates.getByRole("button", { name: "Go" })).toBeDisabled();
        await expect(coordinates.getByText("Enter both latitude and longitude.")).toBeVisible();
        await coordinates.getByLabel("Latitude").fill("35.68");
        await coordinates.getByLabel("Longitude").fill("139.76");
        await coordinates.getByRole("button", { name: "Go" }).click();
        await page.getByRole("tab", { name: "Results" }).click();
        await expect(page.getByText(/direct hazard physics requires the desktop app/i)).toBeVisible();
        await expect(page.locator(".hazard__results")).toHaveCount(0);
        await assertAccessiblePage(page);
      });
    }

    test("settings over the active workspace", async ({ page }) => {
      await openWorkspace(page);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await assertAccessiblePage(page);
      await assertWcagAa(page, ".modal--settings");
    });

    test("offline recovery state", async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "onLine", {
          configurable: true,
          get: () => false,
        });
        localStorage.setItem("tsunamisim.globe_style", JSON.stringify("esri-world-imagery"));
      });
      await page.goto("/");
      await expect(page.locator(".app__globe-mount")).toHaveAttribute("data-imagery-status", "fallback", { timeout: 15_000 });
      await assertAccessiblePage(page);
    });
  });
}
