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
  test.setTimeout(150_000);
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
  await page.getByRole("button", { name: "データと初期案内" }).click();
  await expect(page.getByRole("heading", { name: "ローカル科学用海底地形" })).toBeVisible();
  await expect(page.getByText(/読み込みはデスクトップアプリで利用できます/)).toBeVisible();
  const settingsDataAccessibility = await new AxeBuilder({ page }).include(".modal--settings").analyze();
  expect(settingsDataAccessibility.violations).toEqual([]);
  expect(await page.screenshot({
    clip: settingsBounds!,
    style: ".settings__footer-message { visibility: hidden !important; }",
  })).toMatchSnapshot("localized-settings-data-ja.png");
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();

  await expect(page.locator(".app__tagline")).toHaveText("惑星災害シミュレーター");
  const hazardModes = page.getByRole("group", { name: "災害種別" });
  await expect(hazardModes.getByRole("button", { name: "津波" })).toBeVisible();
  await expect(hazardModes.getByRole("button", { name: "衝突" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "設定" })).toBeVisible();
  await expect(page.getByRole("button", { name: "表示レイヤーを開く" })).toBeVisible();
  await expect(page.getByText("クイックスタート", { exact: true })).toBeVisible();
  await expect(page.locator(".simulation-transport")).toContainText("シナリオ時刻");
  await expect(page.getByRole("region", { name: "発生源なしの解析地球儀" })).toBeVisible();
  const globeSummary = page.locator("[data-globe-scene-summary]").first();
  await expect(globeSummary).toContainText("表示中の解析レイヤー");
  await expect(globeSummary).toContainText("緯度と経度を入力できます");
  await expect(globeSummary).not.toContainText(/Camera|Visible analytical|Renderer imagery|Latitude and longitude/);
  await page.getByRole("button", { name: "書き出し", exact: true }).click();
  const exportPanel = page.locator(".app__export-panel");
  await expect(exportPanel).toContainText("現在の解析表示または比較をキャプチャします。");
  await expect(exportPanel).toContainText("アクセシブルな結果と互換GIS・Cesiumファイルを書き出します。");
  await expect(page.getByRole("button", { name: "PNG" })).toHaveAttribute("title", "最初にプリセットを選ぶか、カスタムソースをシミュレートしてください。");
  await page.getByRole("button", { name: "書き出し", exact: true }).click();
  const headerBounds = await page.locator(".app__header").boundingBox();
  expect(headerBounds).not.toBeNull();
  expect(await page.screenshot({ clip: headerBounds! })).toMatchSnapshot("localized-header-ja.png");

  await hazardModes.getByRole("button", { name: "衝突" }).click();
  const directHazard = page.locator(".hazard");
  await expect(directHazard.getByText("小惑星衝突", { exact: true })).toBeVisible();
  await expect(directHazard.getByRole("spinbutton", { name: "直径 正確な値" })).toBeVisible();
  await expect(directHazard.getByRole("combobox", { name: "衝突対象" })).toBeVisible();
  await expect(directHazard.getByRole("button", { name: "地球上で場所を選択" })).toBeVisible();
  const hazardAccessibility = await new AxeBuilder({ page }).include(".hazard").analyze();
  expect(hazardAccessibility.violations).toEqual([]);
  const hazardInspectorBounds = await page.locator(".app__panel--right").boundingBox();
  expect(hazardInspectorBounds).not.toBeNull();
  expect(await page.screenshot({ clip: hazardInspectorBounds! })).toMatchSnapshot("localized-hazard-ja.png");

  await hazardModes.getByRole("button", { name: "核" }).click();
  const mirv = page.locator(".mirv");
  await expect(mirv.getByText("MIRVパターンプレビュー")).toBeVisible();
  await mirv.getByRole("combobox", { name: "搭載量プリセット" }).selectOption("trident-ii-w76");
  await expect(mirv.getByText("効果原点を選択してパターンを配置してください。")).toBeVisible();
  await mirv.scrollIntoViewIfNeeded();
  expect(await mirv.screenshot()).toMatchSnapshot("localized-mirv-ja.png");
  const mirvAccessibility = await new AxeBuilder({ page }).include(".mirv").analyze();
  expect(mirvAccessibility.violations).toEqual([]);

  const ww3 = page.locator(".ww3");
  await ww3.scrollIntoViewIfNeeded();
  await expect(ww3.getByText("世界規模交換ラボ")).toBeVisible();
  await expect(ww3.getByText("世界熱核戦争", { exact: true }).last()).toBeVisible();
  expect(await ww3.screenshot()).toMatchSnapshot("localized-ww3-ja.png");
  const ww3Accessibility = await new AxeBuilder({ page }).include(".ww3").analyze();
  expect(ww3Accessibility.violations).toEqual([]);
  await hazardModes.getByRole("button", { name: "津波" }).click();

  await page.getByRole("button", { name: "時系列", exact: true }).click();
  const historicalTimeline = page.getByRole("group", { name: "歴史イベントのタイムライン" });
  await expect(historicalTimeline).toBeVisible();
  expect(await historicalTimeline.screenshot()).toMatchSnapshot("localized-timeline-ja.png");
  const timelineAccessibility = await new AxeBuilder({ page }).include(".timeline").analyze();
  expect(timelineAccessibility.violations).toEqual([]);

  await page.getByRole("button", { name: "NOAAの過去事例を検索" }).click();
  const historicalBrowser = page.getByRole("dialog", { name: "歴史津波イベント" });
  await expect(historicalBrowser).toBeVisible();
  await expect(historicalBrowser.getByText("デスクトップデータソース")).toBeVisible();
  expect(await historicalBrowser.screenshot()).toMatchSnapshot("localized-historical-browser-ja.png");
  const historicalAccessibility = await new AxeBuilder({ page }).include(".historical-browser").analyze();
  expect(historicalAccessibility.violations).toEqual([]);
  await historicalBrowser.getByRole("button", { name: "閉じる" }).click();

  await page.getByRole("button", { name: "比較", exact: true }).click();
  const comparisonStories = page.getByRole("region", { name: "比較ストーリー" });
  await expect(comparisonStories).toBeVisible();
  await expect(comparisonStories.getByRole("button", { name: /2つの海洋巨大地震/ })).toBeVisible();
  const comparisonReadout = comparisonStories.locator(".comparison-story__readout");
  await comparisonReadout.scrollIntoViewIfNeeded();
  expect(await comparisonReadout.screenshot()).toMatchSnapshot("localized-comparison-ja.png");
  const comparisonAccessibility = await new AxeBuilder({ page }).include(".app__compare-picker").analyze();
  expect(comparisonAccessibility.violations).toEqual([]);
  await page.getByRole("button", { name: "比較", exact: true }).click();
  await page.getByRole("button", { name: "カード", exact: true }).click();

  await page.getByRole("button", { name: "独自に作成" }).click();
  const customBuilder = page.locator(".scenario-builder");
  await expect(customBuilder.getByText("カスタムシナリオ", { exact: true })).toBeVisible();
  await expect(customBuilder.getByRole("tab", { name: "小惑星" })).toBeVisible();
  await expect(customBuilder.getByRole("spinbutton", { name: "直径 (m) 正確な値" })).toBeVisible();
  await customBuilder.getByRole("tab", { name: "地震" }).click();
  await expect(customBuilder.getByRole("spinbutton", { name: "マグニチュード (M_w) 正確な値" })).toBeVisible();
  await expect(customBuilder.getByRole("button", { name: "沈み込み帯から断層を自動入力" })).toBeVisible();
  const customAccessibility = await new AxeBuilder({ page }).include(".scenario-builder").analyze();
  expect(customAccessibility.violations).toEqual([]);
  const customBounds = await customBuilder.boundingBox();
  expect(customBounds).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(await page.screenshot({
    clip: {
      x: customBounds!.x,
      y: Math.max(0, customBounds!.y),
      width: customBounds!.width,
      height: Math.min(customBounds!.height, 390, viewport!.height - Math.max(0, customBounds!.y) - 12),
    },
    style: ".simulation-transport { display: none !important; }",
  })).toMatchSnapshot("localized-scenario-builder-ja.png");

  const tohoku = page.locator('.preset-card:has-text("Tohoku")').first();
  await expect(tohoku).toBeVisible();
  await tohoku.click();
  await expect(page.locator(".source-model:visible")).toContainText("発生源モデル");
  await page.getByRole("button", { name: "実行して見る" }).click();
  await page.getByRole("tab", { name: "設定", exact: true }).click();
  await expect(page.locator(".source-model:visible")).toContainText("Okada断層変位モデル");
  await page.getByRole("group", { name: "表示の詳細度" }).getByRole("button", { name: "詳細", exact: true }).click();
  await expect(page.locator(".swe:visible")).toContainText("波動伝播");
  await expect(page.locator('[aria-label="1度あたりの格子セル数"]:visible')).toBeAttached();
  await expect(page.locator('.journey-progress li[data-state="active"]')).toContainText("理解");
  const inspector = page.locator(".app__panel--right");
  await inspector.evaluate((panel) => { panel.scrollTop = 0; });
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
  const pauseTimeline = page.getByRole("button", { name: "シナリオ時系列を一時停止" });
  await expect(pauseTimeline).toBeVisible();
  await pauseTimeline.click();
  const timelineScrubber = page.getByRole("slider", { name: "シナリオ時系列スライダー" });
  await timelineScrubber.fill("0");
  await expect(timelineScrubber).toHaveValue("0");
  await inspector.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.getByRole("tab", { name: "影響" })).toBeVisible();
  await expect(page.getByText("何が起きたか", { exact: true })).toBeVisible();
  await expect(page.getByText("沿岸スクリーニング検証", { exact: true })).not.toBeVisible();
  inspectorBounds = await inspector.boundingBox();
  expect(inspectorBounds).not.toBeNull();
  expect(await page.screenshot({ clip: inspectorBounds! })).toMatchSnapshot("localized-results-ja.png");
  const resultsAccessibility = await new AxeBuilder({ page }).include(".app__panel--right").analyze();
  expect(resultsAccessibility.violations).toEqual([]);

  await page.getByRole("tab", { name: "科学情報", exact: true }).click();
  const attenuation = page.locator(".results__tabpanel > .section").last();
  await expect(attenuation).toBeVisible();
  await attenuation.scrollIntoViewIfNeeded();
  expect(await attenuation.screenshot()).toMatchSnapshot("localized-attenuation-ja.png");
  const attenuationAccessibility = await new AxeBuilder({ page }).include(".results__tabpanel > .section:last-child").analyze();
  expect(attenuationAccessibility.violations).toEqual([]);

  await page.getByRole("tab", { name: "検証", exact: true }).click();
  const dart = page.locator(".results__tabpanel > .section").last();
  await expect(dart).toBeVisible();
  await dart.scrollIntoViewIfNeeded();
  expect(await dart.screenshot()).toMatchSnapshot("localized-dart-ja.png");
  const dartAccessibility = await new AxeBuilder({ page }).include(".results__tabpanel > .section:last-child").analyze();
  expect(dartAccessibility.violations).toEqual([]);

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

  await lesson.getByRole("button", { name: "スキップ" }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("tsunamisim:tour-requested")));
  const tour = page.getByRole("dialog", { name: "Cataclysmへようこそ" });
  await expect(tour).toBeVisible();
  await expect(tour.getByText("6ステップ中1")).toBeVisible();
  await expect(tour.getByRole("button", { name: "次へ" })).toBeVisible();
  const tourAccessibility = await new AxeBuilder({ page }).include(".tour-card").analyze();
  expect(tourAccessibility.violations).toEqual([]);
  const tourBounds = await page.locator(".tour-card").boundingBox();
  expect(tourBounds).not.toBeNull();
  expect(await page.screenshot({ clip: tourBounds! })).toMatchSnapshot("localized-tour-ja.png");

  await tour.getByRole("button", { name: "ツアーを閉じる" }).click();
  await page.getByRole("button", { name: "詳細文献" }).click();
  const citations = page.getByRole("dialog", { name: "詳細な参考文献と来歴" });
  await expect(citations).toBeVisible();
  await expect(citations.getByLabel("引用情報の概要")).toBeVisible();
  await expect(citations.getByRole("button", { name: "サードパーティ通知を表示" })).toBeDisabled();
  const citationsAccessibility = await new AxeBuilder({ page }).include(".modal").analyze();
  expect(citationsAccessibility.violations).toEqual([]);
  const citationBounds = await page.locator(".modal").boundingBox();
  expect(citationBounds).not.toBeNull();
  expect(await page.screenshot({ clip: citationBounds! })).toMatchSnapshot("localized-citations-ja.png");

  await citations.getByRole("button", { name: "閉じる" }).click();
  await page.getByRole("button", { name: "診断ログ" }).click();
  const diagnostics = page.getByRole("dialog", { name: "アプリケーションログ" });
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.getByRole("heading", { name: "診断ログ" })).toBeVisible();
  await expect(diagnostics.getByRole("button", { name: "ログをコピー" })).toBeVisible();
  await expect(diagnostics.getByRole("button", { name: "診断情報をコピー" })).toBeVisible();
  const diagnosticsAccessibility = await new AxeBuilder({ page }).include(".log-viewer").analyze();
  expect(diagnosticsAccessibility.violations).toEqual([]);
  const diagnosticsBounds = await page.locator(".log-viewer").boundingBox();
  expect(diagnosticsBounds).not.toBeNull();
  expect(await page.screenshot({
    clip: diagnosticsBounds!,
    style: ".log-viewer__time { visibility: hidden !important; }",
  })).toMatchSnapshot("localized-diagnostics-ja.png");
});

