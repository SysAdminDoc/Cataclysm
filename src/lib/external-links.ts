import policy from "./external-link-policy.json";

type SettingsUrl = {
  id: string;
  reason: string;
  url: string;
};

type LegacyHttpException = {
  reason: string;
  url: string;
};

export type ExternalUrlValidation =
  | {
      legacyHttp: boolean;
      ok: true;
      reason?: string;
      url: string;
    }
  | {
      ok: false;
      reason: string;
    };

const settingsUrls = policy.settingsUrls as SettingsUrl[];
const citationHttpsUrls = new Set(policy.citationHttpsUrls);
const trustedHttpsUrls = new Set([
  ...settingsUrls.map((entry) => entry.url),
  ...policy.citationHttpsUrls,
]);
const legacyHttpExceptions = new Map(
  (policy.legacyHttpExceptions as LegacyHttpException[]).map((entry) => [entry.url, entry.reason]),
);

export const CESIUM_SIGNUP_URL =
  settingsUrls.find((entry) => entry.id === "cesiumSignup")?.url ?? "https://cesium.com/ion/signup";

export const CITATION_HTTPS_URLS = [...citationHttpsUrls];
export const CITATION_LEGACY_HTTP_EXCEPTIONS = [...legacyHttpExceptions].map(([url, reason]) => ({
  reason,
  url,
}));
export const TRUSTED_EXTERNAL_URLS = [
  ...trustedHttpsUrls,
  ...legacyHttpExceptions.keys(),
];

function parseUrl(rawUrl: string | null | undefined): URL | string {
  if (!rawUrl?.trim()) {
    return "External link has no URL.";
  }

  try {
    return new URL(rawUrl.trim());
  } catch {
    return "External link URL is not valid.";
  }
}

export function validateTrustedExternalUrl(rawUrl: string | null | undefined): ExternalUrlValidation {
  const parsed = parseUrl(rawUrl);
  if (typeof parsed === "string") {
    return { ok: false, reason: parsed };
  }

  const url = parsed.href;
  if (parsed.protocol === "https:") {
    return trustedHttpsUrls.has(url)
      ? { legacyHttp: false, ok: true, url }
      : { ok: false, reason: `HTTPS external URL is not in the allowlist: ${parsed.hostname}` };
  }

  if (parsed.protocol === "http:") {
    const reason = legacyHttpExceptions.get(url);
    return reason
      ? { legacyHttp: true, ok: true, reason, url }
      : { ok: false, reason: `HTTP external URL is not an explicit legacy exception: ${parsed.hostname}` };
  }

  return { ok: false, reason: `Unsupported external URL scheme: ${parsed.protocol}` };
}

export function validateCitationUrl(rawUrl: string | null | undefined): ExternalUrlValidation {
  const parsed = parseUrl(rawUrl);
  if (typeof parsed === "string") {
    return { ok: false, reason: parsed.replace("External link", "Citation") };
  }

  const url = parsed.href;
  if (parsed.protocol === "https:") {
    return citationHttpsUrls.has(url)
      ? { legacyHttp: false, ok: true, url }
      : { ok: false, reason: `HTTPS citation URL is not in the allowlist: ${parsed.hostname}` };
  }

  if (parsed.protocol === "http:") {
    const reason = legacyHttpExceptions.get(url);
    return reason
      ? { legacyHttp: true, ok: true, reason, url }
      : { ok: false, reason: `HTTP citation URL is not an explicit legacy exception: ${parsed.hostname}` };
  }

  return { ok: false, reason: `Unsupported citation URL scheme: ${parsed.protocol}` };
}
