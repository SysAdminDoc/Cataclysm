import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PointProbeReport } from "../../render/cesium/inspection";
import type { NukemapLocationResult } from "../../types/nukemap-data";
import { FamiliarPlacePanel } from "../FamiliarPlacePanel";

const PLACE: NukemapLocationResult = {
  id: "city-new-york",
  kind: "city",
  name: "New York, NY",
  context: "city table",
  lat: 40.7128,
  lon: -74.006,
  density: {
    peoplePerKm2: 15_000,
    nearestCity: "New York, NY",
    distanceKm: 0,
    population: 8_000_000,
  },
};

const REPORT: PointProbeReport = {
  domain: "tsunami",
  lat: PLACE.lat,
  lon: PLACE.lon,
  rangeM: 4_125_000,
  status: "Wave in transit",
  metrics: [
    { label: "Arrival", value: "T+7h20", arrivalTimeS: 26_400 },
    { label: "Runup", value: "2.1 m" },
  ],
  governingModel: "analytical far-field model",
  citations: ["Model reference"],
  assumptions: ["Nominal slope"],
  confidence: "illustrative",
  unknowns: ["Local shoreline unresolved"],
};

describe("FamiliarPlacePanel", () => {
  it("keeps a historical source at its factual origin and leads with local timing", () => {
    render(
      <FamiliarPlacePanel
        place={PLACE}
        report={REPORT}
        mode="tsunami"
        sourceLabel="2011 Tōhoku earthquake"
        historicalSource
        onClear={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Near New York, NY" })).toBeInTheDocument();
    expect(screen.getByText("4,125.0 km from source")).toBeInTheDocument();
    expect(screen.getByText("T+7h20")).toBeInTheDocument();
    expect(screen.getByText(/remains at its factual source coordinates/i)).toBeInTheDocument();
    expect(screen.getByText(/queries never leave this device/i)).toBeInTheDocument();
  });

  it("labels a relocated direct scenario as a custom copy", async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(
      <FamiliarPlacePanel
        place={PLACE}
        report={{ ...REPORT, domain: "nuclear", rangeM: 0, status: "3 displayed thresholds reached" }}
        mode="nuclear"
        sourceLabel="Trinity reference"
        onClear={onClear}
      />,
    );

    expect(screen.getByRole("heading", { name: "What if near New York, NY?" })).toBeInTheDocument();
    expect(screen.getByText(/reference record and origin remain unchanged/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove place" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
