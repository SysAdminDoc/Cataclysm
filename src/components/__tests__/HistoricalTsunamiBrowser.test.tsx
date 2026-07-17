import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoricalTsunamiBrowser } from "../HistoricalTsunamiBrowser";

const mocks = vi.hoisted(() => ({
  desktop: true,
  search: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => mocks.desktop,
  api: { nceiHazelSearch: mocks.search },
}));

const RESPONSE = {
  items: [{
    id: 1902,
    year: 1960,
    month: 5,
    day: 22,
    eventValidity: 4,
    causeCode: 1,
    eqMagnitude: 9.5,
    country: "CHILE",
    locationName: "SOUTHERN CHILE",
    latitude: -38.143,
    longitude: -73.407,
    numRunups: 1279,
  }],
  page: 1,
  totalPages: 1,
  itemsPerPage: 40,
  totalItems: 1,
};

describe("HistoricalTsunamiBrowser", () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.search.mockReset();
  });

  it("searches 1960 Chile and loads the mapped source with provenance", async () => {
    mocks.search.mockResolvedValue(RESPONSE);
    const onLoad = vi.fn();
    const user = userEvent.setup();
    render(<HistoricalTsunamiBrowser onClose={() => {}} onLoad={onLoad} />);

    await user.type(screen.getByLabelText("Year and location"), "1960 Chile");
    await user.click(screen.getByRole("button", { name: "Search NOAA" }));

    expect(mocks.search).toHaveBeenCalledWith({ year: 1960, location: "Chile" });
    expect(await screen.findByText("SOUTHERN CHILE")).toBeInTheDocument();
    expect(screen.getByText("M_w 9.5")).toBeInTheDocument();
    expect(screen.getByText("1,279")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load into builder" }));
    expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({
      scenario: expect.objectContaining({ kind: "Earthquake" }),
      provenanceNote: expect.stringContaining("HazEL event 1902"),
    }));
  });

  it("explains the network-isolated browser preview without calling the API", async () => {
    mocks.desktop = false;
    const user = userEvent.setup();
    render(<HistoricalTsunamiBrowser onClose={() => {}} onLoad={() => {}} />);
    expect(screen.getByText(/Live lookup is disabled in the browser preview/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Year and location"), "1960 Chile");
    await user.click(screen.getByRole("button", { name: "Search NOAA" }));
    expect(mocks.search).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("installed desktop app");
  });

  it("keeps the built-in library available when HazEL is offline", async () => {
    mocks.search.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<HistoricalTsunamiBrowser onClose={() => {}} onLoad={() => {}} />);
    await user.type(screen.getByLabelText("Year and location"), "1960 Chile");
    await user.click(screen.getByRole("button", { name: "Search NOAA" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("built-in scenario library remains available offline");
  });
});
