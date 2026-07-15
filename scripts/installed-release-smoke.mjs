#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultBundleRoot = path.join(repoRoot, "src-tauri", "target", "release", "bundle");
const PRODUCT_NAME = "Cataclysm";
const EXECUTABLE_NAME = "cataclysm.exe";
const WEBDRIVER_ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";
const KEYCHAIN_SENTINEL = "cataclysm-installed-release-smoke-sentinel";
let webdriverSessionSequence = 0;
const REGISTRY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$roots = @(
  'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$items = @()
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
    $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
    if ($entry.DisplayName -eq 'Cataclysm') {
      $items += [pscustomobject]@{
        DisplayName = [string]$entry.DisplayName
        DisplayVersion = [string]$entry.DisplayVersion
        InstallLocation = [string]$entry.InstallLocation
        UninstallString = [string]$entry.UninstallString
        QuietUninstallString = [string]$entry.QuietUninstallString
        RegistryPath = [string]$key.Name
      }
    }
  }
}
ConvertTo-Json -Compress -InputObject @($items)
`;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateNativePanicRecord(record, expectedVersion) {
  invariant(record && typeof record === "object", "Native panic fixture did not emit an object record.");
  invariant(record.schema_version === 1, `Unexpected native panic schema ${record.schema_version}.`);
  invariant(/^record-[A-Za-z0-9-]{1,89}$/.test(record.id), "Native panic record id is invalid.");
  invariant(record.app_version === expectedVersion, `Native panic record version ${record.app_version} does not match ${expectedVersion}.`);
  invariant(Number.isSafeInteger(record.timestamp_ms) && record.timestamp_ms > 0, "Native panic timestamp is invalid.");
  invariant(typeof record.message === "string" && record.message.length > 0 && record.message.length <= 513,
    "Native panic message is missing or oversized.");
  invariant(
    !/(?:access[_-]?token|api[_-]?key|authorization|bearer\s|password|secret|scenario|request|environment|[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|workspace)\/)/i.test(record.message),
    "Native panic record exposed sensitive context.",
  );
  invariant(record.location === null || (
    record.location
    && typeof record.location.file === "string"
    && /^[^\\/]{1,128}$/.test(record.location.file)
    && Number.isSafeInteger(record.location.line)
    && Number.isSafeInteger(record.location.column)
  ), "Native panic location is invalid or contains a path.");
  return record;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function cleanQuotedPath(value) {
  return String(value ?? "").trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "");
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeRemoveTree(parent, target) {
  invariant(isInside(parent, target), `Refusing to remove a path outside ${parent}: ${target}`);
  rmSync(target, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    windowsHide: true,
    timeout: options.timeoutMs ?? 180_000,
  });
  if (result.error) throw result.error;
  const accepted = options.acceptedCodes ?? [0];
  if (!accepted.includes(result.status)) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `${path.basename(command)} exited with code ${result.status}` + (detail ? `:\n${sanitizeLog(detail)}` : "."),
    );
  }
  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function executableFromPath(name, explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    invariant(existsSync(resolved), `${name} does not exist at ${resolved}.`);
    return resolved;
  }
  const found = spawnSync("where.exe", [name], {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  const first = found.status === 0 ? found.stdout.split(/\r?\n/).find(Boolean) : null;
  invariant(first && existsSync(first), `${name} is required on PATH.`);
  return first;
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(absolute) : [absolute];
  });
}

export function parseRegistryOutput(output) {
  const trimmed = String(output ?? "").trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  if (parsed === null) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function installerRegistryEntries() {
  const result = run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    REGISTRY_SCRIPT,
  ]);
  return parseRegistryOutput(result.stdout);
}

function cataclysmProcessRunning() {
  const result = spawnSync("tasklist.exe", [
    "/FI",
    `IMAGENAME eq ${EXECUTABLE_NAME}`,
    "/FO",
    "CSV",
    "/NH",
  ], {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  return result.status === 0 && /"cataclysm\.exe"/i.test(result.stdout);
}

export function assertCleanMachineState({ entries, processRunning, knownInstallPaths = [] }) {
  const occupiedPaths = knownInstallPaths.filter((candidate) => candidate && existsSync(candidate));
  const problems = [];
  if (entries.length > 0) problems.push(`${entries.length} registered ${PRODUCT_NAME} installation(s)`);
  if (processRunning) problems.push(`a running ${EXECUTABLE_NAME} process`);
  if (occupiedPaths.length > 0) problems.push(`${occupiedPaths.length} existing install path(s)`);
  invariant(
    problems.length === 0,
    `Installed release smoke requires a clean disposable Windows host; found ${problems.join(", ")}.`,
  );
}

export function assertInstalledSmokeHost(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== "win32") return { required: false, reason: "Windows installers are not emitted on this platform." };
  invariant(
    env.CATACLYSM_INSTALL_SMOKE_ISOLATED === "1",
    "Installed release smoke is destructive and requires CATACLYSM_INSTALL_SMOKE_ISOLATED=1 on a disposable Windows profile or VM.",
  );
  const knownInstallPaths = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", PRODUCT_NAME),
    env.ProgramFiles && path.join(env.ProgramFiles, PRODUCT_NAME),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], PRODUCT_NAME),
  ].filter(Boolean);
  const entries = options.entries ?? installerRegistryEntries();
  const processRunning = options.processRunning ?? cataclysmProcessRunning();
  assertCleanMachineState({ entries, processRunning, knownInstallPaths });
  return { required: true };
}

export function findWindowsInstallers(bundleRoot = defaultBundleRoot) {
  const files = listFiles(bundleRoot);
  const msi = files.filter((file) => /[\\/]msi[\\/].+\.msi$/i.test(file));
  const nsis = files.filter((file) => /[\\/]nsis[\\/].+-setup\.exe$/i.test(file));
  invariant(msi.length === 1, `Expected exactly one MSI installer, found ${msi.length}.`);
  invariant(nsis.length === 1, `Expected exactly one NSIS installer, found ${nsis.length}.`);
  return [
    { kind: "msi", installerPath: msi[0] },
    { kind: "nsis", installerPath: nsis[0] },
  ];
}

export function sanitizeLog(value, home = os.homedir()) {
  let sanitized = String(value ?? "");
  const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escapedHome) sanitized = sanitized.replace(new RegExp(escapedHome, "gi"), "<home>");
  sanitized = sanitized
    .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, "https://<credentials>@")
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\r\n"']+/g, "<path>");
  return sanitized;
}

export function runtimeErrorLines(lines) {
  const suspicious = /(?:ERR_[A-Z_]+|protocol error|renderer (?:process )?(?:crash|fail|unresponsive)|render process (?:crash|fail)|ipc (?:channel )?(?:error|fail|closed)|channel (?:error|closed))/i;
  return lines
    .flatMap((line) => String(line).split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line && suspicious.test(line));
}

function waitForRegistryEntry(expectedCount, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let entries = [];
  do {
    entries = installerRegistryEntries();
    if (entries.length === expectedCount) return entries;
    sleepSync(500);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${expectedCount} registered ${PRODUCT_NAME} installation(s); found ${entries.length}.`);
}

