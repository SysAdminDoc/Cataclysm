import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HazardControls } from "../HazardControls";
import { nuclearEngine, type AsteroidInput, type NuclearInput } from "../../hazards";

const nuclear: NuclearInput = { yieldKt: 100, burstType: "airburst", populationDensity: 5000 };
const asteroid: AsteroidInput = { diameterM: 100, densityKgM3: 3000, velocityKmS: 20, angleDeg: 45, targetType: "sedimentary_rock", waterDepthM: 4000 };

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
    const result = nuclearEngine.run(nuclear, { lat: 40, lon: -74 });
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
        result={result}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    // readout label from the engine
    expect(screen.getByText("Fireball radius")).toBeInTheDocument();
    // casualties block renders fatalities
    expect(screen.getByText(/fatalities/i)).toBeInTheDocument();
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
  });
});
