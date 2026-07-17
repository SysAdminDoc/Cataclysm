import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TimelineView } from "../TimelineView";
import type { Preset } from "../../types/scenario";

function makePreset(overrides: Partial<Preset> & { id: string; date: string }): Preset {
  return {
    name: overrides.id,
    blurb: "",
    reference: "",
    source: { kind: "Asteroid", source: {} as never },
    ...overrides,
  };
}

const PRESETS: Preset[] = [
  makePreset({ id: "chicxulub", date: "66 Ma", name: "Chicxulub Impact" }),
  makePreset({ id: "eltanin", date: "2.51 Ma", name: "Eltanin Impact" }),
  makePreset({ id: "storegga", date: "~8150 BP", name: "Storegga Slide", source: { kind: "Landslide", source: {} as never } }),
  makePreset({ id: "tohoku", date: "2011-03-11", name: "Tōhoku 2011", source: { kind: "Earthquake", source: {} as never } }),
  makePreset({ id: "poseidon", date: "-", name: "Poseidon", source: { kind: "Nuclear", source: {} as never } }),
];

describe("TimelineView", () => {
  it("renders markers for presets with parseable dates", () => {
    render(<TimelineView presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByTitle(/Chicxulub/)).toBeInTheDocument();
    expect(screen.getByTitle(/Tōhoku/)).toBeInTheDocument();
    expect(screen.getByTitle(/Storegga/)).toBeInTheDocument();
  });

  it("excludes presets with unparseable dates", () => {
    render(<TimelineView presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.queryByTitle(/Poseidon/)).not.toBeInTheDocument();
  });

  it("returns null when no presets have parseable dates", () => {
    const { container } = render(
      <TimelineView
        presets={[makePreset({ id: "x", date: "-" })]}
        activeId={null}
        onSelect={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("calls onSelect when a marker is clicked", async () => {
    const onSelect = vi.fn();
    render(<TimelineView presets={PRESETS} activeId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByTitle(/Tōhoku/));
    expect(onSelect).toHaveBeenCalledWith("tohoku");
  });

  it("marks the active preset", () => {
    render(<TimelineView presets={PRESETS} activeId="tohoku" onSelect={() => {}} />);
    const marker = screen.getByTitle(/Tōhoku/);
    expect(marker).toHaveAttribute("data-active", "true");
  });

  it("parses all preset date formats correctly", () => {
    render(<TimelineView presets={PRESETS} activeId={null} onSelect={() => {}} />);
    const markers = screen.getAllByRole("button");
    expect(markers.length).toBe(4);
  });

  it("shows Ancient and Recent axis labels", () => {
    render(<TimelineView presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("Ancient")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("communicates source categories without relying on marker color", () => {
    render(<TimelineView presets={PRESETS} activeId={null} onSelect={() => {}} />);
    const tohoku = screen.getByRole("button", { name: /Tōhoku 2011, Earthquake source/ });
    expect(tohoku).toHaveTextContent("Earthquake");
    expect(tohoku.querySelector(".timeline__dot")).toHaveAttribute("aria-hidden", "true");
  });
});
