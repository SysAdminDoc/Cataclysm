import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim._settings_schema_version", "5");
    localStorage.setItem("tsunamisim.launch_experience_seen_at", now);
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
    localStorage.setItem("tsunamisim.tour_completed_at", now);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
    localStorage.setItem("tsunamisim.locale", JSON.stringify("en"));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("language switch persists across settings, simulation results, layers, and lessons", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const language = page.getByRole("combobox", { name: "Interface language" });
  await expect(language).toBeVisible();
  await language.selectOption("ja");
  await page.getByRole("button", { name: "Apply Changes" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("combobox", { name: "表示言語" })).toHaveValue("ja");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tsunamisim.locale") ?? "null"))).toBe("ja");
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
  await expect(page.getByRole("button", { name: "地球表示と外観" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Esri World Imagery（衛星、トークン不要）" })).toBeAttached();
  const settingsBounds = await page.locator(".modal--settings").boundingBox();
  expect(settingsBounds).not.toBeNull();
  expect(await page.screenshot({
    clip: settingsBounds!,
    style: ".settings__footer-message { visibility: hidden !important; }",
  })).toMatchSnapshot("localized-settings-ja.png");
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();

  await expect(page.locator(".app__tagline")).toHaveText("惑星災害シミュレーター");
  const hazardModes = page.getByRole("group", { name: "災害種別" });
  await expect(hazardModes.getByRole("button", { name: "津波" })).toBeVisible();
  await expect(hazardModes.getByRole("button", { name: "衝突" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "設定" })).toBeVisible();
  await expect(page.getByRole("button", { name: "表示レイヤーを開く" })).toBeVisible();
  await expect(page.getByText("クイックスタート", { exact: true })).toBeVisible();
  await expect(page.locator(".simulation-transport")).toContainText("シナリオ時刻");
  const headerBounds = await page.locator(".app__header").boundingBox();
  expect(headerBounds).not.toBeNull();
  expect(await page.screenshot({ clip: headerBounds! })).toMatchSnapshot("localized-header-ja.png");

  const tohoku = page.locator('.preset-card:has-text("Tohoku")').first();
  await expect(tohoku).toBeVisible();
  await tohoku.click();
  await expect(page.locator(".source-model")).toContainText("発生源モデル");
  await page.getByRole("button", { name: "実行して見る" }).click();
  await page.getByRole("tab", { name: "設定", exact: true }).click();
  await expect(page.locator(".source-model")).toContainText("Okada断層変位モデル");
  await page.getByRole("group", { name: "表示の詳細度" }).getByRole("button", { name: "詳細", exact: true }).click();
  await expect(page.locator(".swe")).toContainText("波動伝播");
  await expect(page.getByLabel("1度あたりの格子セル数")).toBeAttached();
  const inspector = page.locator(".app__panel--right");
  let inspectorBounds = await inspector.boundingBox();
  expect(inspectorBounds).not.toBeNull();
  expect(await page.screenshot({ clip: inspectorBounds! })).toMatchSnapshot("localized-setup-ja.png");
  const setupAccessibility = await new AxeBuilder({ page }).include(".app__panel--right").analyze();
  expect(setupAccessibility.violations).toEqual([]);
  await inspector.evaluate((panel) => { panel.scrollTop = 0; });
  inspectorBounds = await inspector.boundingBox();
  expect(inspectorBounds).not.toBeNull();
  expect(await page.screenshot({
    clip: inspectorBounds!,
    style: ".inspector__header, .journey-progress, .source-model, .swe__readout { display: none !important; }",
  })).toMatchSnapshot("localized-swe-ja.png");

  await page.getByRole("tab", { name: "結果", exact: true }).click();
  await inspector.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.getByRole("tab", { name: "影響" })).toBeVisible();
  await expect(page.getByText("何が起きたか", { exact: true })).toBeVisible();
  await expect(page.getByText("沿岸スクリーニング検証", { exact: true })).not.toBeVisible();
  inspectorBounds = await inspector.boundingBox();
  expect(inspectorBounds).not.toBeNull();
  expect(await page.screenshot({ clip: inspectorBounds! })).toMatchSnapshot("localized-results-ja.png");
  const resultsAccessibility = await new AxeBuilder({ page }).include(".app__panel--right").analyze();
  expect(resultsAccessibility.violations).toEqual([]);

  await page.getByRole("tab", { name: "レイヤー", exact: true }).click();
  await inspector.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.getByText("可視化レイヤー", { exact: true })).toBeVisible();
  await expect(page.getByText("解析的波面", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "OpenStreetMapの人道支援施設を表示" })).toBeVisible();
  inspectorBounds = await inspector.boundingBox();
  expect(inspectorBounds).not.toBeNull();
  expect(await page.screenshot({ clip: inspectorBounds! })).toMatchSnapshot("localized-layers-ja.png");
  const layersAccessibility = await new AxeBuilder({ page }).include(".app__panel--right").analyze();
  expect(layersAccessibility.violations).toEqual([]);

  await page.getByRole("button", { name: /ガイド付き学習/ }).click();
  await expect(page.locator(".lesson-launcher__item")).toHaveCount(7);
  await expect(page.locator(".lesson-launcher__item").first()).toContainText("チクシュルーブ");
  await page.locator(".lesson-launcher__item").first().click();

  const lesson = page.locator(".lesson-card");
  await expect(lesson.getByRole("heading", { name: "チクシュルーブ：大量絶滅を引き起こした津波" })).toBeVisible();
  await expect(lesson.getByRole("heading", { name: "発生源：なぜ重要か" })).toBeVisible();
  await expect(lesson.getByRole("button", { name: "次へ" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include(".lesson-card").analyze();
  expect(accessibility.violations).toEqual([]);
  const bounds = await lesson.boundingBox();
  expect(bounds).not.toBeNull();
  expect(await page.screenshot({ clip: bounds! })).toMatchSnapshot("localized-guided-lesson-ja.png");
});