test("first-run launch and safety guidance honor the stored language", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    window.history.replaceState({}, "", "/?launchExperience=1&launchHold=1&launchMotion=reduce");
    window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
    window.dispatchEvent(new CustomEvent("cataclysm:preview-launch"));
  });

  const launch = page.getByRole("dialog", { name: "Cataclysm" });
  await expect(launch.getByText("惑星災害シミュレーター")).toBeVisible();
  await expect(launch.getByText("生きた地球を準備中")).toBeVisible();
  await expect(launch.getByRole("button", { name: "イントロをスキップ" })).toBeVisible();
  const launchAccessibility = await new AxeBuilder({ page }).include(".launch-experience").analyze();
  expect(launchAccessibility.violations).toEqual([]);
  expect(await page.screenshot()).toMatchSnapshot("localized-launch-ja.png");

  await launch.getByRole("button", { name: "イントロをスキップ" }).click();
  await expect(launch).not.toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cataclysm:replay-disclaimer")));
  const notice = page.getByRole("dialog", { name: "教育用モデルであり、警報システムではありません" });
  await expect(notice).toBeVisible();
  await expect(notice.getByText("適した用途")).toBeVisible();
  await expect(notice.getByRole("button", { name: "理解しました" })).toBeVisible();
  const noticeAccessibility = await new AxeBuilder({ page }).include(".modal--notice").analyze();
  expect(noticeAccessibility.violations).toEqual([]);
  const noticeBounds = await page.locator(".modal--notice").boundingBox();
  expect(noticeBounds).not.toBeNull();
  expect(await page.screenshot({ clip: noticeBounds! })).toMatchSnapshot("localized-first-run-ja.png");
});
