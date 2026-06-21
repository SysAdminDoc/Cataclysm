import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AttenuationChart } from "../AttenuationChart";
import type { InitialDisplacement } from "../../types/scenario";

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
    expect(screen.getByText("No source selected")).toBeInTheDocument();
  });

  it("renders the chart SVG with axis labels when initial is provided", () => {
    render(<AttenuationChart initial={INITIAL} isImpact={true} timeS={0} runupResults={[]} />);
    const svg = screen.getByRole("img", { name: /amplitude vs distance/i });
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
});
