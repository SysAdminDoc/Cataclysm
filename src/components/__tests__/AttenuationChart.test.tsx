import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { AttenuationChart } from "../AttenuationChart";
import type { InitialDisplacement } from "../../types/scenario";
import { getCoastalPoints } from "../../lib/data";

const COASTAL = getCoastalPoints()[0];
const RUNUP_PROVENANCE = {
  beach_slope_deg: COASTAL.beach_slope_deg,
  offshore_depth_m: COASTAL.offshore_depth_m,
  slope_provenance: COASTAL.slope_provenance,
  depth_provenance: COASTAL.depth_provenance,
  quantitative_confidence: "low" as const,
  quantitative_label: "illustrative" as const,
};

const INITIAL: InitialDisplacement = {
  center: { lat_deg: 21.4, lon_deg: -89.5, depth_m: 1500 },
  cavity_radius_m: 50_000,
  peak_amplitude_m: 4500,
  source_energy_j: 1e25,
  seismic_mw_equivalent: 10.5,
  label: "Chicxulub",
};

describe("AttenuationChart", () => {
  it("renders empty state when no initial displacement", () => {
    render(<AttenuationChart initial={null} isImpact={true} timeS={0} runupResults={[]} />);
    expect(screen.getByText("Amplitude curve appears after source selection")).toBeInTheDocument();
  });

  it("renders the chart SVG with axis labels when initial is provided", () => {
    render(<AttenuationChart initial={INITIAL} isImpact={true} timeS={0} runupResults={[]} />);
    const svg = screen.getByRole("img", { name: /modeled wave amplitude decay by distance/i });
    expect(svg).toBeInTheDocument();
    expect(svg.querySelectorAll("text").length).toBeGreaterThan(0);
  });

  it("renders the decay curve path", () => {
    render(<AttenuationChart initial={INITIAL} isImpact={true} timeS={0} runupResults={[]} />);
    const svg = screen.getByRole("img");
    const path = svg.querySelector("path");
    expect(path).not.toBeNull();
    expect(path!.getAttribute("d")).toMatch(/^M/);
  });

  it("renders arrived runup points as circles", () => {
    const runup = [
      {
        ...RUNUP_PROVENANCE,
        id: "tokyo", name: "Tokyo", lat: 35.65, lon: 139.77,
        range_m: 5_000_000, offshore_amplitude_m: 1.2, runup_m: 3,
        arrival_time_s: 3600, has_arrived: true, inundation_extent_m: 500,
      },
    ];
    render(<AttenuationChart initial={INITIAL} isImpact={true} timeS={7200} runupResults={runup} />);
    const svg = screen.getByRole("img");
    const circles = svg.querySelectorAll("circle");
    expect(circles.length).toBe(1);
  });

  it("does not render points that haven't arrived", () => {
    const runup = [
      {
        ...RUNUP_PROVENANCE,
        id: "far", name: "Far Away", lat: -40, lon: 170,
        range_m: 15_000_000, offshore_amplitude_m: 0.1, runup_m: 0.5,
        arrival_time_s: 36000, has_arrived: false, inundation_extent_m: 10,
      },
    ];
    render(<AttenuationChart initial={INITIAL} isImpact={true} timeS={100} runupResults={runup} />);
    const svg = screen.getByRole("img");
    expect(svg.querySelectorAll("circle").length).toBe(0);
  });

  it("renders wavefront position line when timeS > 0", () => {
    render(<AttenuationChart initial={INITIAL} isImpact={true} timeS={3600} runupResults={[]} />);
    const svg = screen.getByRole("img");
    const dashedLine = svg.querySelector('line[stroke-dasharray]');
    expect(dashedLine).not.toBeNull();
  });

  it("shows section title 'Wave attenuation'", () => {
    render(<AttenuationChart initial={INITIAL} isImpact={true} timeS={0} runupResults={[]} />);
    expect(screen.getByText("Wave attenuation")).toBeInTheDocument();
  });

  it("provides a non-live summary and keyboard-accessible provenance table", async () => {
    const user = userEvent.setup();
    render(<AttenuationChart initial={INITIAL} isImpact={true} timeS={3600} runupResults={[]} />);
    const summary = screen.getByText(/Modeled decay spans/, { selector: ".chart-data__summary" });
    expect(summary).toHaveAttribute("aria-live", "off");
    expect(screen.getByRole("img")).toHaveAttribute("aria-describedby", summary.id);

    await user.click(screen.getByText(/View wave attenuation data/));
    const tableRegion = screen.getByRole("region", { name: "wave attenuation data table" });
    expect(tableRegion).toHaveAttribute("tabindex", "0");
    expect(within(tableRegion).getByRole("columnheader", { name: "Series" })).toBeInTheDocument();
    expect(within(tableRegion).getByRole("rowheader", { name: "Active wavefront" })).toBeInTheDocument();
    expect(within(tableRegion).getByText("Current timeline selection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy wave attenuation CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export wave attenuation CSV" })).toBeInTheDocument();
  });
});