function installPackage(pkg, installRoot, tempRoot) {
  mkdirSync(installRoot, { recursive: true });
  if (pkg.kind === "msi") {
    const logPath = path.join(tempRoot, "msi-install.log");
    run("msiexec.exe", [
      "/i",
      pkg.installerPath,
      "/qn",
      "/norestart",
      `INSTALLDIR=${installRoot}`,
      "/L*V",
      logPath,
    ], { timeoutMs: 300_000, acceptedCodes: [0, 3010] });
  } else {
    run(pkg.installerPath, ["/S", `/D=${installRoot}`], { timeoutMs: 300_000 });
  }
  const entries = waitForRegistryEntry(1);
  const registeredLocation = cleanQuotedPath(entries[0].InstallLocation);
  const executablePath = [
    registeredLocation && path.join(registeredLocation, EXECUTABLE_NAME),
    path.join(installRoot, EXECUTABLE_NAME),
  ].find((candidate) => candidate && existsSync(candidate));
  invariant(executablePath, `${pkg.kind.toUpperCase()} registered but ${EXECUTABLE_NAME} is missing.`);
  return { entry: entries[0], executablePath };
}

function uninstallPackage(pkg, installRoot, tempRoot, entry) {
  if (cataclysmProcessRunning()) {
    run("taskkill.exe", ["/F", "/T", "/IM", EXECUTABLE_NAME], { acceptedCodes: [0, 128] });
  }
  if (pkg.kind === "msi") {
    run("msiexec.exe", [
      "/x",
      pkg.installerPath,
      "/qn",
      "/norestart",
      "/L*V",
      path.join(tempRoot, "msi-uninstall.log"),
    ], { timeoutMs: 300_000, acceptedCodes: [0, 1605, 3010] });
  } else {
    const uninstallFromEntry = cleanQuotedPath(String(entry?.QuietUninstallString || entry?.UninstallString || "").split('" ')[0]);
    const uninstaller = [
      uninstallFromEntry,
      path.join(installRoot, "uninstall.exe"),
    ].find((candidate) => candidate && existsSync(candidate));
    invariant(uninstaller, "NSIS uninstaller is missing after installation.");
    run(uninstaller, ["/S"], { timeoutMs: 300_000 });
  }
  waitForRegistryEntry(0);
  const deadline = Date.now() + 30_000;
  while (existsSync(path.join(installRoot, EXECUTABLE_NAME)) && Date.now() < deadline) sleepSync(500);
  invariant(!existsSync(path.join(installRoot, EXECUTABLE_NAME)), `${pkg.kind.toUpperCase()} left the installed binary behind.`);
  invariant(!cataclysmProcessRunning(), `${EXECUTABLE_NAME} is still running after uninstall.`);
}

