import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

test("installed browser surface reloads from its complete offline cache", async ({ page, context }) => {
  const runtimeFailures: string[] = [];
  let appOrigin: string | null = null;
  page.on("pageerror", (error) => runtimeFailures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    if (appOrigin && new URL(request.url()).origin === appOrigin && failure !== "net::ERR_ABORTED") {
      runtimeFailures.push(`request: ${request.url()} (${failure})`);
    }
  });
  await page.addInitScript(() => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim._settings_schema_version", "5");
    localStorage.setItem("tsunamisim.launch_experience_seen_at", now);
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
    localStorage.setItem("tsunamisim.tour_completed_at", now);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
    localStorage.setItem("tsunamisim.globe_style", JSON.stringify("natural-earth-2"));
  });
  await page.goto("/");
  appOrigin = new URL(page.url()).origin;
  await expect(page.locator(".cesium-widget canvas")).toBeVisible({ timeout: 15_000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    }
  });
  const cachedShell = await page.evaluate(async () => ({
    controller: Boolean(navigator.serviceWorker.controller),
    index: Boolean(await caches.match("/index.html")),
    script: Boolean(await caches.match(document.querySelector<HTMLScriptElement>('script[type="module"]')?.src ?? "/missing")),
    styles: await Promise.all(Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(async (link) => Boolean(await caches.match(link.href)))),
  }));
  expect(cachedShell).toMatchObject({ controller: true, index: true, script: true });
  expect(cachedShell.styles.length).toBeGreaterThan(0);
  expect(cachedShell.styles.every(Boolean)).toBe(true);

  const denyNetwork = async (route: import("@playwright/test").Route) => route.abort("internetdisconnected");
  await context.route("**/*", denyNetwork);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Cataclysm");
    await expect(page.locator(".app__brand"), runtimeFailures.join("\n")).toBeVisible();
    await expect(page.locator(".cesium-widget canvas")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".app__globe-mount")).toHaveAttribute("data-imagery-style", "natural-earth-2");
    expect(runtimeFailures).toEqual([]);
  } finally {
    await context.unroute("**/*", denyNetwork);
  }
});
