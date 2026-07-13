import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ResultsPanel } from "../ResultsPanel";
import type { InitialDisplacement } from "../../types/scenario";
import { getCoastalPoints } from "../../lib/data";
import { demoRunupAtPoints } from "../../lib/demo";

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
    expect(screen.getByText("Mt TNT")).toBeInTheDocument();
  });

  it("labels the source region correctly for an earthquake (never 'Cavity radius')", () => {
    render(<ResultsPanel initial={EARTHQUAKE_INITIAL} timeS={900} onTimeChange={() => {}} sourceKind="Earthquake" />);
    expect(screen.getByText("Source region radius")).toBeInTheDocument();
    expect(screen.queryByText("Cavity radius")).not.toBeInTheDocument();
    expect(screen.getByText(/Magnitude 9\.10 seafloor earthquake/i)).toBeInTheDocument();
  });

  it("still uses cavity terminology for impact and detonation sources", () => {
    const { rerender } = render(
      <ResultsPanel initial={MOCK_INITIAL} timeS={900} onTimeChange={() => {}} sourceKind="Asteroid" />,
    );
    expect(screen.getByText("Cavity radius")).toBeInTheDocument();
    rerender(<ResultsPanel initial={MOCK_INITIAL} timeS={900} onTimeChange={() => {}} sourceKind="Nuclear" />);
    expect(screen.getByText("Cavity radius")).toBeInTheDocument();
  });

  it("shows timeline readout", () => {
    render(<ResultsPanel initial={MOCK_INITIAL} timeS={1800} onTimeChange={() => {}} showTimeline />);
    expect(screen.getByText("Timeline")).toBeInTheDocument();
  });

  it("visibly discloses low-confidence coastal input records", () => {
    const runupResults = demoRunupAtPoints({
      source: MOCK_INITIAL.center,
      initial_amplitude_m: MOCK_INITIAL.peak_amplitude_m,
      cavity_radius_m: MOCK_INITIAL.cavity_radius_m,
      is_impact: true,
      mean_depth_m: 4_000,
      time_s: Number.MAX_SAFE_INTEGER,
      points: [getCoastalPoints()[0]],
    });
    render(<ResultsPanel initial={MOCK_INITIAL} timeS={900} onTimeChange={() => {}} runupResults={runupResults} />);
    expect(screen.getByText("Coastal screening estimates")).toBeInTheDocument();
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(screen.getByText(/miyako_jp:slope/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export coastal CSV with provenance/i })).toBeInTheDocument();
  });
});