function probeInstalledBinary(executablePath, expectedVersion, tempRoot) {
  const outputPath = path.join(tempRoot, "installed-release-probe.json");
  run(executablePath, ["--release-probe", outputPath], { timeoutMs: 120_000 });
  invariant(existsSync(outputPath), "Installed binary did not write its release probe.");
  const probe = JSON.parse(readFileSync(outputPath, "utf8"));
  invariant(probe.version === expectedVersion, `Installed version ${probe.version} does not match ${expectedVersion}.`);
  invariant(probe.gpu_feature === true, "Installed binary was built without the required GPU feature.");
  invariant(["available", "no-adapter"].includes(probe.gpu_status), `Unexpected installed GPU status: ${probe.gpu_status}.`);
  return probe;
}

function exerciseNativePanicFixture(executablePath, expectedVersion, directory) {
  mkdirSync(directory, { recursive: true });
  const result = spawnSync(executablePath, ["--native-panic-fixture", directory], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CATACLYSM_INSTALL_SMOKE_ISOLATED: "1",
      CATACLYSM_NATIVE_PANIC_FIXTURE: "1",
      CATACLYSM_NATIVE_DIAGNOSTICS_DIR: directory,
    },
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
    windowsHide: true,
  });
  invariant(!result.error, `Native panic fixture failed to execute: ${result.error?.message}`);
  invariant(result.status !== 0 && result.status !== null, "Native panic fixture did not preserve a failing exit.");
  const files = readdirSync(directory).filter((name) => name.endsWith(".json"));
  invariant(files.length === 1, `Native panic fixture emitted ${files.length} active records; expected one.`);
  const recordPath = path.join(directory, files[0]);
  invariant(statSync(recordPath).size <= 4 * 1024, "Native panic fixture record exceeds 4 KiB.");
  return validateNativePanicRecord(JSON.parse(readFileSync(recordPath, "utf8")), expectedVersion);
}

