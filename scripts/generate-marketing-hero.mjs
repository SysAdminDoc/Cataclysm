import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = process.cwd();
const conceptRoot = path.join(root, "concepts", "marketing", "2026-09-13");
const candidateDir = path.join(conceptRoot, "candidates");
const comparisonDir = path.join(conceptRoot, "comparison");
const logoPath = path.join(root, "assets", "branding", "logo.svg");
const screenshotPath = path.join(root, "assets", "screenshots", "simulator-workspace-dark.png");

await Promise.all([
  mkdir(candidateDir, { recursive: true }),
  mkdir(comparisonDir, { recursive: true }),
]);

const [logo, screenshot] = await Promise.all([
  readFile(logoPath),
  readFile(screenshotPath),
]);
const logoData = `data:image/svg+xml;base64,${logo.toString("base64")}`;
const screenshotData = `data:image/png;base64,${screenshot.toString("base64")}`;

const baseStyles = `
  * { box-sizing: border-box; }
  html, body { width: 1600px; height: 900px; margin: 0; overflow: hidden; }
  body {
    color: #eff7fb;
    font-family: Inter, "Segoe UI Variable Display", "Segoe UI", sans-serif;
    background:
      radial-gradient(circle at 68% 44%, rgba(44, 191, 224, 0.16), transparent 33%),
      linear-gradient(132deg, #06121d 0%, #071927 48%, #03090f 100%);
  }
  .eyebrow {
    color: #61d7ef;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.17em;
  }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand img { width: 78px; height: 78px; }
  .brand-name { font-size: 25px; font-weight: 850; letter-spacing: 0.08em; }
  h1 { margin: 0; letter-spacing: -0.045em; line-height: 0.98; }
  p { color: #b7c8d6; line-height: 1.48; }
  .chips { display: flex; flex-wrap: wrap; gap: 11px; }
  .chip {
    padding: 10px 15px;
    border: 1px solid rgba(97, 215, 239, 0.3);
    border-radius: 999px;
    color: #dceaf2;
    background: rgba(13, 42, 59, 0.72);
    font-size: 15px;
    font-weight: 700;
  }
  .product-frame {
    overflow: hidden;
    border: 1px solid rgba(139, 216, 235, 0.32);
    border-radius: 18px;
    background: #03090f;
    box-shadow: 0 36px 90px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03) inset;
  }
  .product-frame img { display: block; width: 100%; height: auto; }
  .url { color: #7594a7; font: 600 16px/1.2 "Cascadia Mono", Consolas, monospace; }
`;

const candidateA = `<!doctype html><html><head><style>${baseStyles}
  .layout { position: relative; width: 100%; height: 100%; padding: 64px 56px 54px 72px; }
  .copy { position: absolute; left: 72px; top: 78px; width: 510px; }
  .copy .eyebrow { margin-top: 48px; }
  h1 { margin-top: 20px; font-size: 68px; max-width: 500px; }
  .copy p { margin: 26px 0 24px; max-width: 470px; font-size: 22px; }
  .product-frame { position: absolute; left: 614px; top: 154px; width: 938px; height: 553px; }
  .product-frame img { transform: translateY(-34px); }
  .accent { position: absolute; left: 614px; top: 731px; width: 938px; height: 2px; background: linear-gradient(90deg, #2cbfe0, rgba(44,191,224,0)); }
  .url { position: absolute; left: 72px; bottom: 58px; }
  .modes { position: absolute; right: 56px; bottom: 57px; color: #7fa5b8; font-size: 14px; font-weight: 800; letter-spacing: .14em; }
</style></head><body><main class="layout">
  <section class="copy">
    <div class="brand"><img src="${logoData}" alt=""><span class="brand-name">CATACLYSM</span></div>
    <div class="eyebrow">PLANETARY HAZARD SIMULATOR</div>
    <h1>Model the event.<br>Watch the consequences.</h1>
    <p>Explore tsunamis, asteroid impacts, nuclear detonations, earthquakes, and landslides on an interactive 3D globe.</p>
    <div class="chips"><span class="chip">Cited physical models</span><span class="chip">Local desktop simulation</span></div>
  </section>
  <figure class="product-frame"><img src="${screenshotData}" alt=""></figure>
  <div class="accent"></div>
  <div class="url">github.com/SysAdminDoc/Cataclysm</div>
  <div class="modes">TSUNAMI&nbsp;&nbsp;•&nbsp;&nbsp;IMPACT&nbsp;&nbsp;•&nbsp;&nbsp;NUCLEAR</div>
</main></body></html>`;

