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
  await page.locator('#loading-overlay').waitFor({state: 'hidden'}).catch(() => {});

  const title = await page.title();
  const appShellPresent = await page.locator('#map, #panel, #detonate-btn').count();
  const overlayVisible = await page.locator('text=/Vite|Webpack|Next\\.js|Error:/i').count();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const activeTab = await page.locator('.tab.active').getAttribute('aria-selected');
  const shellLayout = await page.evaluate(() => {
    const panel = document.querySelector('#panel');
    const activePanel = document.querySelector('.tab-content.active');
    const detonate = document.querySelector('#detonate-btn');
    const topbar = document.querySelector('#app-topbar');
    const visible = el => el && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    const topbarRect = topbar?.getBoundingClientRect();
    return {
      panelVisible: visible(panel),
      activePanelVisible: visible(activePanel),
      detonateHeight: detonate?.getBoundingClientRect().height || 0,
      topbarFits: !visible(topbar) || (topbarRect.left >= panel.getBoundingClientRect().right - 1 && topbarRect.right <= innerWidth + 1),
      overflowSources: [...document.querySelectorAll('body *')].filter(el => {
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        return style.display !== 'none' && rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1 || el.scrollWidth > el.clientWidth + 1);
      }).slice(0, 12).map(el => el.id ? `#${el.id}` : `.${String(el.className).trim().split(/\\s+/).join('.')}`),
    };
  });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}-default.png`), fullPage: false });

  await page.locator('[data-tab="effects"]').click();
  const effectsSelected = await page.locator('[data-tab="effects"]').getAttribute('aria-selected');
  await page.locator('[data-tab="tools"]').click();
  await page.locator('label.toggle-row:has(#hc-check)').click();
  await page.locator('label.toggle-row:has(#educator-check)').click();
  const highContrast = await page.evaluate(() => document.documentElement.classList.contains('high-contrast'));
  const reducedMotion = await page.evaluate(() => window.NM?.Animation?._reducedMotion === true);
  const highContrastShell = await page.evaluate(() => {
    const panel = document.querySelector('#panel'), content = document.querySelector('#panel-content');
    const brand = document.querySelector('.brand-text'), activePanel = document.querySelector('.tab-content.active'), tab = document.querySelector('.tab.active');
    const inspect = el => { const style = getComputedStyle(el), rect = el.getBoundingClientRect(); return {text: el.textContent.trim().slice(0, 40), display: style.display, visibility: style.visibility, opacity: style.opacity, color: style.color, width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left)}; };
    return {collapsed: panel.classList.contains('collapsed'), opacity: getComputedStyle(content).opacity, inert: content.inert, ariaHidden: content.getAttribute('aria-hidden'), brand: inspect(brand), activePanel: inspect(activePanel), activeTab: inspect(tab)};
  });

  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}-high-contrast.png`), fullPage: false });
  await context.close();

  return {
    name,
    title,
    bodyHasApp: appShellPresent === 3,
    overlayVisible,
    horizontalOverflow,
    shellLayout,
    activeTab,
    effectsSelected,
    highContrast,
    highContrastShell,
    reducedMotion,
    consoleMessages,
  };
}

