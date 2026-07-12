import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HazardControls } from "../HazardControls";
import type { AsteroidInput, HazardResult, NuclearInput } from "../../hazards";

const nuclear: NuclearInput = { yieldKt: 100, burstType: "airburst", populationDensity: 5000 };
const asteroid: AsteroidInput = { diameterM: 100, densityKgM3: 3000, velocityKmS: 20, angleDeg: 45, targetType: "sedimentary_rock", waterDepthM: 4000 };
const nuclearResult: HazardResult = {
  kind: "nuclear",
  authority: "rust",
  modelVersion: "nuclear-direct-1.0.0",
  center: { lat: 40, lon: -74 },
  rings: [{ label: "Fireball", radiusM: 300, color: "#f5e0dc", category: "fireball" }],
  readout: [{ label: "Fireball radius", value: "300 m" }],
  casualties: { deaths: 120, injuries: 240, populationDensity: 5000 },
  detail: {
    yieldKt: 100,
    isSurface: false,
    isWater: false,
    fireball: 0.3,
    psi20: 1,
    psi5: 3,
    psi1: 8,
    thermal3: 4,
    thermal1: 6,
    radiation: 2,
    neutronRad: 1,
    gammaRad: 1,
    craterR: 0,
    cloudTopH: 12,
    optimalHeight: 1000,
    waveHeight: 0,
    fallout: null,
    timeline: [{ time: "0 ms", description: "Detonation.", category: "radiation" }],
    latentCancer: { exposed: 50000, cancers10yr: 800, cancers30yr: 2100, geneticEffects: 50 },
  },
};

function noop() {}

describe("HazardControls", () => {
  it("prompts to pick a location when no result is present", () => {
    render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={null}
        onTogglePick={noop}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    expect(screen.getByText(/pick a location/i)).toBeInTheDocument();
    expect(screen.getByText(/no location set/i)).toBeInTheDocument();
  });

  it("renders the nuclear readout, casualties and ring legend from a result", () => {
    render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={nuclearResult}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    // Backend fixture values are presented without client-side recomputation.
    expect(screen.getByText("Fireball radius")).toBeInTheDocument();
    // casualties block renders fatalities
    expect(screen.getByText(/fatalities/i)).toBeInTheDocument();
    // latent cancer readout renders the BEIR VII estimate
    expect(screen.getByText(/latent\s*cancer deaths over 30 yr/i)).toBeInTheDocument();
    expect(screen.getByText(/BEIR VII/i)).toBeInTheDocument();
    // one legend entry per ring
    expect(screen.getByText("Fireball")).toBeInTheDocument();
  });

  it("fires the pick toggle when the location button is clicked", () => {
    const onTogglePick = vi.fn();
    render(
      <HazardControls
        mode="asteroid"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={null}
        onTogglePick={onTogglePick}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    screen.getByRole("button", { name: /pick location on globe/i }).click();
    expect(onTogglePick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /pick location on globe/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("preserves a matching weapon preset and exposes formatted slider values", () => {
    render(
      <HazardControls
        mode="nuclear"
        nuclear={{ ...nuclear, yieldKt: 15 }}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={null}
        onTogglePick={noop}
        pickActive
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    expect(screen.getByLabelText("Weapon preset")).toHaveValue("hiroshima");
    expect(screen.getByRole("slider", { name: "Yield" })).toHaveAttribute("aria-valuetext", "15 kT");
    expect(screen.getByRole("button", { name: /click the globe/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("explains that direct physics is desktop-only in browser preview", () => {
    render(
      <HazardControls
        mode="asteroid"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
        backendAvailable={false}
      />,
    );
    expect(screen.getByText(/requires the desktop app/i)).toBeInTheDocument();
  });

  it("surfaces calculation failures and exposes animation from Setup", () => {
    const { rerender } = render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
        error="Direct hazard simulation failed: backend unavailable"
        display="setup"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("backend unavailable");

    rerender(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={nuclearResult}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
        display="setup"
        canAnimate
      />,
    );
    expect(screen.getByRole("button", { name: "Detonation animation" })).toBeEnabled();
  });
});
