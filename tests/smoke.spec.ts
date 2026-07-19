import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

async function seedAcknowledgedPreview(page: Page) {
  await page.addInitScript(() => {
    const now = JSON.stringify(new Date().toISOString());
    localStorage.setItem("tsunamisim._settings_schema_version", "5");
    localStorage.setItem("tsunamisim.launch_experience_seen_at", now);
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
    localStorage.setItem("tsunamisim.tour_completed_at", now);
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
    localStorage.removeItem("tsunamisim.saved_scenarios");
  });
}

test.describe("Cataclysm browser preview", () => {
  test.beforeEach(async ({ page }) => {
    await seedAcknowledgedPreview(page);
  });

  test("loads the app shell and renders a globe canvas", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app__brand")).toBeVisible();
    await expect(page.locator(".app__title")).toHaveText("Cataclysm");

    const canvas = page.locator(".cesium-widget canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
  });

  test("renders an antimeridian SWE field as complete non-wrapping tiles", async ({ page }) => {
    const payload = {
      schemaVersion: 1,
      kind: "Asteroid",
      source: {
        diameter_m: 1_000,
        density_kg_m3: 3_000,
        velocity_m_s: 20_000,
        angle_deg: 45,
        water_depth_m: 4_000,
        location: { lat_deg: 0, lon_deg: 179.5, depth_m: 4_000 },
      },
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
    await page.goto(`/?scenario=${encodeURIComponent(encoded)}`);
    const workspace = page.getByRole("group", { name: "Workspace detail" });
    await workspace.getByRole("button", { name: "Customize" }).click();
    await expect(page.getByRole("button", { name: "Run simulation", exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Run simulation", exact: true }).click();

    await expect(page.locator(".app__globe-mount")).toHaveAttribute(
      "data-swe-field-tiles",
      "2",
      { timeout: 20_000 },
    );
    await expect(page.getByRole("progressbar", { name: "SWE solver progress" })).toHaveCount(0);
  });

  test("offers an unseen crash report until the user inspects or clears it", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tsunamisim.last_crash", JSON.stringify({
        at: Date.parse("2026-07-14T12:00:00.000Z"),
        source: "unhandled-rejection",
        name: "Error",
        message: "Redacted prior failure",
        componentStack: null,
        recentLogs: [],
        seen: false,
      }));
    });
    await page.goto("/");

    const recovery = page.getByRole("status").filter({ hasText: "previous failure" });
    await expect(recovery).toBeVisible();
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("tsunamisim.last_crash") ?? "null")).seen)
      .toBe(false);

    await recovery.getByRole("button", { name: "Inspect report" }).click();
    const dialog = page.getByRole("dialog", { name: "Application log" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Previous crash report" })).toContainText("Redacted prior failure");
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("tsunamisim.last_crash") ?? "null")).seen)
      .toBe(true);
    await expect(recovery).toHaveCount(0);

    await dialog.getByRole("button", { name: "Clear report" }).click();
    expect(await page.evaluate(() => localStorage.getItem("tsunamisim.last_crash"))).toBeNull();
  });

  test("surfaces WebGL context loss and rebuilds the renderer without losing the app", async ({ page }) => {
    await page.goto("/");
    const canvas = page.locator(".cesium-widget canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await canvas.evaluate((element) => {
      element.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    const reset = page.getByRole("button", { name: "Reset renderer" });
    await expect(reset).toBeVisible({ timeout: 10_000 });
    await reset.click();
    await expect(page.locator(".cesium-widget canvas")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".app__title")).toHaveText("Cataclysm");
  });

  test("starts directly on bundled imagery while offline", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "onLine", {
        configurable: true,
        get: () => false,
      });
    });
    await page.goto("/");

    const globe = page.locator(".app__globe-mount");
    await expect(globe).toHaveAttribute("data-imagery-status", "fallback", { timeout: 15_000 });
    await expect(globe).toHaveAttribute("data-imagery-style", "natural-earth-2");
    await expect(page.locator('.app__globe-status[data-status="fallback"]')).toContainText(
      "Offline — using bundled Natural Earth II",
    );

    // A stable local fallback must not churn back through the provider effect.
    await page.waitForTimeout(1_000);
    await expect(globe).toHaveAttribute("data-imagery-status", "fallback");
  });

  test("falls back after tile failures and retries without losing scenario state", async ({ page }) => {
    await page.route(/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery/i, (route) =>
      route.abort("failed"),
    );
    await page.goto("/");

    const chicxulub = page.locator(".preset-card").filter({
      has: page.getByText("Chicxulub Impact", { exact: true }),
    });
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await expect(chicxulub).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Run & Watch" }).click();

    const globe = page.locator(".app__globe-mount");
    await expect(globe).toHaveAttribute("data-imagery-status", "fallback", { timeout: 20_000 });
    await expect(globe).toHaveAttribute("data-imagery-style", "natural-earth-2");

    await page.getByRole("button", { name: /Retry Esri World Imagery/i }).click();
    await expect(globe).toHaveAttribute("data-imagery-status", "fallback", { timeout: 20_000 });
    await expect(chicxulub).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("tab", { name: "Science" }).click();
    await expect(page.locator(".results").filter({ hasText: "Energy" })).toBeVisible();
  });

  test("preset selector lists at least one preset", async ({ page }) => {
    await page.goto("/");
    const presetButtons = page.locator(".preset-card");
    await expect(presetButtons.first()).toBeVisible({ timeout: 10_000 });
    const count = await presetButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("relates a historical scenario to a familiar place without moving its source or sending the query", async ({ page }) => {
    const leakedQueries: string[] = [];
    page.on("request", (request) => {
      const payload = `${request.url()} ${request.postData() ?? ""}`;
      if (/02134|Allston/i.test(payload)) leakedQueries.push(payload);
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Near a place I know" }).click();
    const search = page.getByRole("combobox", { name: "Near a place I know" });
    await search.fill("02134");
    await page.getByRole("option", { name: /02134.*Allston, MA/i }).click();

    const chicxulub = page.locator(".preset-card").filter({
      has: page.getByText("Chicxulub Impact", { exact: true }),
    });
    await chicxulub.click();
    await page.getByRole("button", { name: "Run & Watch" }).click();
    await page.getByRole("tab", { name: "Results" }).click();

    const place = page.getByRole("region", { name: "Near 02134 · Allston, MA" });
    await expect(place).toBeVisible({ timeout: 15_000 });
    await expect(place).toContainText("Distance from source");
    await expect(place).toContainText("Arrival / effect timing");
    await expect(place).toContainText("remains at its factual source coordinates");
    await expect(place).toContainText("search queries never leave this device");
    expect((await new AxeBuilder({ page }).include(".familiar-place").analyze()).violations).toEqual([]);
    expect(leakedQueries).toEqual([]);
  });

  test("keeps real close approaches separate from hypothetical impacts", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Planetary Defense Live" }).click();
    const defense = page.getByRole("region", { name: "Planetary Defense Live" });
    await expect(defense).toBeVisible();
    await expect(defense).toContainText("JPL documentation examples, not today's feed");
    await expect(defense.getByText("A close approach is not a predicted impact.").first()).toBeVisible();

    await defense.getByRole("button", { name: "Explore real approach" }).first().click();
    await expect(defense).toContainText("no risk claim made");
    await expect(defense.getByRole("img", { name: /Schematic close approach/i })).toBeVisible();

    await defense.getByRole("button", { name: "Try hypothetical impact" }).first().click();
    const workspace = page.getByRole("complementary", { name: "Simulation controls and results" });
    await expect(workspace.getByText(/Hypothetical impact: 153814/i).first()).toBeVisible();
    await expect(workspace).toContainText("Non-prediction");
    await expect(workspace).toContainText("JPL does not predict this object will hit Earth");
    expect((await new AxeBuilder({ page }).include(".hazard__scenario-context").analyze()).violations).toEqual([]);
  });

  test("browser preview displays the shared Rust/WASM source fixture", async ({ page }) => {
    await page.goto("/");
    const eltanin = page.locator(".preset-card").filter({
      has: page.getByText("Eltanin Impact", { exact: true }),
    });
    await expect(eltanin).toBeVisible({ timeout: 10_000 });
    await eltanin.click();
    await page.getByRole("button", { name: "Run & Watch" }).click();
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("tab", { name: "Science" }).click();

    await expect(page.getByText("Rust-authoritative", { exact: true })).toBeVisible();
    await expect(page.locator(".results__cell", { hasText: "Cavity radius" })).toContainText("12.4 km");
    await expect(page.locator(".results__cell", { hasText: "Peak source displacement" })).toContainText("2.3 km");
    await page.getByText(/View wave attenuation data/).click();
    await expect(page.getByText("Rust attenuation_curve compiled to browser WASM").first()).toBeVisible();
  });

  test("keeps humanitarian facility lookup off until consent, then lists and pins exact OSM matches", async ({ page }) => {
    let overpassRequests = 0;
    await page.route("https://overpass-api.de/**", async (route) => {
      overpassRequests += 1;
      const query = new URLSearchParams(route.request().postData() ?? "").get("data") ?? "";
      expect(query).toContain('[out:json][timeout:15][maxsize:67108864]');
      const box = query.match(/\]\((-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)\);/);
      expect(box).not.toBeNull();
      const lat = (Number(box![1]) + Number(box![3])) / 2;
      const lon = (Number(box![2]) + Number(box![4])) / 2;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 0.6,
          osm3s: { timestamp_osm_base: "2026-07-17T15:00:00Z" },
          elements: [{ type: "node", id: 7001, lat, lon, tags: { amenity: "clinic", name: "Harbor Clinic" } }],
        }),
      });
    });
    await page.goto("/");
    const chicxulub = page.locator(".preset-card").filter({
      has: page.getByText("Chicxulub Impact", { exact: true }),
    });
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await page.getByRole("button", { name: "Run & Watch" }).click();
    await expect(page.getByRole("status", { name: /Run and Watch:/i }))
      .toHaveAttribute("aria-label", "Run and Watch: Understand", { timeout: 15_000 });
    await page.getByRole("tab", { name: "Layers" }).click();

    const facilityToggle = page.getByRole("checkbox", { name: "Show humanitarian facilities from OpenStreetMap" });
    await expect(facilityToggle).toBeVisible();
    expect(overpassRequests).toBe(0);
    await facilityToggle.check();

    await expect(page.getByRole("link", { name: "Harbor Clinic" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".app__globe-mount").first()).toHaveAttribute("data-humanitarian-facilities", "1");
    await expect(page.locator(".app__globe-osm-attribution").first()).toBeVisible();
    const facilityRow = page.locator(".layer-inspector__row", { hasText: "Humanitarian facilities" });
    await facilityRow.getByRole("slider", { name: "Opacity for Humanitarian facilities" }).fill("55");
    await facilityRow.getByRole("button", { name: "Move Humanitarian facilities down" }).click();
    await expect.poll(() => page.evaluate(() => {
      const workspace = JSON.parse(localStorage.getItem("cataclysm.layer-controller.v1") ?? "null") as {
        scenarios?: Array<{ scenarioKey: string; layers: Array<{ id: string; visible: boolean; opacity: number; order: number }> }>;
      } | null;
      return workspace?.scenarios
        ?.find((scenario) => scenario.scenarioKey === "tsunami:id:chicxulub")
        ?.layers.find((layer) => layer.id === "humanitarian-facilities") ?? null;
    })).toEqual({ id: "humanitarian-facilities", visible: true, opacity: 0.55, order: 1 });
    expect((await new AxeBuilder({ page }).include(".layer-inspector").analyze()).violations).toEqual([]);
    expect(overpassRequests).toBe(1);
  });

  test("historical event browser explains its desktop-only live data boundary", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Search NOAA historical events/i }).click();

    const dialog = page.getByRole("dialog", { name: "Historical tsunami events" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Live lookup is disabled in the browser preview");
    expect((await new AxeBuilder({ page }).include(".historical-browser").analyze()).violations).toEqual([]);
    await dialog.getByLabel("Year and location").fill("1960 Chile");
    await dialog.getByRole("button", { name: "Search NOAA" }).click();
    await expect(dialog.getByRole("alert")).toContainText("installed desktop app");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("keeps scenario discovery unobstructed when the long tour has not been completed", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("tsunamisim.tour_completed_at"));
    await page.goto("/");

    await expect(page.getByText("Explore scenario packs")).toBeVisible();
    await expect(page.getByRole("dialog", { name: /Welcome to Cataclysm/i })).toHaveCount(0);
  });

  test("visual packs preview without computing and run direct what-if scenarios explicitly", async ({ page }) => {
    await page.goto("/");
    const app = page.locator(".app");
    await expect(page.getByRole("button", { name: /Start Here/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Asteroid Scale Ladder/i })).toBeVisible();
    await expect(page.locator(".scenario-pack-strip img")).toHaveCount(7);
    await expect(page.getByRole("button", { name: "Surprise me" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Create my own/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue recent/i })).toBeDisabled();

    await page.getByRole("button", { name: /Asteroid Scale Ladder/i }).click();
    await page.locator(".preset-card").filter({ hasText: "Tokyo asteroid impact" }).click();
    await expect(app).toHaveAttribute("data-domain", "tsunami");
    await expect(page.getByRole("button", { name: "Run & Watch" })).toBeVisible();
    await expect(page.locator(".app__viewport-telemetry")).toContainText(/35\.\d+° N/, { timeout: 10_000 });

    await page.getByRole("button", { name: "Run & Watch" }).click();
    await expect(app).toHaveAttribute("data-domain", "asteroid");
    await expect(page.getByText("Scenarios", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue recent/i })).toBeEnabled();
  });

  test("rejects unknown preset links without loading an unrelated fallback", async ({ page }) => {
    await page.goto("/?preset=missing-scenario");

    await expect(page.getByRole("alert")).toContainText("Scenario link not found: missing-scenario");
    await expect(page.locator(".app__viewport-hud--source")).toContainText("No source");
  });

  test("explains malformed shared scenarios without loading fallback physics", async ({ page }) => {
    await page.goto("/?scenario=not-valid-base64!!!");

    await expect(page.getByRole("alert")).toContainText(/Couldn't open scenario link:.*malformed or corrupted/i);
    await expect(page.locator(".app__viewport-hud--source")).toContainText("No source");
  });

  test("Run & Watch advances to outcomes with one playhead and reuses cached frames", async ({ page }) => {
    await page.goto("/");
    const chicxulub = page.locator(".preset-card").filter({
      has: page.getByText("Chicxulub Impact", { exact: true }),
    });
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await page.getByRole("button", { name: "Run & Watch" }).click();

    const journey = page.getByRole("status", { name: /Run and Watch:/i });
    await expect(journey).toContainText("Prepare");
    await expect(journey).toContainText("Calculate");
    await expect(journey).toContainText("Watch");
    await expect(journey).toContainText("Understand");
    await expect(journey).toHaveAttribute("aria-label", "Run and Watch: Understand", { timeout: 10_000 });
    await expect(page.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("What happened?")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("slider", { name: "Scenario timeline scrubber" })).toHaveCount(1);
    await expect(page.getByRole("slider", { name: "Simulation timeline scrubber" })).toHaveCount(0);
    const storyScrubber = page.getByRole("slider", { name: "Scenario timeline scrubber" });
    const timeBeforeFocus = await storyScrubber.inputValue();
    await page.getByRole("button", { name: /First affected named coast/i }).click();
    await expect.poll(() => storyScrubber.inputValue()).not.toBe(timeBeforeFocus);

    await page.getByRole("button", { name: "Run & Watch" }).click();
    await expect(journey).toHaveAttribute("aria-label", "Run and Watch: Watch");
    await expect(page.getByRole("progressbar", { name: "SWE solver progress" })).toHaveCount(0);
  });

  test("builds a shareable highlight story from cached frames without recomputing physics", async ({ page }) => {
    await page.goto("/");
    const chicxulub = page.locator(".preset-card").filter({
      has: page.getByText("Chicxulub Impact", { exact: true }),
    });
    await chicxulub.click();
    await page.getByRole("button", { name: "Run & Watch" }).click();
    await expect(page.getByRole("status", { name: "Run and Watch: Understand" })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const shareStory = page.getByRole("button", { name: "Share story", exact: true });
    await expect(shareStory).toHaveAttribute("aria-disabled", "false");
    await shareStory.click();

    const dialog = page.getByRole("dialog", { name: "Share story" });
    await expect(dialog).toContainText("60 cached frames");
    await expect(dialog).toContainText("Replay identity");
    await expect(dialog).toContainText("CesiumJS");
    await dialog.getByRole("button", { name: "15 sec" }).click();
    await dialog.getByRole("button", { name: "Clean cinematic" }).click();
    await expect(dialog).toContainText("analytical labels and overlays are omitted");
    expect((await new AxeBuilder({ page }).include(".highlight-story").analyze()).violations).toEqual([]);

    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Save story file" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("cataclysm-chicxulub-15s.catstory.json");
    const path = await download.path();
    expect(path).not.toBeNull();
    const manifest = JSON.parse(await readFile(path!, "utf8")) as {
      cut: { durationS: number; overlayPolicy: string; frameSource: string };
      replay: { frameCount: number; fingerprint: string; frames: unknown[] };
      scenarioUrl: string;
    };
    expect(manifest.cut).toEqual(expect.objectContaining({
      durationS: 15,
      overlayPolicy: "clean_cinematic",
      frameSource: "cached_authoritative_replay",
    }));
    expect(manifest.replay.frameCount).toBe(60);
    expect(manifest.replay.frames).toHaveLength(60);
    expect(manifest.replay.fingerprint).toMatch(/^fnv1a32-/);
    const storyLink = new URL(manifest.scenarioUrl);
    expect(storyLink.searchParams.get("preset")).toBe("chicxulub");
    expect(storyLink.searchParams.get("highlight")).toBe("15");
    expect(storyLink.searchParams.get("highlightView")).toBe("clean_cinematic");
    await expect(page.getByRole("progressbar", { name: "SWE solver progress" })).toHaveCount(0);

    await page.goto(`${storyLink.pathname}${storyLink.search}`);
    await expect(page.getByRole("button", { name: "Run & Watch" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Run & Watch" }).click();
    const linkedDialog = page.getByRole("dialog", { name: "Share story" });
    await expect(linkedDialog).toBeVisible({ timeout: 20_000 });
    await expect(linkedDialog.getByRole("button", { name: "15 sec" })).toHaveAttribute("aria-pressed", "true");
    await expect(linkedDialog.getByRole("button", { name: "Clean cinematic" })).toHaveAttribute("aria-pressed", "true");
  });

  test("export menu exposes all supported formats", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const menu = page.getByRole("group", { name: "Export current scenario" });
    for (const label of ["PNG", "Share", "Share story", "Video", "Text", "NetCDF", "KML", "Link"]) {
      await expect(menu.getByRole("button", { name: new RegExp(`^${label}(?:\\s+Requires:|$)`) })).toBeVisible();
    }
    await expect(menu.getByRole("button", { name: /^NetCDF(?:\s|$)/ })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: "References", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  });

  test("direct nuclear results unlock provenance-bearing GIS exports", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?referenceCapture=1&referenceScene=nuclear-surface-burst");
    await page.getByRole("button", { name: "Nuclear", exact: true }).click();
    await page.locator(".hazard").getByRole("button", { name: /pick location on globe/i }).click();
    const coordinates = page.getByRole("form", { name: "Enter coordinates" });
    await coordinates.getByRole("spinbutton", { name: "Latitude" }).fill("40");
    await coordinates.getByRole("spinbutton", { name: "Longitude" }).fill("-74");
    await coordinates.getByRole("button", { name: "Go" }).click();

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const menu = page.getByRole("group", { name: "Export current scenario" });
    for (const label of ["PNG", "Share", "CZML", "GeoJSON", "KML"]) {
      const action = label === "Share"
        ? menu.getByRole("button", { name: "Share", exact: true })
        : menu.getByRole("button", { name: new RegExp(`^${label}(?:\\s|$)`) });
      await expect(action).not.toHaveAttribute("aria-disabled", "true");
    }

    const downloadPromise = page.waitForEvent("download");
    await menu.getByRole("button", { name: /^GeoJSON(?:\s|$)/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("cataclysm-nuclear-result-effects.geojson");
  });

  test("nuclear hazard mode reveals desktop-backed detonation controls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    // Hazard-mode switch lives in the header, distinct from the scenario
    // source tabs (which are role=tab).
    await page.getByRole("button", { name: "Nuclear", exact: true }).click();

    const panel = page.locator(".hazard");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText("Nuclear detonation")).toBeVisible();
    await expect(panel.getByRole("button", { name: /pick location on globe/i })).toBeVisible();
    // Weapon preset picker from the ported NukeMap table.
    await expect(panel.getByRole("option", { name: /Little Boy \(Hiroshima\)/ })).toBeAttached();
  });

  test("global exchange lab drives the React HUD and Cesium plan", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Nuclear", exact: true }).click();

    const exchange = page.getByRole("region", { name: "Global exchange lab" });
    await expect(exchange).toBeVisible({ timeout: 10_000 });
    await expect(exchange.getByRole("combobox", { name: "Scenario" }).locator("option")).toHaveCount(7);
    await exchange.getByRole("button", { name: "Run illustrative exchange" }).click();

    const globe = page.locator(".app__globe-mount").first();
    await expect(globe).toHaveAttribute("data-ww3-plan", "global:all");
    await expect(globe).toHaveAttribute("data-ww3-strikes", "712");
    const hud = page.getByRole("complementary", { name: "Illustrative global exchange status" });
    await expect(hud).toBeVisible();
    await expect(hud).toContainText("Global Thermonuclear War");
    await expect(hud).toContainText("/ 712");
    await expect(hud.getByRole("progressbar")).not.toHaveAttribute("value", "0", { timeout: 3_000 });
  });

  test("MIRV preset publishes an accessible Cesium pattern preview", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Nuclear", exact: true }).click();
    await page.locator(".hazard").getByRole("button", { name: /pick location on globe/i }).click();
    const coordinateForm = page.getByRole("form", { name: "Enter coordinates" });
    await coordinateForm.getByRole("spinbutton", { name: "Latitude" }).fill("40");
    await coordinateForm.getByRole("spinbutton", { name: "Longitude" }).fill("-74");
    await coordinateForm.getByRole("button", { name: "Go" }).click();

    const mirv = page.getByRole("region", { name: "MIRV pattern preview" });
    await mirv.getByRole("combobox", { name: "Payload preset" }).selectOption("trident-ii-w76");
    await expect(mirv).toContainText("8");
    await expect(mirv).toContainText("8 km");
    const globe = page.locator(".app__globe-mount").first();
    await expect(globe).toHaveAttribute("data-mirv-warheads", "8");
    await expect(globe).toHaveAttribute("data-mirv-preview", /trident-ii-w76:40\.000000:-74\.000000/);
  });

  test("hazard domain switches park incompatible workspace state", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const app = page.locator(".app");
    const chicxulub = page.locator(".preset-card").filter({
      has: page.getByText("Chicxulub Impact", { exact: true }),
    });
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await expect(chicxulub).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Run & Watch" }).click();
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(app).toHaveAttribute("data-compare", "true");

    await page.getByRole("button", { name: "Nuclear", exact: true }).click();
    await expect(app).toHaveAttribute("data-domain", "nuclear");
    await expect(app).toHaveAttribute("data-compare", "false");
    await expect(page.locator(".preset-card").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Compare", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: "Inspect", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".app__viewport-hud--source")).toContainText("Nuclear detonation");
    await expect(page.locator(".app__viewport-hud--source")).not.toContainText("Chicxulub");
    await expect(page.getByLabel("Surface displacement legend")).toHaveAttribute("data-visible", "false");
    await expect(page.getByText("Choose an effects origin.")).toBeVisible();
    await page.getByRole("tab", { name: "Layers" }).click();
    await expect(page.getByText("Hazard effect rings")).toBeVisible();
    await expect(page.getByText("SWE water field")).toHaveCount(0);

    await page.getByRole("button", { name: "Impact", exact: true }).click();
    await expect(app).toHaveAttribute("data-domain", "asteroid");
    await expect(page.locator(".app__viewport-hud--source")).toContainText("Asteroid impact");
    await expect(page.locator(".preset-card").first()).toBeVisible();

    await page.getByRole("button", { name: "Tsunami", exact: true }).click();
    await expect(app).toHaveAttribute("data-domain", "tsunami");
    await expect(app).toHaveAttribute("data-compare", "false");
    await expect(chicxulub).toBeVisible();
    await expect(chicxulub).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Inspect", exact: true })).toHaveAttribute("aria-disabled", "false");
    await expect(page.getByLabel("Surface displacement legend")).toHaveAttribute("data-visible", "true");
  });

  test("comparison opens a synchronized suggested story before custom Slot B", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await page.getByRole("button", { name: "Compare", exact: true }).click();
    const stories = page.getByRole("region", { name: "Comparison stories" });
    await expect(stories).toBeVisible();
    await expect(stories.getByRole("button", { name: /Two ocean-basin megathrusts/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(stories.getByLabel("Compare against")).toHaveValue("indian_ocean_2004");
    await expect(stories.getByText(/Linked at T\+60 min/i)).toBeVisible();
    await expect(stories.getByText(/Source energy/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".app__globe-tag", { hasText: "Slot B" })).toBeVisible();
  });

  test("saves and reloads a custom scenario round trip", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await page.getByRole("button", { name: /Create my own/i }).click();
    await expect(page.getByText("Custom scenario", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved scenario." })).toBeVisible();

    await page.getByRole("tab", { name: "Nuclear" }).click();
    await expect(page.getByRole("tab", { name: "Nuclear" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: /Load \(1\)/ }).click();
    await page.locator(".scenario-saved__load").filter({ hasText: /^Asteroid/ }).click();

    await expect(page.getByRole("tab", { name: "Asteroid" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("status").filter({ hasText: "Loaded scenario." })).toBeVisible();
  });

  test("keeps numeric help collapsed until its disclosure button is used", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Create my own/i }).click();
    const helpButton = page.getByRole("button", { name: "About Diameter (m)" });
    const helpId = await helpButton.getAttribute("aria-controls");
    expect(helpId).toBeTruthy();
    const help = page.locator(`#${helpId}`);

    await expect(help).toBeHidden();
    await helpButton.click();
    await expect(help).toBeVisible();
  });

  test("progressively discloses simulator controls without discarding state", async ({ page }) => {
    await page.goto("/");
    const detail = page.getByRole("group", { name: "Workspace detail" });
    await expect(detail.getByRole("button", { name: "Simple" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Custom scenario", { exact: true })).toBeHidden();

    const chicxulub = page.locator(".preset-card").filter({
      has: page.getByText("Chicxulub Impact", { exact: true }),
    });
    await chicxulub.click();
    await page.getByRole("button", { name: "Run & Watch" }).click();
    await expect(page.getByRole("status", { name: "Run and Watch: Understand" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Manual controls" }).click();

    await expect(detail.getByRole("button", { name: "Customize" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Re-run simulation" })).toBeVisible();
    await expect(page.getByText("Use spatially varying ocean depths")).toBeVisible();
    await expect(page.getByLabel("Grid resolution in cells per degree")).toHaveCount(0);
    await expect(page.getByLabel("Gauge name")).toHaveCount(0);

    await detail.getByRole("button", { name: "Advanced" }).click();
    await expect(page.getByLabel("Grid resolution in cells per degree")).toBeVisible();
    await expect(page.getByLabel("Gauge name")).toBeVisible();
    await detail.getByRole("button", { name: "Simple" }).click();
    await expect(chicxulub).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Play scenario timeline" })).toBeVisible();
    await detail.getByRole("button", { name: "Advanced" }).click();
    await page.reload();
    await expect(detail.getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-pressed", "true");
  });

  test("publishes an advanced-mode gauge to the analytical globe", async ({ page }) => {
    const payload = {
      schemaVersion: 1,
      kind: "Asteroid",
      source: {
        diameter_m: 1_000,
        density_kg_m3: 3_000,
        velocity_m_s: 20_000,
        angle_deg: 45,
        water_depth_m: 4_000,
        location: { lat_deg: 0, lon_deg: 179.5, depth_m: 4_000 },
      },
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
    await page.goto(`/?scenario=${encodeURIComponent(encoded)}`);
    const detail = page.getByRole("group", { name: "Workspace detail" });
    await detail.getByRole("button", { name: "Advanced" }).click();
    await page.getByLabel("Gauge name").fill("Benchmark gauge", { timeout: 15_000 });
    await page.getByLabel("Gauge latitude").fill("12.5");
    await page.getByLabel("Gauge longitude").fill("-45.25");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.getByRole("listitem").filter({ hasText: "Benchmark gauge" })).toBeVisible();
    await expect(page.locator("[data-globe-scene-summary]")).toContainText("1 user gauges");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });

  test("cancelling globe pick mode does not trip the recovery boundary", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: /Create my own/i }).click();

    await page.getByRole("button", { name: "Pick on globe" }).click();
    const pickBanner = page.locator(".app__globe-pickbanner");
    await expect(pickBanner).toBeVisible();
    await pickBanner.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(page.locator(".app")).toHaveAttribute("data-compare", "true");
    await expect(page.locator(".app__globe-tag", { hasText: "Slot B" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Automated accessibility regression checks (axe-core)
// ---------------------------------------------------------------------------
// Scoped to WCAG 2.x A/AA conformance rules for the local verification gate.
// Best-practice and AAA rules remain advisory. Cesium's WebGL canvas and
// internal widgets are excluded (GPU-rendered 3D scene with no DOM semantics).
const AXE_EXCLUDE = [".cesium-widget", ".cesium-viewer-toolbar"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function axeScan(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .exclude(AXE_EXCLUDE)
    .analyze();
}

test.describe("Accessibility (axe-core WCAG A/AA)", () => {
  test("first-run disclaimer dialog has no violations", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: /educational model/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("main cockpit has no violations", async ({ page }) => {
    await seedAcknowledgedPreview(page);
    await page.goto("/");
    await expect(page.locator(".app__title")).toHaveText("Cataclysm", { timeout: 10_000 });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("Settings dialog has no violations", async ({ page }) => {
    await seedAcknowledgedPreview(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("LogViewer dialog has no violations", async ({ page }) => {
    await seedAcknowledgedPreview(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Diagnostics log" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });

  test("cockpit with active preset has no violations", async ({ page }) => {
    await seedAcknowledgedPreview(page);
    await page.goto("/");
    const chicxulub = page.locator(".preset-card").filter({
      has: page.getByText("Chicxulub Impact", { exact: true }),
    });
    await expect(chicxulub).toBeVisible({ timeout: 10_000 });
    await chicxulub.click();
    await page.getByRole("button", { name: "Run & Watch" }).click();
    await page.getByRole("tab", { name: "Results" }).click();
    await expect(page.getByText("What happened?")).toBeVisible({ timeout: 10_000 });

    const { violations } = await axeScan(page);
    expect(violations).toEqual([]);
  });
});
