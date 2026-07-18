import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HighlightStorySource } from "../HighlightStoryDialog";
import { HighlightStoryDialog } from "../HighlightStoryDialog";

const source: HighlightStorySource = {
  meta: {
    timeS: 600,
    generatedAt: "2026-07-18T12:00:00.000Z",
    scenarioName: "Tohoku test",
    scenarioKind: "Earthquake",
    solverMode: "Cached SWE replay",
    citationReference: "Reference",
    citationUrl: "https://example.com/reference",
    limitation: "Educational model only.",
  },
  scenarioId: "tohoku-test",
  scenarioTitle: "Tohoku test",
  availableTimesS: [0, 60, 300, 600],
  frameFingerprints: ["a", "b", "c", "d"],
  framePayloads: [{ t: 0 }, { t: 60 }, { t: 300 }, { t: 600 }],
  scaleAnchors: ["Source 38°, 142°", "Peak 3 m"],
  baseScenarioUrl: "https://cataclysm.example/?preset=tohoku-test",
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HighlightStoryDialog", () => {
  it("previews cached named moments and exposes distinct cut contracts", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<HighlightStoryDialog source={source} onSeek={onSeek} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Share story" })).toBeInTheDocument();
    expect(screen.getByText("4 cached frames")).toBeInTheDocument();
    expect(screen.getByText("fnv1a32-", { exact: false })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "60 sec" }));
    expect(screen.getByRole("button", { name: "60 sec" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Clean cinematic" }));
    expect(screen.getByText(/analytical labels and overlays are omitted/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Development/ }));
    expect(onSeek).toHaveBeenCalledWith(300);
  });

  it("keeps the frozen replay available when save fails and succeeds on retry", async () => {
    const user = userEvent.setup();
    const createObjectUrl = vi.fn<() => string>(() => { throw new Error("disk unavailable"); });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createObjectUrl, revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<HighlightStoryDialog source={source} onSeek={vi.fn()} onClose={vi.fn()} />);
    const fingerprint = screen.getByText("fnv1a32-", { exact: false }).textContent;

    await user.click(screen.getByRole("button", { name: "Save story file" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/disk unavailable/i);
    createObjectUrl.mockImplementation(() => "blob:story");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("status")).toHaveTextContent("cataclysm-tohoku-test-30s.catstory.json");
    expect(screen.getByText(fingerprint ?? "")).toBeInTheDocument();
  });
});
