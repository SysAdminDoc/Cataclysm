import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { NeoCloseApproach } from "../../types/jpl";
import { PlanetaryDefensePanel } from "../PlanetaryDefensePanel";

const APPROACH: NeoCloseApproach = {
  id: "cad-apophis",
  designation: "99942",
  fullname: "99942 Apophis (2004 MN4)",
  approachAtIso: "2029-04-13T21:46:00.000Z",
  nominalDistanceAu: 0.000254099,
  minimumDistanceAu: 0.000254085,
  maximumDistanceAu: 0.000254112,
  relativeVelocityKmS: 7.422,
  infinityVelocityKmS: 5.842,
  timeUncertainty: "< 00:01",
  absoluteMagnitude: 19.7,
  diameterMinM: 300,
  diameterMaxM: 380,
  diameterBasis: "measured",
  source: "Built-in reference",
};

vi.mock("../../lib/jpl", () => ({
  loadCloseApproaches: vi.fn(async () => ({
    approaches: [APPROACH],
    fetchedAtIso: "2023-03-01T00:00:00.000Z",
    status: "reference",
    stale: false,
    notice: "reference",
  })),
  hypotheticalImpactFromApproach: vi.fn((object: NeoCloseApproach) => ({
    object,
    diameterM: 340,
    velocityMps: 12_600,
    densityKgM3: 2_600,
    assumptions: ["Non-prediction"],
  })),
}));

describe("PlanetaryDefensePanel", () => {
  it("separates a real approach from a hypothetical impact", async () => {
    const onTry = vi.fn();
    const user = userEvent.setup();
    render(<PlanetaryDefensePanel onTryHypotheticalImpact={onTry} />);

    expect(await screen.findByRole("heading", { name: "Reference approaches" })).toBeInTheDocument();
    expect(screen.getByText("A close approach is not a predicted impact.")).toBeInTheDocument();
    expect(screen.getByText("0.1 LD · 38,012.7 km")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Explore real approach" }));
    expect(screen.getByRole("img", { name: /Schematic close approach for 99942 Apophis/i })).toBeInTheDocument();
    expect(screen.getByText("Not included in this feed; no risk claim made")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try hypothetical impact" }));
    expect(onTry).toHaveBeenCalledWith(expect.objectContaining({
      object: APPROACH,
      diameterM: 340,
    }));
  });
});
