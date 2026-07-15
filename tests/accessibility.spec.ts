import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const THEMES = ["mocha", "latte"] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const AXE_EXCLUDE = [".cesium-widget", ".cesium-viewer-toolbar"];

async function seedWorkspace(page: Page, theme: (typeof THEMES)[number]) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((selectedTheme) => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim._settings_schema_version", "3");
    localStorage.setItem("tsunamisim.launch_experience_seen_at", now);
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

async function expectVisibleBoundary(page: Page, selector: string) {
  const boundary = await page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        bottom: Number.parseFloat(style.borderBottomWidth),
        left: Number.parseFloat(style.borderLeftWidth),
        right: Number.parseFloat(style.borderRightWidth),
        top: Number.parseFloat(style.borderTopWidth),
      };
    });
  expect(
    Math.max(boundary.top, boundary.right, boundary.bottom, boundary.left),
    selector,
  ).toBeGreaterThanOrEqual(1);
}

for (const theme of THEMES) {
  test.describe(`WCAG AA desktop — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await seedWorkspace(page, theme);
    });

    test("setup, selected, and hover states", async ({ page }) => {
      const activePreset = await openWorkspace(page);
      await activePreset.hover();
      const globe = page.getByRole("region", { name: /Tohoku.*analytical globe/i }).first();
      await expect(globe).toHaveAttribute("aria-describedby", /.+/);
      const summaryId = await globe.getAttribute("aria-describedby");
      const sceneSummary = page.locator(`[id="${summaryId}"]`);
      await expect(sceneSummary).toContainText("Scenario time T plus 15 minutes");
      await expect(sceneSummary).toContainText("Visible analytical layers:");
      await expect(sceneSummary).toContainText(/Camera centered at|Camera position is not available/);
      await expect(page.locator("[data-globe-scene-announcement]").first()).not.toBeEmpty();
      await assertAccessiblePage(page);
    });

    test("results state", async ({ page }) => {
      await openWorkspace(page);
      await page.getByRole("button", { name: "Run & Watch" }).click();
      await expect(page.getByText("What happened?")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("#inspector-panel")).toBeVisible();
      for (const detail of ["Outcome", "Science", "Validation"]) {
        await page.getByRole("tab", { name: detail }).click();
        await expect(page.getByRole("tabpanel", { name: detail })).toBeVisible();
        await assertAccessiblePage(page);
      }
      await page.getByRole("button", { name: "Inspect", exact: true }).click();
      const coordinates = page.getByRole("form", { name: "Enter coordinates" });
      await coordinates.getByLabel("Latitude").fill("35.68");
      await coordinates.getByLabel("Longitude").fill("139.76");
      await coordinates.getByRole("button", { name: "Go" }).click();
      await expect(page.locator("[data-globe-scene-summary]").first()).toContainText(
        "Inspected point",
        { timeout: 10_000 },
      );
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
      await expect(page.locator("[data-globe-scene-summary]").first()).toContainText(
        "Renderer imagery is fallback",
      );
      await assertAccessiblePage(page);
    });
  });
}

test.describe("Windows forced colors", () => {
  test.beforeEach(async ({ page }) => {
    await seedWorkspace(page, "mocha");
    await page.emulateMedia({ forcedColors: "active" });
  });

  test("preserves error boundaries without opting out of system colors", async ({
    page,
  }) => {
    await page.goto("/?preset=missing-forced-colors-fixture");
    const errorToast = page.locator('.app-toast[data-tone="error"]');
    await expect(errorToast).toContainText("Scenario link not found", {
      timeout: 10_000,
    });
    await expectVisibleBoundary(page, '.app-toast[data-tone="error"]');
    await expect(errorToast).toHaveCSS("forced-color-adjust", "auto");
    await assertAccessiblePage(page);
  });

  test("preserves workspace boundaries, states, legends, focus, and dialogs", async ({
    page,
  }) => {
    const activePreset = await openWorkspace(page);
    await expectVisibleBoundary(page, ".app__header");
    await expectVisibleBoundary(page, ".app__command-group");
    await expectVisibleBoundary(page, ".app__panel");
    await expectVisibleBoundary(page, ".app__panel--right");
    await expectVisibleBoundary(page, ".simulation-transport");
    await expectVisibleBoundary(page, ".preset-card");

    await activePreset.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(activePreset).toBeFocused();
    const focusStyle = await activePreset.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        colorAdjust: style.forcedColorAdjust,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(focusStyle.colorAdjust).toBe("auto");
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);

    const viewportLegend = page.locator(".app__viewport-legend");
    await expect(viewportLegend).toBeVisible();
    await expect(viewportLegend).toContainText("Surface displacement");
    expect(
      await viewportLegend.locator(".app__viewport-legend-scale span").count(),
    ).toBeGreaterThanOrEqual(3);
    await expect(
      viewportLegend.locator(".app__viewport-legend-ramp"),
    ).toHaveCSS("border-top-style", "solid");
    await expect(
      viewportLegend.locator(".app__viewport-legend-ramp"),
    ).toHaveCSS("forced-color-adjust", "none");

    const modelStatus = page.locator(".statusbar__item--ready");
    await expect(modelStatus).toContainText(/awaiting source/i);
    const statusDot = modelStatus.locator(".status-dot");
    await expect(statusDot).toHaveCSS("border-top-style", "solid");
    expect(
      await statusDot.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).borderTopWidth),
      ),
    ).toBeGreaterThanOrEqual(2);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expectVisibleBoundary(page, ".modal--settings");
    await assertAccessiblePage(page);
    await assertWcagAa(page, ".modal--settings");

    const globalAdjustments = await page
      .locator("html, body, #root, .app")
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).forcedColorAdjust),
      );
    expect(globalAdjustments).not.toContain("none");
  });
});
