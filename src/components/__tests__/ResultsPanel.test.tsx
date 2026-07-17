import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ResultsPanel } from "../ResultsPanel";
import type { InitialDisplacement } from "../../types/scenario";
import { getCoastalPoints } from "../../lib/data";
import { demoRunupAtPoints } from "../../lib/demo";

vi.mock("../../lib/browser-physics", () => ({
  browserRunup: vi.fn(async ({ points }: { points: unknown[] }) => points.map((_, index) => ({
    range_m: (index + 1) * 100_000,
    offshore_amplitude_m: 4 - index,
    runup_m: 8 - index,
    arrival_time_s: (index + 1) * 500,
    has_arrived: true,
    inundation_extent_m: (index + 1) * 250,
  }))),
}));

const MOCK_INITIAL: InitialDisplacement = {
  peak_amplitude_m: 1500,
  cavity_radius_m: 50000,
  source_energy_j: 4.2e23,
  dominant_wavelength_m: 100000,
  seismic_mw_equivalent: 12.5,
  center: { lat_deg: 21.4, lon_deg: -89.5, depth_m: 1500 },
  label: "Chicxulub",
};

const EARTHQUAKE_INITIAL: InitialDisplacement = {
  peak_amplitude_m: 8,
  cavity_radius_m: 120000,
  source_energy_j: 4.2e18,
  dominant_wavelength_m: 240000,
  seismic_mw_equivalent: 9.1,
  center: { lat_deg: 38, lon_deg: 143, depth_m: 2000 },
  label: "M_w 9.1 fault, depth 30 km",
};

