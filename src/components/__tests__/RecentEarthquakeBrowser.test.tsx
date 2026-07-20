import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecentEarthquakeBrowser } from "../RecentEarthquakeBrowser";

const mocks = vi.hoisted(() => ({
  recent: vi.fn(),
  detail: vi.fn(),
  map: vi.fn(),
}));

vi.mock("../../lib/usgs-earthquakes", () => ({
  loadRecentUsgsEarthquakes: mocks.recent,
  loadUsgsEarthquakeDetail: mocks.detail,
  recentEarthquakeImport: mocks.map,
}));

const EVENT = {
  id: "us7000test",
  title: "M 7.2 - Test trench",
  place: "Test trench",
  magnitude: 7.2,
  magnitudeType: "mww",
  timeMs: 1_752_000_000_000,
  updatedMs: 1_752_000_600_000,
  latitude: 38.2,
  longitude: 142.4,
  depthKm: 24,
  status: "reviewed",
  significance: 800,
  tsunamiFlag: true,
  alertLevel: "yellow",
  maxMmi: 7.4,
  hasShakemap: true,
  hasPager: true,
  hasFiniteFault: true,
  hasMomentTensor: true,
  eventUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test",
};

describe("RecentEarthquakeBrowser", () => {
  beforeEach(() => {
    mocks.recent.mockReset();
    mocks.detail.mockReset();
    mocks.map.mockReset();
    mocks.recent.mockResolvedValue({
      generatedAtMs: 1_752_000_700_000,
      sourceUrl: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson",
      events: [EVENT],
      status: "live",
      stale: false,
      notice: null,
    });
  });

  it("shows the warning boundary and loads a cited source plus comparison", async () => {
    const mapped = { scenario: { kind: "Earthquake", source: {} }, provenanceNote: "USGS source", officialComparison: { eventId: EVENT.id } };
    mocks.detail.mockResolvedValue({ detail: { event: EVENT }, stale: false });
    mocks.map.mockReturnValue(mapped);
    const onLoad = vi.fn();
    const user = userEvent.setup();
    render(<RecentEarthquakeBrowser onClose={() => {}} onLoad={onLoad} />);

    expect(await screen.findByText("M 7.2 - Test trench")).toBeInTheDocument();
    expect(screen.getByText(/not a live warning/i)).toBeInTheDocument();
    expect(screen.getByText("finite fault · ShakeMap · PAGER")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load source" }));
    expect(mocks.detail).toHaveBeenCalledWith(EVENT.id);
    expect(onLoad).toHaveBeenCalledWith(mapped);
  });

  it("filters without re-querying the bounded feed", async () => {
    const user = userEvent.setup();
    render(<RecentEarthquakeBrowser onClose={() => {}} onLoad={() => {}} />);
    expect(await screen.findByText("M 7.2 - Test trench")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search recent earthquakes"), "no match");
    expect(screen.getByText("No recent events match these filters.")).toBeInTheDocument();
    expect(mocks.recent).toHaveBeenCalledTimes(1);
  });
});
