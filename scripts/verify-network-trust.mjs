import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sorted(values) {
  return [...new Set(values)].sort();
}

function remoteCspSources(csp, directiveName) {
  const part = csp.split(";").map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${directiveName} `));
  return sorted((part?.split(/\s+/).slice(1) ?? []).filter((entry) => entry.startsWith("https://")));
}

function originOf(url) {
  return new URL(url).origin;
}

export function patternCoversOrigin(pattern, origin) {
  const declared = new URL(pattern.replace("://*.", "://wildcard."));
  const actual = new URL(origin);
  if (declared.protocol !== actual.protocol || declared.port !== actual.port) return false;
  if (!declared.hostname.startsWith("wildcard.")) return declared.hostname === actual.hostname;
  const suffix = declared.hostname.slice("wildcard".length);
  return actual.hostname.endsWith(suffix) && actual.hostname.length > suffix.length;
}

export function originsReferencedByText(text) {
  return sorted([...text.matchAll(/https:\/\/[A-Za-z0-9.*-]+(?::\d+)?(?:\/[^\s"'`\\)]*)?/g)]
    .map((match) => match[0].replace(/[),.;]+$/, ""))
    .map(originOf));
}

export function browserNetworkOrigins(text) {
  const directCalls = [...text.matchAll(
    /(?:fetch|fetchImpl|sendBeacon)\s*\(\s*["'`](https:\/\/[^"'`\s)]+)|new\s+(?:WebSocket|EventSource)\s*\(\s*["'`](https:\/\/[^"'`\s)]+)/g,
  )].flatMap((match) => [match[1], match[2]]).filter(Boolean);
  const endpointConstants = [...text.matchAll(
    /(?:export\s+)?const\s+[A-Z0-9_]*(?:ENDPOINT|FEED_URL|API_URL)[A-Z0-9_]*\s*=\s*["'`](https:\/\/[^"'`\s]+)["'`]/g,
  )].map((match) => match[1]);
  return sorted([...directCalls, ...endpointConstants].map(originOf));
}

function walk(directory, predicate) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      if (entry !== "__tests__") files.push(...walk(absolute, predicate));
    } else if (predicate(absolute)) {
      files.push(absolute);
    }
  }
  return files;
}

function productionRust(text) {
  const testModule = text.search(/\n\s*#\[cfg\(test\)\]\s*\n\s*mod\s+tests\s*\{/);
  return testModule < 0 ? text : text.slice(0, testModule);
}

function setDiff(left, right) {
  const rightSet = new Set(right);
  return left.filter((entry) => !rightSet.has(entry));
}

function covered(origin, patterns) {
  return patterns.some((pattern) => patternCoversOrigin(pattern, origin));
}

export function verifyNetworkTrust(repoRoot = defaultRepoRoot) {
  const failures = [];
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "src/data/network-trust.json"), "utf8"));
  const tauriConfig = JSON.parse(readFileSync(path.join(repoRoot, "src-tauri/tauri.conf.json"), "utf8"));
  const earthRegistry = JSON.parse(readFileSync(path.join(repoRoot, "src/data/earth-assets.json"), "utf8"));
  const destinations = Array.isArray(manifest.destinations) ? manifest.destinations : [];
  const webDestinations = destinations.filter((entry) => entry.authority === "webview-csp");
  const nativeDestinations = destinations.filter((entry) => entry.authority === "native-https-bridge");
  const webPatterns = sorted(webDestinations.flatMap((entry) => entry.origins ?? []));
  const nativePatterns = sorted(nativeDestinations.flatMap((entry) => entry.origins ?? []));
  const cspSources = remoteCspSources(tauriConfig?.app?.security?.csp ?? "", "connect-src");

  for (const origin of setDiff(cspSources, webPatterns)) failures.push(`CSP origin is not disclosed: ${origin}`);
  for (const origin of setDiff(webPatterns, cspSources)) failures.push(`Disclosed WebView origin is absent from connect-src: ${origin}`);
  for (const origin of nativePatterns.filter((entry) => covered(entry, cspSources))) {
    failures.push(`Native-only origin is also granted to the WebView: ${origin}`);
  }

  const onlineProviders = earthRegistry.providers.filter((provider) => provider.capabilities?.online);
  const declaredProviderIds = sorted(webDestinations.flatMap((entry) => entry.earth_provider_ids ?? []));
  const onlineProviderIds = sorted(onlineProviders.map((provider) => provider.id));
  for (const id of setDiff(onlineProviderIds, declaredProviderIds)) failures.push(`Online Earth provider is not disclosed: ${id}`);
  for (const id of setDiff(declaredProviderIds, onlineProviderIds)) failures.push(`Disclosed Earth provider is not online or does not exist: ${id}`);
  for (const provider of onlineProviders) {
    for (const origin of provider.endpoint_origins ?? []) {
      if (!covered(origin, webPatterns)) failures.push(`Earth provider origin is not disclosed: ${origin}`);
    }
  }

  const sourceRoot = path.join(repoRoot, "src");
  const browserFiles = walk(sourceRoot, (file) => /\.(?:ts|tsx)$/.test(file));
  const networkPrimitive = /\bfetch(?:Impl)?\s*\(|new\s+(?:WebSocket|EventSource|XMLHttpRequest)\b|sendBeacon\s*\(/;
  for (const file of browserFiles) {
    const text = readFileSync(file, "utf8");
    if (!networkPrimitive.test(text) && !file.endsWith(`${path.sep}globe-styles.ts`)) continue;
    const referencedOrigins = file.endsWith(`${path.sep}globe-styles.ts`)
      ? originsReferencedByText(text)
      : browserNetworkOrigins(text);
    for (const origin of referencedOrigins) {
      if (!covered(origin, webPatterns)) {
        failures.push(`${path.relative(repoRoot, file)} references undeclared WebView origin: ${origin}`);
      }
    }
  }

  const rustRoot = path.join(repoRoot, "src-tauri/src");
  const rustFiles = walk(rustRoot, (file) => file.endsWith(".rs"));
  const nativeOrigins = [];
  for (const file of rustFiles) {
    const text = productionRust(readFileSync(file, "utf8"));
    if (!text.includes("reqwest::Client")) continue;
    const origins = originsReferencedByText(text);
    if (origins.length === 0) failures.push(`${path.relative(repoRoot, file)} uses reqwest without a fixed HTTPS origin`);
    nativeOrigins.push(...origins);
    for (const origin of origins) {
      if (!covered(origin, nativePatterns)) {
        failures.push(`${path.relative(repoRoot, file)} references undeclared native origin: ${origin}`);
      }
    }
  }
  for (const origin of setDiff(nativePatterns, sorted(nativeOrigins))) failures.push(`Disclosed native origin is not referenced by a native client: ${origin}`);

  return sorted(failures);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = verifyNetworkTrust();
  if (failures.length > 0) {
    console.error("Network trust contract failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Network trust contract verified: CSP, Earth providers, and native clients match the offline disclosure.");
}