async function runInteractionChecks(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const consoleMessages = [];
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type())) consoleMessages.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', err => consoleMessages.push(`pageerror: ${err.message}`));
  await page.goto(baseUrl, {waitUntil: 'networkidle'});
  await dismissWelcome(page);
  await page.locator('#loading-overlay').waitFor({state: 'hidden'}).catch(() => {});

  const initialYield = await page.locator('#yield-input').inputValue();
  const initialWeapon = await page.locator('#weapon-select option:checked').textContent();
  await page.locator('#topbar-model-select').selectOption('freeair');
  const syncedModel = await page.locator('#physics-model').inputValue();
  await page.locator('#detonate-btn').click();
  await page.waitForFunction(() => document.querySelector('#det-counter-num')?.textContent === '1');
  await page.waitForTimeout(1600);
  await page.screenshot({path: path.join(ARTIFACT_DIR, 'desktop-effects-after-detonation.png'), fullPage: false});
  await page.locator('[data-tab="weapon"]').click();
  await page.locator('#clear-btn').click();
  await page.waitForTimeout(500);
  const clearedCount = await page.locator('#det-counter-num').textContent();
  const undoVisible = await page.locator('.action-toast button', {hasText: 'Undo'}).isVisible();
  if (undoVisible) await page.locator('.action-toast button', {hasText: 'Undo'}).click();
  if (undoVisible) await page.waitForFunction(() => document.querySelector('#det-counter-num')?.textContent === '1', null, {timeout: 8000});
  const restoredCount = await page.locator('#det-counter-num').textContent();
  const mapContext = await page.locator('#map-context-card').isVisible();
  await context.close();
  return {initialYield, initialWeapon, syncedModel, clearedCount, undoVisible, restoredCount, mapContext, consoleMessages};
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
  await page.locator('#loading-overlay').waitFor({state: 'hidden', timeout: 6000}).catch(() => {});
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'offline.png'), fullPage: false });
  await context.close();

  return {
    manifest,
    swReady,
    offlineTitle,
    offlineBodyHasApp: offlineAppShellPresent === 3,
    screenshotForms: (manifest?.screenshots || []).map(s => s.form_factor).sort(),
    shortcutActions: (manifest?.shortcuts || []).map(s => new URL(s.url, baseUrl).searchParams.get('action')).sort(),
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
    const tablet = await runViewport(browser, baseUrl, 'tablet', { width: 1024, height: 768 });
    const mobile = await runViewport(browser, baseUrl, 'mobile', { width: 390, height: 844 });
    const landscape = await runViewport(browser, baseUrl, 'mobile-landscape', { width: 844, height: 390 });
    const interactions = await runInteractionChecks(browser, baseUrl);
    const pwa = await runPwaChecks(browser, baseUrl);

    for (const result of [desktop, tablet, mobile, landscape]) {
      if (result.title !== 'NukeMap v3.7.0') failures.push(`${result.name}: page title mismatch`);
      if (!result.bodyHasApp) failures.push(`${result.name}: app content missing`);
      if (result.overlayVisible) failures.push(`${result.name}: framework/error overlay text visible`);
      if (result.horizontalOverflow) failures.push(`${result.name}: horizontal overflow detected`);
      if (!result.shellLayout.panelVisible || !result.shellLayout.activePanelVisible) failures.push(`${result.name}: primary workspace is not visibly rendered`);
      if (result.shellLayout.detonateHeight < 44) failures.push(`${result.name}: primary action is below 44px`);
      if (!result.shellLayout.topbarFits) failures.push(`${result.name}: topbar overlaps or clips the workspace`);
      if (result.activeTab !== 'true' || result.effectsSelected !== 'true') failures.push(`${result.name}: tab aria state failed`);
      if (!result.highContrast) failures.push(`${result.name}: high contrast toggle did not update body class`);
      if (!result.reducedMotion) failures.push(`${result.name}: educator mode did not enable reduced motion`);
      if (result.consoleMessages.length) failures.push(`${result.name}: console messages: ${result.consoleMessages.join(' | ')}`);
    }

    if (!/^15(?:\.0+)?$/.test(interactions.initialYield) || !/15(?:\.0)? kT/i.test(interactions.initialWeapon)) failures.push('interaction: initial weapon and yield are inconsistent');
    if (interactions.syncedModel !== 'freeair') failures.push('interaction: topbar model selector did not sync the workspace model');
    if (interactions.clearedCount !== '0' || !interactions.undoVisible || interactions.restoredCount !== '1') failures.push('interaction: Clear All undo did not restore the detonation');
    if (!interactions.mapContext) failures.push('interaction: map context card is not visible on desktop');
    if (interactions.consoleMessages.length) failures.push(`interaction: console messages: ${interactions.consoleMessages.join(' | ')}`);

    if (!pwa.manifest || pwa.manifest.name !== 'NukeMap') failures.push('pwa: manifest missing or wrong name');
    if (!pwa.manifest?.icons?.length) failures.push('pwa: manifest icons missing');
    if (!pwa.screenshotForms.includes('wide') || !pwa.screenshotForms.includes('narrow')) failures.push('pwa: manifest screenshots missing wide/narrow forms');
    for (const action of ['detonate', 'guide', 'saved', 'ww3']) {
      if (!pwa.shortcutActions.includes(action)) failures.push(`pwa: shortcut action missing ${action}`);
    }
    if (!pwa.swReady) failures.push('pwa: service worker registration not ready');
    if (pwa.offlineTitle !== 'NukeMap v3.7.0' || !pwa.offlineBodyHasApp) failures.push('pwa: offline reload did not serve app shell');
    if (pwa.consoleMessages.length) failures.push(`pwa: console messages: ${pwa.consoleMessages.join(' | ')}`);

    const results = { baseUrl, screenshots: ARTIFACT_DIR, desktop, tablet, mobile, landscape, interactions, pwa, failures };
    console.log(JSON.stringify(results, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})();
