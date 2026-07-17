import { scenarioFromUrl, type UrlScenarioResult } from "./scenario-schema";

export const CATACLYSM_DEEP_LINK_SCHEME = "cataclysm:";
export const CATACLYSM_DEEP_LINK_HOST = "open";
export const MAX_CATACLYSM_DEEP_LINK_LENGTH = 12_000;

function invalid(reason: string): UrlScenarioResult {
  return { type: "invalid", reason };
}

/**
 * Parse the only desktop route Cataclysm owns. The OS association is not a
 * trust boundary: command-line arguments can be forged, so every component of
 * the URL is checked before its query reaches the existing scenario decoder.
 */
export function scenarioFromDeepLink(rawUrl: string): UrlScenarioResult {
  if (rawUrl.length > MAX_CATACLYSM_DEEP_LINK_LENGTH) {
    return invalid("The Cataclysm link is larger than the supported URL limit.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return invalid("The Cataclysm link is malformed or corrupted.");
  }

  if (url.protocol !== CATACLYSM_DEEP_LINK_SCHEME || url.hostname !== CATACLYSM_DEEP_LINK_HOST) {
    return invalid("The link does not use the supported cataclysm://open route.");
  }
  if ((url.pathname !== "" && url.pathname !== "/") || url.username || url.password || url.port || url.hash) {
    return invalid("The Cataclysm link contains an unsupported route component.");
  }

  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "scenario" && key !== "preset")) {
    return invalid("The Cataclysm link contains an unsupported query parameter.");
  }
  const scenarioCount = url.searchParams.getAll("scenario").length;
  const presetCount = url.searchParams.getAll("preset").length;
  if (scenarioCount + presetCount !== 1) {
    return invalid("The Cataclysm link must contain exactly one scenario or preset.");
  }

  const parsed = scenarioFromUrl(url.search);
  return parsed.type === "none"
    ? invalid("The Cataclysm link does not contain a scenario or preset.")
    : parsed;
}

export function dispatchScenarioDeepLinks(
  urls: readonly string[],
  onScenario: (result: UrlScenarioResult) => void,
): void {
  for (const url of urls) onScenario(scenarioFromDeepLink(url));
}

/** Subscribe to both cold-start and warm-launch desktop deep links. */
export async function subscribeToScenarioDeepLinks(
  onScenario: (result: UrlScenarioResult) => void,
): Promise<() => void> {
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  const unlisten = await onOpenUrl((urls) => dispatchScenarioDeepLinks(urls, onScenario));
  try {
    const current = await getCurrent();
    if (current) dispatchScenarioDeepLinks(current, onScenario);
    return unlisten;
  } catch (error) {
    unlisten();
    throw error;
  }
}
