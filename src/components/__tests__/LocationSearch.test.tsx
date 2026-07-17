import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocationSearch } from "../LocationSearch";

describe("LocationSearch", () => {
  it("selects a packaged city with its density estimate", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<LocationSearch onSelect={onSelect} />);

    await user.type(screen.getByLabelText("Offline location search"), "New York, NY");
    const match = await screen.findByRole("button", { name: /New York, NY.*city table/i });
    await user.click(match);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      kind: "city",
      lat: 40.7128,
      lon: -74.006,
      density: expect.objectContaining({ peoplePerKm2: 15_000 }),
    }));
    expect(screen.getByText(/Selected New York, NY; estimated 15,000 people\/km²/i)).toBeInTheDocument();
  });

  it("resolves a five-digit ZIP only from packaged data", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<LocationSearch onSelect={onSelect} />);

    await user.type(screen.getByLabelText("Offline location search"), "02134");
    const match = await screen.findByRole("button", { name: /02134.*Allston, MA/i });
    await user.click(match);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "zip", lat: 42.357, lon: -71.113 }));
  });
});
