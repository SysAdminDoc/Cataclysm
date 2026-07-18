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

test("language switch persists and translates the complete guided lesson surface", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const language = page.getByRole("combobox", { name: "Interface language" });
  await expect(language).toBeVisible();
  await language.selectOption("ja");
  await page.getByRole("button", { name: "Apply Changes" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("combobox", { name: "表示言語" })).toHaveValue("ja");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tsunamisim.locale") ?? "null"))).toBe("ja");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(page.getByText("クイックスタート", { exact: true })).toBeVisible();
  await expect(page.locator(".simulation-transport")).toContainText("シナリオ時刻");
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
