import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InitialDisplacement, Preset } from "../../types/scenario";
import { SourceModelSummary } from "../SourceModelSummary";

const initial: InitialDisplacement = {
  center: { lat_deg: 38.3, lon_deg: 142.37, depth_m: 1_500 },
  cavity_radius_m: 1_000,
  peak_amplitude_m: 40,
  source_energy_j: 1e18,
  seismic_mw_equivalent: 9.1,
  label: "Tohoku",
};

const preset: Preset = {
  id: "tohoku",
  name: "Tohoku 2011",
  date: "2011-03-11",
  blurb: "Reference earthquake",
  reference: "Okada",
  source: {
    kind: "Earthquake",
    source: {
      mw: 9.1,
      depth_m: 1_500,
      strike_deg: 193,
      dip_deg: 14,
      rake_deg: 81,
      slip_m: 20,
      water_depth_m: 1_500,
      location: initial.center,
    },
  },
};

describe("SourceModelSummary", () => {
  it("shows a clear empty source state", () => {
    render(<SourceModelSummary preset={null} initial={null} onEdit={vi.fn()} />);
    expect(screen.getByText("No active source")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("renders source provenance and edit action", () => {
    render(<SourceModelSummary preset={preset} initial={initial} onEdit={vi.fn()} />);
    expect(screen.getByText("Tohoku 2011")).toBeInTheDocument();
    expect(screen.getByText("Okada dislocation model")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit source parameters" })).toBeEnabled();
  });
});
