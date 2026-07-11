import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ResultsPanel } from "../ResultsPanel";
import type { InitialDisplacement } from "../../types/scenario";

const MOCK_INITIAL: InitialDisplacement = {
  peak_amplitude_m: 1500,
  cavity_radius_m: 50000,
  source_energy_j: 4.2e23,
  dominant_wavelength_m: 100000,
  seismic_mw_equivalent: 12.5,
  center: { lat_deg: 21.4, lon_deg: -89.5, depth_m: 1500 },
  label: "Chicxulub",
};

describe("ResultsPanel", () => {
  it("shows empty state when no initial data", () => {
    render(<ResultsPanel initial={null} timeS={900} onTimeChange={() => {}} />);
    expect(screen.getByText("Choose a source to unlock readouts")).toBeInTheDocument();
  });

  it("renders source readout for a given initial displacement", () => {
    render(<ResultsPanel initial={MOCK_INITIAL} timeS={900} onTimeChange={() => {}} />);
    expect(screen.getByText("Source metrics")).toBeInTheDocument();
    expect(screen.getByText("Mt TNT")).toBeInTheDocument();
  });

  it("shows timeline readout", () => {
    render(<ResultsPanel initial={MOCK_INITIAL} timeS={1800} onTimeChange={() => {}} />);
    expect(screen.getByText("Source metrics")).toBeInTheDocument();
  });
});