describe("ResultsPanel", () => {
  it("shows empty state when no initial data", () => {
    render(<ResultsPanel initial={null} timeS={900} onTimeChange={() => {}} />);
    expect(screen.getByText("Choose a source to unlock readouts")).toBeInTheDocument();
  });

  it("opens with a What happened? outcome lead", () => {
    render(<ResultsPanel initial={MOCK_INITIAL} timeS={900} onTimeChange={() => {}} sourceKind="Asteroid" />);
    expect(screen.getByText("What happened?")).toBeInTheDocument();
    expect(screen.getByText(/Asteroid impact releasing/i)).toBeInTheDocument();
    expect(screen.getByText(/Mt TNT/)).toBeInTheDocument();
    expect(screen.getByText("Why trust this?")).toBeInTheDocument();
  });

  it("labels the source region correctly for an earthquake (never 'Cavity radius')", async () => {
    const user = userEvent.setup();
    render(<ResultsPanel initial={EARTHQUAKE_INITIAL} timeS={900} onTimeChange={() => {}} sourceKind="Earthquake" />);
    expect(screen.getByText(/Magnitude 9\.10 seafloor earthquake/i)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Science" }));
    expect(screen.getByText("Source region radius")).toBeInTheDocument();
    expect(screen.queryByText("Cavity radius")).not.toBeInTheDocument();
  });

  it("still uses cavity terminology for impact and detonation sources", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ResultsPanel initial={MOCK_INITIAL} timeS={900} onTimeChange={() => {}} sourceKind="Asteroid" />,
    );
    await user.click(screen.getByRole("tab", { name: "Science" }));
    expect(screen.getByText("Cavity radius")).toBeInTheDocument();
    rerender(<ResultsPanel initial={MOCK_INITIAL} timeS={900} onTimeChange={() => {}} sourceKind="Nuclear" />);
    expect(screen.getByText("Cavity radius")).toBeInTheDocument();
  });

  it("shows timeline readout", () => {
    render(<ResultsPanel initial={MOCK_INITIAL} timeS={1800} onTimeChange={() => {}} showTimeline />);
    expect(screen.getByRole("slider", { name: "Scenario timeline scrubber" })).toHaveAttribute(
      "aria-valuetext",
      "30 minutes after source event",
    );
  });

  it("visibly discloses low-confidence coastal input records", async () => {
    const user = userEvent.setup();
    const runupResults = await demoRunupAtPoints({
      source: MOCK_INITIAL.center,
      initial_amplitude_m: MOCK_INITIAL.peak_amplitude_m,
      cavity_radius_m: MOCK_INITIAL.cavity_radius_m,
      is_impact: true,
      mean_depth_m: 4_000,
      time_s: Number.MAX_SAFE_INTEGER,
      points: [getCoastalPoints()[0]],
    });
    render(<ResultsPanel initial={MOCK_INITIAL} timeS={900} onTimeChange={() => {}} runupResults={runupResults} />);
    await user.click(screen.getByRole("tab", { name: "Validation" }));
    expect(screen.getByText("Coastal screening validation")).toBeInTheDocument();
    expect(screen.getAllByText(/low confidence/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/miyako_jp:slope/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export coastal CSV with provenance/i })).toBeInTheDocument();
  });

  it("surfaces a retry when coastal CSV download fails", async () => {
    const user = userEvent.setup();
    const runupResults = await demoRunupAtPoints({
      source: MOCK_INITIAL.center,
      initial_amplitude_m: MOCK_INITIAL.peak_amplitude_m,
      cavity_radius_m: MOCK_INITIAL.cavity_radius_m,
      is_impact: true,
      mean_depth_m: 4_000,
      time_s: Number.MAX_SAFE_INTEGER,
      points: [getCoastalPoints()[0]],
    });
    const createUrl = vi.spyOn(URL, "createObjectURL")
      .mockImplementationOnce(() => { throw new Error("downloads denied"); })
      .mockReturnValue("blob:retry-success");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      render(<ResultsPanel initial={MOCK_INITIAL} timeS={900} onTimeChange={() => {}} runupResults={runupResults} />);
      await user.click(screen.getByRole("tab", { name: "Validation" }));
      await user.click(screen.getByRole("button", { name: /Export coastal CSV with provenance/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Download failed: Blob download failed");
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(createUrl).toHaveBeenCalledTimes(2);
      expect(revokeUrl).toHaveBeenCalledWith("blob:retry-success");
    } finally {
      createUrl.mockRestore();
      revokeUrl.mockRestore();
      click.mockRestore();
    }
  });

  it("uses semantic tabs with roving keyboard focus", async () => {
    const user = userEvent.setup();
    render(<ResultsPanel initial={MOCK_INITIAL} timeS={900} onTimeChange={() => {}} />);
    const outcome = screen.getByRole("tab", { name: "Outcome" });
    const science = screen.getByRole("tab", { name: "Science" });
    outcome.focus();
    await user.keyboard("{ArrowRight}");
    expect(science).toHaveFocus();
    expect(science).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Science");
  });

  it("focuses a narrated coastal outcome at its arrival time", async () => {
    const user = userEvent.setup();
    const onTimeChange = vi.fn();
    const onFocusOutcome = vi.fn();
    const runupResults = await demoRunupAtPoints({
      source: MOCK_INITIAL.center,
      initial_amplitude_m: MOCK_INITIAL.peak_amplitude_m,
      cavity_radius_m: MOCK_INITIAL.cavity_radius_m,
      is_impact: true,
      mean_depth_m: 4_000,
      time_s: Number.MAX_SAFE_INTEGER,
      points: [getCoastalPoints()[0]],
    });
    render(
      <ResultsPanel
        initial={MOCK_INITIAL}
        timeS={900}
        onTimeChange={onTimeChange}
        runupResults={runupResults}
        onFocusOutcome={onFocusOutcome}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Maximum sampled coastal effect/i }));
    expect(onTimeChange).toHaveBeenCalledWith(runupResults[0].arrival_time_s);
    expect(onFocusOutcome).toHaveBeenCalledWith(expect.objectContaining({
      id: runupResults[0].id,
      lat: runupResults[0].lat,
      lon: runupResults[0].lon,
    }));
  });

  it("presents named places as focusable rows and exposes the selected place", async () => {
    const user = userEvent.setup();
    const onTimeChange = vi.fn();
    const onFocusOutcome = vi.fn();
    const runupResults = await demoRunupAtPoints({
      source: MOCK_INITIAL.center,
      initial_amplitude_m: MOCK_INITIAL.peak_amplitude_m,
      cavity_radius_m: MOCK_INITIAL.cavity_radius_m,
      is_impact: true,
      mean_depth_m: 4_000,
      time_s: Number.MAX_SAFE_INTEGER,
      points: [getCoastalPoints()[0]],
    });
    render(
      <ResultsPanel
        initial={MOCK_INITIAL}
        timeS={900}
        onTimeChange={onTimeChange}
        runupResults={runupResults}
        onFocusOutcome={onFocusOutcome}
      />,
    );

    expect(screen.getByText("Named places")).toBeInTheDocument();
    const place = screen.getByRole("button", {
      name: new RegExp(`^${runupResults[0].name}, approximately.*Focus place and time`, "i"),
    });
    expect(place).toHaveAttribute("aria-pressed", "false");
    await user.click(place);
    expect(place).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Focused")).toBeInTheDocument();
    expect(onTimeChange).toHaveBeenCalledWith(runupResults[0].arrival_time_s);
    expect(onFocusOutcome).toHaveBeenCalledWith(expect.objectContaining({ id: runupResults[0].id }));
  });

  it("distinguishes loading, error, and valid-empty coastal screening with a local retry", async () => {
    const user = userEvent.setup();
    const onRetryRunup = vi.fn();
    const { rerender } = render(
      <ResultsPanel
        initial={MOCK_INITIAL}
        timeS={900}
        onTimeChange={() => {}}
        runupResult={{ status: "loading" }}
        onRetryRunup={onRetryRunup}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Validation" }));
    expect(screen.getByText("Computing coastal screening…")).toBeInTheDocument();

    rerender(
      <ResultsPanel
        initial={MOCK_INITIAL}
        timeS={900}
        onTimeChange={() => {}}
        runupResult={{ status: "error", error: "solver unavailable" }}
        onRetryRunup={onRetryRunup}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Coastal screening failed: solver unavailable");
    await user.click(screen.getByRole("button", { name: "Retry coastal screening" }));
    expect(onRetryRunup).toHaveBeenCalledOnce();

    rerender(
      <ResultsPanel
        initial={MOCK_INITIAL}
        timeS={900}
        onTimeChange={() => {}}
        runupResult={{ status: "empty", value: [] }}
        onRetryRunup={onRetryRunup}
      />,
    );
    expect(screen.getByText("No coastal point exceeded the display threshold")).toBeInTheDocument();
  });
});