function waitForPort(port, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (child.exitCode !== null) {
        reject(new Error(`tauri-driver exited with code ${child.exitCode} before accepting connections.`));
        return;
      }
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) reject(new Error(`Timed out waiting for tauri-driver on port ${port}.`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function webdriverRequest(baseUrl, method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({ value: { error: "invalid response", message: response.statusText } }));
  if (!response.ok || payload?.value?.error) {
    const error = payload?.value?.message ?? payload?.value?.error ?? response.statusText;
    throw new Error(`WebDriver ${method} ${endpoint} failed: ${error}`);
  }
  return payload.value;
}

async function createSession(baseUrl, application) {
  const value = await webdriverRequest(baseUrl, "POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "wry",
        "tauri:options": { application },
      },
    },
  });
  const sessionId = value?.sessionId ?? value?.[WEBDRIVER_ELEMENT_KEY] ?? value;
  invariant(typeof sessionId === "string" && sessionId, "WebDriver did not return a session id.");
  await webdriverRequest(baseUrl, "POST", `/session/${sessionId}/timeouts`, {
    implicit: 0,
    pageLoad: 60_000,
    script: 60_000,
  });
  return sessionId;
}

async function execute(baseUrl, sessionId, script, args = []) {
  return webdriverRequest(baseUrl, "POST", `/session/${sessionId}/execute/sync`, { script, args });
}

async function executeAsync(baseUrl, sessionId, script, args = []) {
  return webdriverRequest(baseUrl, "POST", `/session/${sessionId}/execute/async`, { script, args });
}

async function waitFor(check, message, timeoutMs = 30_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const detail = last instanceof Error ? ` Last error: ${last.message}` : "";
  throw new Error(`${message}${detail}`);
}

const CLICK_TEXT_SCRIPT = `
const [selector, expected, exact] = arguments;
const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
const target = normalize(expected);
const elements = Array.from(document.querySelectorAll(selector));
const element = elements.find((candidate) => {
  const text = normalize(candidate.innerText || candidate.textContent);
  const visible = candidate.getClientRects().length > 0 && getComputedStyle(candidate).visibility !== 'hidden';
  return visible && (exact ? text === target : text.includes(target));
});
if (!element) return { ok: false, reason: 'missing' };
if (element.disabled || element.getAttribute('aria-disabled') === 'true') return { ok: false, reason: 'disabled' };
element.click();
return { ok: true };
`;

async function clickText(baseUrl, sessionId, selector, text, exact = true, timeoutMs = 30_000) {
  return waitFor(async () => {
    const result = await execute(baseUrl, sessionId, CLICK_TEXT_SCRIPT, [selector, text, exact]);
    return result?.ok ? result : false;
  }, `Timed out clicking ${selector} with text ${JSON.stringify(text)}.`, timeoutMs);
}

