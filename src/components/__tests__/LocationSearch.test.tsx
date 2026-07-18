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
    const match = await screen.findByRole("option", { name: /New York, NY.*city table/i });
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
    const match = await screen.findByRole(
      "option",
      { name: /02134.*Allston, MA/i },
      { timeout: 5_000 },
    );
    await user.click(match);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "zip", lat: 42.357, lon: -71.113 }));
  });

  it("selects an offline match with arrow keys and Enter", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<LocationSearch onSelect={onSelect} purpose="near" />);

    const input = screen.getByRole("combobox", { name: "Near a place I know" });
    await user.type(input, "Tokyo");
    await screen.findByRole("option", { name: /Tokyo/i });
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      kind: "city",
      name: expect.stringMatching(/Tokyo/i),
    }));
  });

  it("accepts pasted coordinates without a network lookup", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<LocationSearch onSelect={onSelect} purpose="target" />);

    await user.type(screen.getByRole("combobox", { name: "What if near…" }), "40.7128, -74.0060");
    const coordinate = await screen.findByRole("option", { name: /40\.7128.*-74\.0060/i });
    await user.click(coordinate);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      kind: "coordinate",
      lat: 40.7128,
      lon: -74.006,
    }));
  });
});
