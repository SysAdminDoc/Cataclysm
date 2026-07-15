import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const THEMES = ["mocha", "latte"] as const;
const DESKTOP = { width: 1440, height: 900 };
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const AXE_EXCLUDE = [".cesium-widget", ".cesium-viewer-toolbar"];
const CANVAS_MASK = ".cesium-widget canvas";

type Theme = (typeof THEMES)[number];

async function seedWorkspace(page: Page, theme: Theme, { crash = false } = {}) {
  await page.setViewportSize(DESKTOP);
  await page.addInitScript(({ selectedTheme, includeCrash }) => {
    const fixed = JSON.stringify("2026-07-14T12:00:00.000Z");
    localStorage.setItem("tsunamisim._settings_schema_version", "3");
    localStorage.setItem("tsunamisim.launch_experience_seen_at", fixed);
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", fixed);
    localStorage.setItem("tsunamisim.tour_completed_at", fixed);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", fixed);
    localStorage.setItem("tsunamisim.theme", JSON.stringify(selectedTheme));
    localStorage.setItem("tsunamisim.globe_style", JSON.stringify("natural-earth-2"));
    localStorage.removeItem("tsunamisim.saved_scenarios");
    if (includeCrash) {
      localStorage.setItem("tsunamisim.last_crash", JSON.stringify({
        at: Date.parse("2026-07-14T12:00:00.000Z"),
        source: "unhandled-rejection",
        name: "Error",
        message: "Redacted deterministic recovery fixture",
        componentStack: null,
        recentLogs: [],
        seen: false,
      }));
    } else {
      localStorage.removeItem("tsunamisim.last_crash");
    }
  }, { selectedTheme: theme, includeCrash: crash });
}

async function assertWcagAa(page: Page) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of AXE_EXCLUDE) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  expect(violations).toEqual([]);
}

async function captureState(page: Page, theme: Theme, state: string) {
  await assertWcagAa(page);
  const canvasHider = await page.addStyleTag({
    content: `${CANVAS_MASK} { visibility: hidden !important; }`,
  });
  try {
    await expect(page).toHaveScreenshot(`state-${theme}-${state}.png`, {
      maxDiffPixelRatio: 0.01,
      timeout: 15_000,
    });
  } finally {
    await canvasHider.evaluate((element) => element.remove());
  }
}

async function openPreset(page: Page, name = "Tohoku") {
  const preset = page.locator(".preset-card", { hasText: name }).first();
  await expect(preset).toBeVisible({ timeout: 10_000 });
  await preset.click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  return preset;
}

async function assertReflow(page: Page, viewportWidth: number) {
  const reflow = await page.locator("button, input, select, textarea, [role='tab'], [role='slider'], [role='spinbutton']")
    .evaluateAll((controls, expectedWidth) => {
      const offenders = controls.flatMap((control) => {
        const style = getComputedStyle(control);
        const box = control.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || box.width === 0 || box.height === 0) {
          return [];
        }
        if (box.left >= -1 && box.right <= expectedWidth + 1) return [];
        return [{
          label: control.getAttribute("aria-label") ?? control.textContent?.trim() ?? control.tagName,
          left: box.left,
          right: box.right,
        }];
      });
      return {
        offenders,
        overflow: {
          body: document.body.scrollWidth - document.body.clientWidth,
          root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scrollX: window.scrollX,
        },
      };
    }, viewportWidth);
  expect(reflow.offenders).toEqual([]);
  const overflow = reflow.overflow;
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.root).toBeLessThanOrEqual(1);
  expect(overflow.scrollX).toBe(0);
}

