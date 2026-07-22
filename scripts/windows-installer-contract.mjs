import path from "node:path";

export const WINDOWS_INSTALLER_VARIANTS = Object.freeze(["standard", "offline"]);
export const WINDOWS_INSTALLER_FORMATS = Object.freeze(["msi", "nsis"]);
export const STANDARD_WEBVIEW_INSTALL_MODE = "downloadBootstrapper";
export const OFFLINE_WEBVIEW_INSTALL_MODE = "offlineInstaller";
export const WEBVIEW_RUNTIME_SERVICING = "evergreen";
export const MIN_OFFLINE_INSTALLER_OVERHEAD_BYTES = 80 * 1024 * 1024;

export function classifyWindowsInstaller(filePath) {
  const fileName = path.basename(filePath);
  const lowerName = fileName.toLowerCase();
  const format = lowerName.endsWith(".msi")
    ? "msi"
    : lowerName.endsWith("-setup.exe")
      ? "nsis"
      : null;
  if (!format) return null;
  const variant = /(?:^|[_-])offline(?:[_-]|\.|$)/i.test(fileName) ? "offline" : "standard";
  return {
    format,
    variant,
    webview_install_mode: variant === "offline"
      ? OFFLINE_WEBVIEW_INSTALL_MODE
      : STANDARD_WEBVIEW_INSTALL_MODE,
    requires_network_for_missing_runtime: variant !== "offline",
    runtime_servicing: WEBVIEW_RUNTIME_SERVICING,
  };
}

export function offlineInstallerName(filePath) {
  const classification = classifyWindowsInstaller(filePath);
  if (!classification) throw new Error(`Unsupported Windows installer name: ${filePath}`);
  const fileName = path.basename(filePath);
  if (classification.variant === "offline") return fileName;
  return classification.format === "msi"
    ? fileName.replace(/\.msi$/i, "_offline.msi")
    : fileName.replace(/-setup\.exe$/i, "_offline-setup.exe");
}

export function validateWindowsInstallerConfigs(standardConfig, offlineConfig) {
  const standardMode = standardConfig?.bundle?.windows?.webviewInstallMode?.type;
  const offlineMode = offlineConfig?.bundle?.windows?.webviewInstallMode?.type;
  if (standardMode !== STANDARD_WEBVIEW_INSTALL_MODE) {
    throw new Error(`Standard installer must use ${STANDARD_WEBVIEW_INSTALL_MODE}; found ${standardMode ?? "unset"}.`);
  }
  if (offlineMode !== OFFLINE_WEBVIEW_INSTALL_MODE) {
    throw new Error(`Offline installer must use ${OFFLINE_WEBVIEW_INSTALL_MODE}; found ${offlineMode ?? "unset"}.`);
  }
  const serialized = JSON.stringify({ standardConfig, offlineConfig });
  if (/fixed(?:Version|Runtime)/i.test(serialized)) {
    throw new Error("Windows installer configs must retain Evergreen servicing and cannot bundle a fixed WebView2 runtime.");
  }
  return {
    standard: STANDARD_WEBVIEW_INSTALL_MODE,
    offline: OFFLINE_WEBVIEW_INSTALL_MODE,
    runtime_servicing: WEBVIEW_RUNTIME_SERVICING,
  };
}

export function assertWindowsInstallerMatrix(artifacts, options = {}) {
  const minimumOverhead = options.minimumOverhead ?? MIN_OFFLINE_INSTALLER_OVERHEAD_BYTES;
  const matrix = new Map();
  for (const artifact of artifacts) {
    const classification = classifyWindowsInstaller(artifact.path);
    if (!classification) continue;
    const key = `${classification.format}:${classification.variant}`;
    if (matrix.has(key)) throw new Error(`Duplicate Windows installer variant: ${key}.`);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
      throw new Error(`Windows installer ${artifact.path} has an invalid byte size.`);
    }
    matrix.set(key, { ...artifact, ...classification });
  }
  for (const format of WINDOWS_INSTALLER_FORMATS) {
    for (const variant of WINDOWS_INSTALLER_VARIANTS) {
      const key = `${format}:${variant}`;
      if (!matrix.has(key)) throw new Error(`Missing Windows installer variant: ${key}.`);
    }
    const standard = matrix.get(`${format}:standard`);
    const offline = matrix.get(`${format}:offline`);
    const overhead = offline.bytes - standard.bytes;
    if (overhead < minimumOverhead) {
      throw new Error(
        `${format.toUpperCase()} offline installer adds ${overhead} bytes; expected at least ${minimumOverhead} bytes for the embedded Evergreen payload.`,
      );
    }
  }
  return [...matrix.values()].sort((left, right) => {
    const formatOrder = WINDOWS_INSTALLER_FORMATS.indexOf(left.format) - WINDOWS_INSTALLER_FORMATS.indexOf(right.format);
    return formatOrder || WINDOWS_INSTALLER_VARIANTS.indexOf(left.variant) - WINDOWS_INSTALLER_VARIANTS.indexOf(right.variant);
  });
}

export function formatWindowsInstallerChecksums(installers) {
  const rows = installers.map((installer) => {
    if (!/^[a-f0-9]{64}$/i.test(installer.sha256 ?? "")) {
      throw new Error(`Windows installer ${installer.path} is missing a SHA-256 digest.`);
    }
    const relative = String(installer.path).replaceAll("\\", "/");
    if (relative.startsWith("/") || relative.split("/").some((segment) => segment === "..")) {
      throw new Error(`Windows installer checksum path is unsafe: ${installer.path}.`);
    }
    return `${installer.sha256.toLowerCase()}  ${relative}`;
  });
  return `${rows.sort((left, right) => left.localeCompare(right, "en")).join("\n")}\n`;
}
