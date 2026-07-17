import { describe, expect, it, vi } from "vitest";

import {
  dispatchScenarioDeepLinks,
  MAX_CATACLYSM_DEEP_LINK_LENGTH,
  scenarioFromDeepLink,
} from "../deep-links";
import { INITIAL_EARTHQUAKE, scenarioToUrlParams, type ScenarioInput } from "../scenario-schema";

const plugin = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  onOpenUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => plugin);

const scenario: ScenarioInput = {
  kind: "Earthquake",
  source: INITIAL_EARTHQUAKE,
};

describe("scenarioFromDeepLink", () => {
  it("routes a bounded shared scenario through the canonical decoder", () => {
    const query = scenarioToUrlParams(null, scenario);
    expect(scenarioFromDeepLink(`cataclysm://open${query}`)).toEqual({ type: "scenario", scenario });
  });

  it("supports a single preset route", () => {
    expect(scenarioFromDeepLink("cataclysm://open?preset=tohoku")).toEqual({
      type: "preset",
      presetId: "tohoku",
    });
  });

  it.each([
    ["https://open?scenario=x", "supported cataclysm://open route"],
    ["cataclysm://settings?scenario=x", "supported cataclysm://open route"],
    ["cataclysm://open/extra?scenario=x", "unsupported route component"],
    ["cataclysm://open?scenario=x#fragment", "unsupported route component"],
    ["cataclysm://open?scenario=x&unknown=1", "unsupported query parameter"],
    ["cataclysm://open?scenario=x&preset=tohoku", "exactly one scenario or preset"],
    ["cataclysm://open?scenario=x&scenario=y", "exactly one scenario or preset"],
    ["cataclysm://open", "exactly one scenario or preset"],
  ])("rejects an untrusted route %s", (url, reason) => {
    expect(scenarioFromDeepLink(url)).toEqual({ type: "invalid", reason: expect.stringContaining(reason) });
  });

  it("rejects the outer URL before attempting to decode an oversized payload", () => {
    const result = scenarioFromDeepLink(`cataclysm://open?scenario=${"a".repeat(MAX_CATACLYSM_DEEP_LINK_LENGTH)}`);
    expect(result).toEqual({
      type: "invalid",
      reason: "The Cataclysm link is larger than the supported URL limit.",
    });
  });

  it("dispatches each plugin event through the same validation boundary", () => {
    const receive = vi.fn();
    dispatchScenarioDeepLinks([
      "cataclysm://open?preset=tohoku",
      "other://open?preset=tohoku",
    ], receive);

    expect(receive).toHaveBeenNthCalledWith(1, { type: "preset", presetId: "tohoku" });
    expect(receive).toHaveBeenNthCalledWith(2, {
      type: "invalid",
      reason: "The link does not use the supported cataclysm://open route.",
    });
  });
});

describe("subscribeToScenarioDeepLinks", () => {
  it("delivers cold-start and warm-launch URLs through one parser", async () => {
    const unlisten = vi.fn();
    let warmHandler: ((urls: string[]) => void) | undefined;
    plugin.onOpenUrl.mockImplementation(async (handler: (urls: string[]) => void) => {
      warmHandler = handler;
      return unlisten;
    });
    plugin.getCurrent.mockResolvedValue(["cataclysm://open?preset=tohoku"]);
    const receive = vi.fn();
    const { subscribeToScenarioDeepLinks } = await import("../deep-links");

    const unsubscribe = await subscribeToScenarioDeepLinks(receive);
    warmHandler?.(["cataclysm://open?scenario=corrupt"]);

    expect(receive).toHaveBeenNthCalledWith(1, { type: "preset", presetId: "tohoku" });
    expect(receive).toHaveBeenNthCalledWith(2, {
      type: "invalid",
      reason: "The shared scenario link is malformed or corrupted.",
    });
    unsubscribe();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("releases the warm listener when cold-start inspection fails", async () => {
    const unlisten = vi.fn();
    plugin.onOpenUrl.mockResolvedValue(unlisten);
    plugin.getCurrent.mockRejectedValue(new Error("plugin unavailable"));
    const { subscribeToScenarioDeepLinks } = await import("../deep-links");

    await expect(subscribeToScenarioDeepLinks(vi.fn())).rejects.toThrow("plugin unavailable");
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