for (const theme of THEMES) {
  test.describe(`deterministic state matrix — ${theme}`, () => {
    test("empty workspace", async ({ page }) => {
      await seedWorkspace(page, theme);
      await page.goto("/");
      await expect(page.locator(".app__globe-hint")).toContainText("Ready for a source", {
        timeout: 15_000,
      });
      await captureState(page, theme, "empty");
    });

    test("loading workspace", async ({ page }) => {
      await seedWorkspace(page, theme);
      let releaseChunk = () => {};
      const chunkGate = new Promise<void>((resolve) => {
        releaseChunk = resolve;
      });
      await page.route(/\/assets\/Globe-.*\.js$/, async (route) => {
        await chunkGate;
        await route.continue();
      });
      try {
        await page.goto("/");
        await expect(page.getByText("Preparing globe", { exact: true })).toBeVisible({
          timeout: 10_000,
        });
        await captureState(page, theme, "loading");
      } finally {
        releaseChunk();
      }
    });

    test("error and recovery workspace", async ({ page }) => {
      await seedWorkspace(page, theme, { crash: true });
      await page.goto("/?preset=missing-state-matrix-fixture");
      await expect(page.getByRole("alert")).toContainText("Scenario link not found", {
        timeout: 10_000,
      });
      await expect(page.getByRole("status").filter({ hasText: "previous failure" })).toBeVisible();
      await captureState(page, theme, "error-recovery");
    });

    test("custom builder", async ({ page }) => {
      await seedWorkspace(page, theme);
      await page.goto("/");
      await page.getByRole("button", { name: /Create my own/i }).click();
      await expect(page.getByText("Custom scenario", { exact: true })).toBeVisible();
      await captureState(page, theme, "custom-builder");
    });

    test("comparison workspace", async ({ page }) => {
      await seedWorkspace(page, theme);
      await page.goto("/");
      await openPreset(page);
      await page.getByRole("button", { name: "Run & Watch" }).click();
      await expect(page.getByRole("status", { name: "Run and Watch: Understand" })).toBeVisible({
        timeout: 20_000,
      });
      await page.getByRole("button", { name: "Compare", exact: true }).click();
      await page.getByLabel("Compare against").selectOption("chicxulub");
      await expect(page.locator(".app__compare-picker small")).not.toContainText(
        "Loading comparison source",
        { timeout: 20_000 },
      );
      await expect(page.locator(".app__globe-tag", { hasText: "Slot B" })).toBeVisible();
      await captureState(page, theme, "compare");
    });

    test("layers workspace", async ({ page }) => {
      await seedWorkspace(page, theme);
      await page.goto("/");
      await openPreset(page);
      await page.getByRole("tab", { name: "Layers" }).click();
      await expect(page.getByText("SWE water field")).toBeVisible();
      await captureState(page, theme, "layers");
    });

    test("coastal results and semantic chart", async ({ page }) => {
      await seedWorkspace(page, theme);
      await page.goto("/");
      await openPreset(page);
      await page.getByRole("button", { name: "Run & Watch" }).click();
      await expect(page.getByRole("status", { name: "Run and Watch: Understand" })).toBeVisible({
        timeout: 20_000,
      });
      const pause = page.getByRole("button", { name: "Pause scenario timeline" });
      if (await pause.isVisible()) await pause.click();
      await page.getByRole("tab", { name: "Validation" }).click();
      await expect(page.getByText("Coastal screening validation")).toBeVisible();
      const firstBuoy = page.locator(".dart__buoy").first();
      await firstBuoy.locator("summary").click();
      await expect(firstBuoy.getByRole("region", { name: /DART comparison data table/ })).toBeVisible();
      await captureState(page, theme, "coastal-results");
    });

    test("export menu", async ({ page }) => {
      await seedWorkspace(page, theme);
      await page.goto("/");
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByRole("button", { name: /^PNG/ })).toBeVisible();
      await captureState(page, theme, "export");
    });

    test("guided lesson and tour", async ({ page }) => {
      await seedWorkspace(page, theme);
      await page.goto("/");
      await page.getByRole("button", { name: /Guided training/i }).click();
      await page.locator(".lesson-launcher__item").first().click();
      const lesson = page.locator(".lesson-overlay[role='dialog']");
      await expect(lesson).toBeVisible();
      await captureState(page, theme, "lesson");
      await lesson.getByRole("button", { name: "Close lesson" }).click();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("tsunamisim:tour-requested")));
      await expect(page.getByRole("dialog", { name: /Welcome to Cataclysm/i })).toBeVisible();
      await captureState(page, theme, "tour");
    });

    for (const hazard of ["Impact", "Nuclear"] as const) {
      test(`${hazard.toLowerCase()} workspace`, async ({ page }) => {
        await seedWorkspace(page, theme);
        await page.goto("/");
        await page.getByRole("button", { name: hazard, exact: true }).click();
        await expect(page.getByRole("complementary", { name: "Direct effects workspace" })).toBeVisible();
        await captureState(page, theme, hazard.toLowerCase());
      });
    }

    test("forced-colors workspace", async ({ page }) => {
      await seedWorkspace(page, theme);
      await page.emulateMedia({ forcedColors: "active" });
      await page.goto("/");
      await openPreset(page);
      await page.getByRole("tab", { name: "Layers" }).click();
      await captureState(page, theme, "forced-colors");
    });

    test("320 CSS pixel and 200 percent zoom reflow", async ({ page }) => {
      await seedWorkspace(page, theme);
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto("/");
      await page.getByRole("button", { name: /Create my own/i }).click();
      await expect(page.getByText("Custom scenario", { exact: true })).toBeVisible();
      await assertWcagAa(page);
      await assertReflow(page, 320);

      // A 720 px physical viewport at 200% browser zoom exposes 360 CSS px.
      await page.setViewportSize({ width: 360, height: 900 });
      await page.reload();
      await page.getByRole("button", { name: /Create my own/i }).click();
      await expect(page.getByText("Custom scenario", { exact: true })).toBeVisible();
      await assertWcagAa(page);
      await assertReflow(page, 360);
    });
  });
}
