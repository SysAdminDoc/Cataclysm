import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const THEMES = ["mocha", "latte"] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const AXE_EXCLUDE = [".cesium-widget", ".cesium-viewer-toolbar"];

async function seedWorkspace(page: Page, theme: (typeof THEMES)[number]) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((selectedTheme) => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim._settings_schema_version", "5");
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

    test("desktop density keeps operational text legible and surfaces flat", async ({ page }) => {
      await openWorkspace(page);

      const selectors = [
        ".quick-start__grid strong",
        ".quick-start__grid small",
        ".preset-search input",
        ".preset-card__name",
        ".preset-card__blurb",
        ".inspector__tabs button",
      ];
      const typeSizes = await page.evaluate((targets) => Object.fromEntries(
        targets.map((selector) => {
          const element = document.querySelector(selector);
          return [selector, element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0];
        }),
      ), selectors);
      for (const selector of selectors) {
        expect(typeSizes[selector], selector).toBeGreaterThanOrEqual(12);
      }

      const flatBoundaries = await page.evaluate(() => {
        const borderWidths = (selector: string) => {
          const style = getComputedStyle(document.querySelector(selector)!);
          return {
            bottom: Number.parseFloat(style.borderBottomWidth),
            left: Number.parseFloat(style.borderLeftWidth),
            right: Number.parseFloat(style.borderRightWidth),
            top: Number.parseFloat(style.borderTopWidth),
          };
        };
        return {
          badge: borderWidths(".section__badge"),
          card: borderWidths('.preset-card[data-active="true"]'),
          quickStart: borderWidths(".quick-start"),
        };
      });
      expect(Math.max(...Object.values(flatBoundaries.quickStart))).toBe(0);
      expect(Math.max(...Object.values(flatBoundaries.badge))).toBe(0);
      expect(flatBoundaries.card.top).toBe(0);
      expect(flatBoundaries.card.right).toBe(0);
      expect(flatBoundaries.card.left).toBeGreaterThanOrEqual(3);

      const scenarioHeading = page.locator(".preset-library__identity strong");
      await expect(scenarioHeading).toHaveText("Scenarios");
      const headingIsClipped = await scenarioHeading.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      );
      expect(headingIsClipped).toBe(false);
    });

    test("results state", async ({ page }) => {
      await openWorkspace(page);
      await page.getByRole("button", { name: "Run & Watch" }).click();
      await expect(page.getByText("What happened?")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("#inspector-panel")).toBeVisible();
      for (const detail of ["Outcome", "Science", "Validation"]) {
        await page.getByRole("tab", { name: detail }).click();
        await expect(page.getByRole("tabpanel", { name: detail })).toBeVisible();
        if (detail === "Outcome") {
          const trust = page.getByRole("tabpanel", { name: "Outcome" }).locator(".trust-disclosure").first();
          await trust.locator("summary").click();
          await expect(trust.getByText("Evidence ID")).toBeVisible();
          await expect(trust.getByRole("region", { name: "Key assumptions" })).toBeVisible();
          await expect(trust.getByRole("region", { name: "Limitations" })).toBeVisible();
          await expect(trust.getByRole("region", { name: "Citations" })).toBeVisible();
        }
        if (detail === "Science") {
          const summary = page.locator(".chart-data__summary", { hasText: "Modeled decay spans" });
          await expect(summary).toHaveAttribute("aria-live", "off");
          await expect(page.getByRole("img", { name: /Modeled wave amplitude decay/ })).toHaveAttribute(
            "aria-describedby",
            await summary.getAttribute("id") ?? "missing-summary",
          );
          await page.getByText(/View wave attenuation data/).click();
          const table = page.getByRole("region", { name: "wave attenuation data table" });
          await table.focus();
          await expect(table).toBeFocused();
          await expect(table.getByRole("columnheader", { name: "Provenance" })).toBeVisible();
          await expect(page.getByRole("button", { name: "Copy wave attenuation CSV" })).toBeVisible();
        }
        if (detail === "Validation") {
          const firstBuoy = page.locator(".dart__buoy").first();
          const summary = firstBuoy.locator(".chart-data__summary");
          await expect(summary).toHaveAttribute("aria-live", "off");
          await firstBuoy.locator("summary").click();
          const table = firstBuoy.getByRole("region", { name: /DART comparison data table/ });
          await expect(table.getByRole("rowheader", { name: "Observed DART water level" }).first()).toBeVisible();
          await expect(table.getByRole("columnheader", { name: "Confidence" })).toBeVisible();
        }
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
      const trust = page.getByLabel("Why trust this? SWE water-field layer");
      await trust.click();
      await expect(page.getByText("layer:preset:tohoku_2011:swe-field")).toBeVisible();
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

    test("custom numeric fields expose exact, coarse, help, and bound semantics", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /Create my own/i }).click();
      const form = page.locator(".scenario-form");
      for (const [tab, count] of [["Asteroid", 7], ["Nuclear", 5], ["Earthquake", 11], ["Landslide", 8]] as const) {
        await page.getByRole("tab", { name: tab }).click();
        await expect(form.getByRole("spinbutton")).toHaveCount(count);
        await expect(form.locator(".scenario-field label input, .scenario-field label button, .scenario-field label select")).toHaveCount(0);
        const firstExact = form.getByRole("spinbutton").first();
        await expect(firstExact).toHaveAccessibleName(/exact value$/);
        await expect(firstExact).toHaveAttribute("aria-describedby", /-bounds/);
        const firstHelp = form.getByRole("button", { name: /^About / }).first();
        await firstHelp.focus();
        await page.keyboard.press("Enter");
        await expect(firstHelp).toHaveAttribute("aria-expanded", "true");
        await assertAccessiblePage(page);
      }
    });

    for (const hazard of ["Impact", "Nuclear"] as const) {
      test(`${hazard.toLowerCase()} workspace`, async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: hazard, exact: true }).click();
        const workspace = page.getByRole("complementary", { name: "Direct effects workspace" });
        await expect(workspace).toBeVisible();
        const hazardForm = page.locator(".hazard");
        const fieldLabel = hazard === "Impact" ? "Diameter" : "Yield";
        const exact = hazardForm.getByRole("spinbutton", { name: `${fieldLabel} exact value` });
        const coarse = hazardForm.getByRole("slider", { name: `${fieldLabel} quick adjust` });
        await expect(exact).toHaveAttribute("aria-describedby", /-bounds.*-unit/);
        await expect(coarse).toHaveAttribute("aria-valuetext", /.+/);
        const invalid = Number(await exact.getAttribute("max")) + 1;
        await exact.fill(String(invalid));
        await exact.press("Tab");
        await expect(exact).toHaveValue(String(invalid));
        await expect(exact).toHaveAttribute("aria-invalid", "true");
        await expect(hazardForm.getByRole("alert")).toContainText(`${fieldLabel} must be between`);
        await assertAccessiblePage(page);
        await exact.fill(String(await exact.getAttribute("min")));
        await exact.press("Enter");
        await expect(exact).toHaveAttribute("aria-invalid", "false");
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
    await expect(errorToast).toHaveAttribute("role", "alert");
    await expect(errorToast).toHaveAttribute("aria-live", "assertive");
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