async function optionalClickText(baseUrl, sessionId, selector, text, timeoutMs = 2_000) {
  try {
    await clickText(baseUrl, sessionId, selector, text, true, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

async function waitForText(baseUrl, sessionId, text, timeoutMs = 30_000) {
  return waitFor(async () => execute(
    baseUrl,
    sessionId,
    "return (document.body?.innerText || '').includes(arguments[0]);",
    [text],
  ), `Timed out waiting for page text ${JSON.stringify(text)}.`, timeoutMs);
}

async function dismissFirstRun(baseUrl, sessionId) {
  await waitFor(async () => execute(
    baseUrl,
    sessionId,
    "return document.readyState === 'complete' && Boolean(document.body);",
  ), "Installed app did not finish loading.", 60_000);
  await optionalClickText(baseUrl, sessionId, "button", "Skip intro", 15_000);
  await optionalClickText(baseUrl, sessionId, "button", "I understand", 15_000);
  await waitFor(async () => execute(
    baseUrl,
    sessionId,
    "return Boolean(document.querySelector('.app')) && !document.querySelector('.launch-experience');",
  ), "Installed app shell did not become ready.", 60_000);
}

async function installRuntimeErrorHooks(baseUrl, sessionId) {
  await execute(baseUrl, sessionId, `
    window.__cataclysmInstalledSmoke = { errors: [] };
    const format = (value) => {
      if (value instanceof Error) return value.stack || value.message;
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    };
    window.addEventListener('error', (event) => {
      window.__cataclysmInstalledSmoke.errors.push('error: ' + format(event.error || event.message));
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.__cataclysmInstalledSmoke.errors.push('unhandledrejection: ' + format(event.reason));
    });
    const originalError = console.error.bind(console);
    console.error = (...values) => {
      window.__cataclysmInstalledSmoke.errors.push('console.error: ' + values.map(format).join(' '));
      originalError(...values);
    };
    return true;
  `);
}

async function openSettings(baseUrl, sessionId) {
  await clickText(baseUrl, sessionId, "button", "Export", true);
  await clickText(baseUrl, sessionId, "button", "Settings", true);
  await waitFor(async () => execute(
    baseUrl,
    sessionId,
    "return Boolean(document.querySelector('.modal--settings[data-loading=\"false\"]'));",
  ), "Settings did not finish loading.", 60_000);
}

async function inputValueByLabel(baseUrl, sessionId, label) {
  return execute(baseUrl, sessionId, `
    const expected = arguments[0];
    const field = Array.from(document.querySelectorAll('label')).find((candidate) =>
      (candidate.innerText || '').includes(expected)
    )?.querySelector('input');
    return field ? field.value : null;
  `, [label]);
}

async function setInputByLabel(baseUrl, sessionId, label, value) {
  const changed = await execute(baseUrl, sessionId, `
    const [expected, nextValue] = arguments;
    const field = Array.from(document.querySelectorAll('label')).find((candidate) =>
      (candidate.innerText || '').includes(expected)
    )?.querySelector('input');
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(field, nextValue);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `, [label, value]);
  invariant(changed, `Could not find input labelled ${label}.`);
}

async function applySettings(baseUrl, sessionId) {
  await clickText(baseUrl, sessionId, "button", "Apply Changes", true, 60_000);
  await waitForText(baseUrl, sessionId, "Changes applied at", 60_000);
  const alert = await execute(baseUrl, sessionId, "return document.querySelector('.modal--settings [role=alert]')?.innerText || ''; ");
  invariant(!alert, `Settings reported an error: ${alert}`);
}

async function keychainWriteSession(baseUrl, sessionId, expectedNativeRecord) {
  await dismissFirstRun(baseUrl, sessionId);
  await waitForText(baseUrl, sessionId, "A report from the previous failure is available.", 30_000);
  const imported = await execute(baseUrl, sessionId, `
    try { return JSON.parse(localStorage.getItem('tsunamisim.last_crash') || 'null'); }
    catch { return null; }
  `);
  invariant(imported?.source === "native-panic", "Installed app did not import the native panic into crash recovery.");
  invariant(imported?.nativeRecordId === expectedNativeRecord.id, "Installed app imported the wrong native panic record.");
  invariant(imported?.nativeAppVersion === expectedNativeRecord.app_version, "Installed app lost the native panic version.");
  invariant(imported?.seen === false, "Installed app marked the native panic reviewed before user review.");
  await installRuntimeErrorHooks(baseUrl, sessionId);
  await openSettings(baseUrl, sessionId);
  await setInputByLabel(baseUrl, sessionId, "Cesium ion token", KEYCHAIN_SENTINEL);
  await applySettings(baseUrl, sessionId);
  invariant(
    await inputValueByLabel(baseUrl, sessionId, "Cesium ion token") === KEYCHAIN_SENTINEL,
    "Settings did not retain the keychain sentinel after Apply.",
  );
  await clickText(baseUrl, sessionId, "button", "Cancel", true);
}

async function keychainReadAndClear(baseUrl, sessionId) {
  await dismissFirstRun(baseUrl, sessionId);
  await installRuntimeErrorHooks(baseUrl, sessionId);
  await openSettings(baseUrl, sessionId);
  const persisted = await inputValueByLabel(baseUrl, sessionId, "Cesium ion token");
  invariant(persisted === KEYCHAIN_SENTINEL, "Cesium token did not survive an installed-app restart through the OS keychain.");
  await setInputByLabel(baseUrl, sessionId, "Cesium ion token", "");
  await applySettings(baseUrl, sessionId);
  invariant(await inputValueByLabel(baseUrl, sessionId, "Cesium ion token") === "", "Keychain sentinel cleanup failed.");
  await clickText(baseUrl, sessionId, "button", "Cancel", true);
}

async function runTohokuJourney(baseUrl, sessionId, screenshotPath, expectedVersion) {
  await clickText(baseUrl, sessionId, "button.preset-card", "Tōhoku Earthquake & Tsunami", false, 60_000);
  await clickText(baseUrl, sessionId, "button", "Run & Watch", true, 60_000);
  await waitForText(baseUrl, sessionId, "60 frames ready", 300_000);
  await waitForText(baseUrl, sessionId, "60 / 60", 60_000);

  await clickText(baseUrl, sessionId, "button", "Export", true);
  await clickText(baseUrl, sessionId, "button", "Text", true);
  await waitForText(baseUrl, sessionId, "Saved text results.", 30_000);

  await clickText(baseUrl, sessionId, "button", "Diagnostics log", true);
  await waitForText(baseUrl, sessionId, "Local session diagnostics", 30_000);
  const errorCount = await execute(baseUrl, sessionId, `
    const value = document.querySelector('.log-viewer__summary [data-level="error"]')?.innerText || '';
    return Number.parseInt(value, 10);
  `);
  invariant(errorCount === 0, `Installed journey diagnostics contain ${errorCount} error(s).`);
  const diagnostics = await executeAsync(baseUrl, sessionId, `
    const done = arguments[arguments.length - 1];
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== 'function') { done({ error: 'Tauri invoke bridge missing' }); return; }
    invoke('diagnostics_bundle').then(done, (error) => done({ error: String(error) }));
  `);
  invariant(!diagnostics?.error, `Installed diagnostics IPC failed: ${diagnostics?.error}`);
  invariant(diagnostics?.app_version === expectedVersion, `Diagnostics returned app version ${diagnostics?.app_version}.`);
  await clickText(baseUrl, sessionId, "button", "Copy diagnostics", true);

  const screenshot = await webdriverRequest(baseUrl, "GET", `/session/${sessionId}/screenshot`);
  writeFileSync(screenshotPath, Buffer.from(screenshot, "base64"));
  invariant(statSync(screenshotPath).size > 10_000, "Installed journey screenshot is unexpectedly small.");

  const runtimeErrors = await execute(
    baseUrl,
    sessionId,
    "return window.__cataclysmInstalledSmoke?.errors || [];",
  );
  invariant(runtimeErrors.length === 0, `Installed WebView emitted runtime errors:\n${runtimeErrors.join("\n")}`);
  return {
    frames: 60,
    text_export: true,
    diagnostics: true,
    diagnostics_version: diagnostics.app_version,
    renderer_protocol_errors: 0,
  };
}

async function runWebdriverSession({
  application,
  tauriDriverPath,
  edgeDriverPath,
  profileRoot,
  preview,
  nativeDiagnosticsDir,
  action,
}) {
  const port = 4544 + webdriverSessionSequence * 2;
  const nativePort = port + 1;
  webdriverSessionSequence += 1;
  const stdout = [];
  const stderr = [];
  mkdirSync(profileRoot, { recursive: true });
  const env = {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: path.join(profileRoot, "webview2"),
    CATACLYSM_INSTALL_SMOKE_ISOLATED: "1",
    CATACLYSM_NATIVE_PANIC_FIXTURE: "1",
    CATACLYSM_NATIVE_DIAGNOSTICS_DIR: nativeDiagnosticsDir,
  };
  if (preview) env.WEBVIEW2_CHANNEL_SEARCH_KIND = "1";
  const driver = spawn(tauriDriverPath, [
    "--port",
    String(port),
    "--native-port",
    String(nativePort),
    "--native-driver",
    edgeDriverPath,
  ], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  driver.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  driver.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  let sessionId = null;
  try {
    await waitForPort(port, driver);
    sessionId = await createSession(baseUrl, application);
    const result = await action(baseUrl, sessionId);
    return { result, logs: [...stdout, ...stderr] };
  } catch (error) {
    const tail = sanitizeLog([...stdout, ...stderr].join("\n"))
      .split(/\r?\n/)
      .slice(-80)
      .join("\n");
    if (error instanceof Error && tail) error.message = `${error.message}\nLast tauri-driver output:\n${tail}`;
    throw error;
  } finally {
    if (sessionId) {
      await webdriverRequest(baseUrl, "DELETE", `/session/${sessionId}`).catch(() => undefined);
    }
    if (driver.exitCode === null) {
      spawnSync("taskkill.exe", ["/PID", String(driver.pid), "/T", "/F"], {
        encoding: "utf8",
        stdio: "pipe",
        windowsHide: true,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const closeDeadline = Date.now() + 10_000;
    while (cataclysmProcessRunning() && Date.now() < closeDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (cataclysmProcessRunning()) {
      run("taskkill.exe", ["/F", "/T", "/IM", EXECUTABLE_NAME], { acceptedCodes: [0, 128] });
    }
  }
}

async function exerciseInstalledApplication({
  executablePath,
  artifactRoot,
  profileRoot,
  preview,
  expectedVersion,
  nativeDiagnosticsDir,
  nativeRecord,
}) {
  const tauriDriverPath = executableFromPath("tauri-driver.exe", process.env.TAURI_DRIVER_PATH);
  const edgeDriverPath = executableFromPath("msedgedriver.exe", process.env.MSEDGEDRIVER_PATH);
  const allLogs = [];
  const write = await runWebdriverSession({
    application: executablePath,
    tauriDriverPath,
    edgeDriverPath,
    profileRoot,
    preview,
    nativeDiagnosticsDir,
    action: (baseUrl, sessionId) => keychainWriteSession(baseUrl, sessionId, nativeRecord),
  });
  allLogs.push(...write.logs);
  const journey = await runWebdriverSession({
    application: executablePath,
    tauriDriverPath,
    edgeDriverPath,
    profileRoot,
    preview,
    nativeDiagnosticsDir,
    action: async (baseUrl, sessionId) => {
      await keychainReadAndClear(baseUrl, sessionId);
      return runTohokuJourney(
        baseUrl,
        sessionId,
        path.join(artifactRoot, "tohoku-60-of-60.png"),
        expectedVersion,
      );
    },
  });
  allLogs.push(...journey.logs);
  await waitFor(
    () => readdirSync(nativeDiagnosticsDir).every((name) => !name.endsWith(".json")),
    "Native panic record remained active after explicit diagnostics review.",
    30_000,
  );
  const protocolErrors = runtimeErrorLines(allLogs);
  invariant(protocolErrors.length === 0, `tauri-driver/WebView2 emitted protocol errors:\n${protocolErrors.join("\n")}`);
  writeFileSync(path.join(artifactRoot, "webdriver.log"), `${sanitizeLog(allLogs.join("\n"))}\n`);
  return {
    ...journey.result,
    keychain_restart_roundtrip: true,
    native_panic_imported: true,
    native_panic_acknowledged: true,
    webview2_preview_preferred: preview,
  };
}

export async function runInstalledReleaseSmoke(options = {}) {
  const bundleRoot = path.resolve(options.bundleRoot ?? defaultBundleRoot);
  const expectedVersion = options.expectedVersion;
  invariant(typeof expectedVersion === "string" && expectedVersion, "expectedVersion is required.");
  const host = assertInstalledSmokeHost(options);
  if (!host.required) return { required: false, packages: [] };

  const packages = findWindowsInstallers(bundleRoot);
  const artifactRoot = path.join(bundleRoot, "installed-smoke");
  const installParent = path.join(bundleRoot, ".installed-smoke-roots");
  if (existsSync(artifactRoot)) safeRemoveTree(bundleRoot, artifactRoot);
  if (existsSync(installParent)) safeRemoveTree(bundleRoot, installParent);
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(installParent, { recursive: true });
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cataclysm-installed-smoke-"));
  const report = {
    schema_version: 1,
    version: expectedVersion,
    isolated_windows_host: true,
    webview2_preview_preferred: process.env.CATACLYSM_WEBVIEW2_PREVIEW === "1",
    packages: [],
  };
  let failure = null;
  try {
    for (const pkg of packages) {
      const packageArtifactRoot = path.join(artifactRoot, pkg.kind);
      const installRoot = path.join(installParent, pkg.kind);
      const profileRoot = path.join(tempRoot, `${pkg.kind}-profile`);
      const packageTempRoot = path.join(tempRoot, pkg.kind);
      mkdirSync(packageArtifactRoot, { recursive: true });
      mkdirSync(packageTempRoot, { recursive: true });
      let installed = null;
      try {
        installed = installPackage(pkg, installRoot, packageTempRoot);
        invariant(
          installed.entry.DisplayVersion === expectedVersion,
          `${pkg.kind.toUpperCase()} registered version ${installed.entry.DisplayVersion}, expected ${expectedVersion}.`,
        );
        const probe = probeInstalledBinary(installed.executablePath, expectedVersion, packageTempRoot);
        const nativeDiagnosticsDir = path.join(packageTempRoot, "native-diagnostics");
        const nativeRecord = exerciseNativePanicFixture(
          installed.executablePath,
          expectedVersion,
          nativeDiagnosticsDir,
        );
        const journey = await exerciseInstalledApplication({
          executablePath: installed.executablePath,
          artifactRoot: packageArtifactRoot,
          profileRoot,
          preview: report.webview2_preview_preferred,
          expectedVersion,
          nativeDiagnosticsDir,
          nativeRecord,
        });
        report.packages.push({
          kind: pkg.kind,
          installer: path.relative(bundleRoot, pkg.installerPath).replaceAll("\\", "/"),
          installed_version: installed.entry.DisplayVersion,
          capability_probe: probe,
          journey,
          uninstalled_cleanly: false,
        });
      } finally {
        const cleanupEntry = installed?.entry ?? installerRegistryEntries()[0] ?? null;
        if (cleanupEntry) {
          uninstallPackage(pkg, installRoot, packageTempRoot, cleanupEntry);
          const packageReport = report.packages.find((entry) => entry.kind === pkg.kind);
          if (packageReport) packageReport.uninstalled_cleanly = true;
        }
        if (existsSync(installRoot)) safeRemoveTree(installParent, installRoot);
      }
    }
  } catch (error) {
    failure = error;
    report.failure = sanitizeLog(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    if (existsSync(installParent)) safeRemoveTree(bundleRoot, installParent);
    if (existsSync(tempRoot)) safeRemoveTree(os.tmpdir(), tempRoot);
    writeFileSync(path.join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (failure) throw failure;
  invariant(report.packages.length === 2, "Installed smoke did not complete both Windows package formats.");
  invariant(report.packages.every((entry) => entry.uninstalled_cleanly), "At least one installer did not uninstall cleanly.");
  return report;
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation()) {
  const tauriConfig = JSON.parse(readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
  runInstalledReleaseSmoke({ bundleRoot: defaultBundleRoot, expectedVersion: tauriConfig.version })
    .then((report) => {
      console.log(`Installed release smoke passed for ${report.packages.length} package(s).`);
    })
    .catch((error) => {
      console.error(`Installed release smoke failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