const candidateB = `<!doctype html><html><head><style>${baseStyles}
  .layout { position: relative; width: 100%; height: 100%; padding: 58px 80px; }
  .top { display: grid; grid-template-columns: 270px 1fr 470px; align-items: center; gap: 34px; }
  .top .brand { align-self: start; }
  .top .eyebrow { margin-bottom: 13px; }
  h1 { font-size: 57px; }
  .top p { margin: 0; font-size: 19px; }
  .product-frame { position: absolute; left: 80px; top: 270px; width: 1440px; height: 552px; }
  .product-frame img { transform: translateY(-52px); }
  .url { position: absolute; left: 82px; bottom: 35px; }
  .chips { position: absolute; right: 80px; bottom: 27px; }
</style></head><body><main class="layout">
  <header class="top">
    <div class="brand"><img src="${logoData}" alt=""><span class="brand-name">CATACLYSM</span></div>
    <div><div class="eyebrow">PLANETARY HAZARD SIMULATOR</div><h1>See how hazards move across a living globe.</h1></div>
    <p>Recreate documented events or build a what-if scenario. Inspect every assumption, replay the result, and export the evidence.</p>
  </header>
  <figure class="product-frame"><img src="${screenshotData}" alt=""></figure>
  <div class="url">github.com/SysAdminDoc/Cataclysm</div>
  <div class="chips"><span class="chip">Windows desktop</span><span class="chip">Local first</span></div>
</main></body></html>`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  for (const [name, html] of [["hero-candidate-a.png", candidateA], ["hero-candidate-b.png", candidateB]]) {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(candidateDir, name), animations: "disabled" });
  }

  const candidateAData = `data:image/png;base64,${(await readFile(path.join(candidateDir, "hero-candidate-a.png"))).toString("base64")}`;
  const candidateBData = `data:image/png;base64,${(await readFile(path.join(candidateDir, "hero-candidate-b.png"))).toString("base64")}`;
  await page.setViewportSize({ width: 1680, height: 560 });
  await page.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box; }
    html, body { width: 1680px; height: 560px; margin: 0; overflow: hidden; background: #03090f; color: #dceaf2; font-family: Inter, "Segoe UI", sans-serif; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 42px 28px 28px; }
    figure { margin: 0; }
    figcaption { margin-bottom: 12px; font-size: 18px; font-weight: 750; }
    img { display: block; width: 800px; height: 450px; border: 1px solid #24485b; border-radius: 10px; }
  </style></head><body><main>
    <figure><figcaption>Candidate A: editorial split</figcaption><img src="${candidateAData}" alt=""></figure>
    <figure><figcaption>Candidate B: product stage</figcaption><img src="${candidateBData}" alt=""></figure>
  </main></body></html>`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(comparisonDir, "hero-candidates.png"), animations: "disabled" });

  const beforeScreenshot = `data:image/png;base64,${(await readFile(path.join(conceptRoot, "before", "simulator-workspace-dark.png"))).toString("base64")}`;
  const currentScreenshot = `data:image/png;base64,${screenshot.toString("base64")}`;
  await page.setViewportSize({ width: 1680, height: 580 });
  await page.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box; }
    html, body { width: 1680px; height: 580px; margin: 0; overflow: hidden; background: #03090f; color: #dceaf2; font-family: Inter, "Segoe UI", sans-serif; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 34px 28px 28px; }
    figure { margin: 0; }
    figcaption { margin-bottom: 12px; font-size: 18px; font-weight: 750; }
    img { display: block; width: 800px; height: 500px; border: 1px solid #24485b; border-radius: 10px; }
  </style></head><body><main>
    <figure><figcaption>Before: stale product capture</figcaption><img src="${beforeScreenshot}" alt=""></figure>
    <figure><figcaption>After: current production capture</figcaption><img src="${currentScreenshot}" alt=""></figure>
  </main></body></html>`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(comparisonDir, "product-capture-before-after.png"), animations: "disabled" });
} finally {
  await browser.close();
}
