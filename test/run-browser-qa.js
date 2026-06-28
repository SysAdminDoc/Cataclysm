#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'test-artifacts', 'browser-qa');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveFile(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer(serveFile);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/` });
    });
  });
}

async function dismissWelcome(page) {
  const dismiss = page.locator('#welcome-dismiss');
  if (await dismiss.isVisible()) await dismiss.click();
}

async function runViewport(browser, baseUrl, name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const consoleMessages = [];
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type())) consoleMessages.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', err => consoleMessages.push(`pageerror: ${err.message}`));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await dismissWelcome(page);

  const title = await page.title();
  const appShellPresent = await page.locator('#map, #panel, #detonate-btn').count();
  const overlayVisible = await page.locator('text=/Vite|Webpack|Next\\.js|Error:/i').count();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const activeTab = await page.locator('.tab.active').getAttribute('aria-selected');

  await page.locator('[data-tab="effects"]').click();
  const effectsSelected = await page.locator('[data-tab="effects"]').getAttribute('aria-selected');
  await page.locator('[data-tab="tools"]').click();
  await page.locator('label.toggle-row:has(#hc-check)').click();
  await page.locator('label.toggle-row:has(#educator-check)').click();
  const highContrast = await page.evaluate(() => document.documentElement.classList.contains('high-contrast'));
  const reducedMotion = await page.evaluate(() => window.NM?.Animation?._reducedMotion === true);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}.png`), fullPage: false });
  await context.close();

  return {
    name,
    title,
    bodyHasApp: appShellPresent === 3,
    overlayVisible,
    horizontalOverflow,
    activeTab,
    effectsSelected,
    highContrast,
    reducedMotion,
    consoleMessages,
  };
}

async function runPwaChecks(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const consoleMessages = [];
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type())) consoleMessages.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', err => consoleMessages.push(`pageerror: ${err.message}`));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await dismissWelcome(page);
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const response = await fetch(link.href);
    return response.ok ? response.json() : null;
  });
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.getRegistrations().then(regs => regs.length > 0);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const offlineTitle = await page.title();
  const offlineAppShellPresent = await page.locator('#map, #panel, #detonate-btn').count();
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'offline.png'), fullPage: false });
  await context.close();

  return {
    manifest,
    swReady,
    offlineTitle,
    offlineBodyHasApp: offlineAppShellPresent === 3,
    consoleMessages,
  };
}

(async () => {
  fs.rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const { server, baseUrl } = await startServer();
  const browser = await chromium.launch();
  const failures = [];
  try {
    const desktop = await runViewport(browser, baseUrl, 'desktop', { width: 1366, height: 900 });
    const mobile = await runViewport(browser, baseUrl, 'mobile', { width: 390, height: 844 });
    const pwa = await runPwaChecks(browser, baseUrl);

    for (const result of [desktop, mobile]) {
      if (result.title !== 'NukeMap v3.6.0') failures.push(`${result.name}: page title mismatch`);
      if (!result.bodyHasApp) failures.push(`${result.name}: app content missing`);
      if (result.overlayVisible) failures.push(`${result.name}: framework/error overlay text visible`);
      if (result.horizontalOverflow) failures.push(`${result.name}: horizontal overflow detected`);
      if (result.activeTab !== 'true' || result.effectsSelected !== 'true') failures.push(`${result.name}: tab aria state failed`);
      if (!result.highContrast) failures.push(`${result.name}: high contrast toggle did not update body class`);
      if (!result.reducedMotion) failures.push(`${result.name}: educator mode did not enable reduced motion`);
      if (result.consoleMessages.length) failures.push(`${result.name}: console messages: ${result.consoleMessages.join(' | ')}`);
    }

    if (!pwa.manifest || pwa.manifest.name !== 'NukeMap') failures.push('pwa: manifest missing or wrong name');
    if (!pwa.manifest?.icons?.length) failures.push('pwa: manifest icons missing');
    if (!pwa.swReady) failures.push('pwa: service worker registration not ready');
    if (pwa.offlineTitle !== 'NukeMap v3.6.0' || !pwa.offlineBodyHasApp) failures.push('pwa: offline reload did not serve app shell');
    if (pwa.consoleMessages.length) failures.push(`pwa: console messages: ${pwa.consoleMessages.join(' | ')}`);

    const results = { baseUrl, screenshots: ARTIFACT_DIR, desktop, mobile, pwa, failures };
    console.log(JSON.stringify(results, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})();
