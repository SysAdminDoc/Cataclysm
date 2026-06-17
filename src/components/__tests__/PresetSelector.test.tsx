import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { PresetSelector } from "../PresetSelector";
import type { Preset } from "../../types/scenario";

const PRESETS: Preset[] = [
  {
    id: "chicxulub",
    name: "Chicxulub Impact",
    date: "66 Ma",
    blurb: "14-km asteroid into a shallow Yucatan sea.",
    reference: "Range et al. 2022",
    source: { kind: "Asteroid", source: {} as never },
  },
  {
    id: "tohoku",
    name: "Tōhoku 2011",
    date: "2011-03-11",
    blurb: "M 9.1 megathrust earthquake off Japan.",
    reference: "Mori et al. 2011",
    source: { kind: "Earthquake", source: {} as never },
  },
  {
    id: "poseidon",
    name: "Poseidon",
    date: "—",
    blurb: "100 Mt underwater deployment.",
    reference: "DNA 1996",
    is_speculative: true,
    controversy_note: "Disputed propaganda-grade claim.",
    source: { kind: "Nuclear", source: {} as never },
  },
];

describe("PresetSelector", () => {
  it("renders all presets", () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("Chicxulub Impact")).toBeInTheDocument();
    expect(screen.getByText("Tōhoku 2011")).toBeInTheDocument();
    expect(screen.getByText("Poseidon")).toBeInTheDocument();
  });

  it("calls onSelect when a preset is clicked", async () => {
    const onSelect = vi.fn();
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Chicxulub Impact"));
    expect(onSelect).toHaveBeenCalledWith("chicxulub");
  });

  it("shows search input and filters presets", async () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);
    const search = screen.getByPlaceholderText(/search/i);
    await userEvent.type(search, "asteroid");
    expect(screen.getByText("Chicxulub Impact")).toBeInTheDocument();
    expect(screen.queryByText("Tōhoku 2011")).not.toBeInTheDocument();
  });

  it("shows empty state when no presets match", async () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);
    const search = screen.getByPlaceholderText(/search/i);
    await userEvent.type(search, "nonexistent");
    expect(screen.getByText("No matching presets")).toBeInTheDocument();
  });

  it("shows loading state when presets list is empty", () => {
    render(<PresetSelector presets={[]} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("Loading source library")).toBeInTheDocument();
  });

  it("marks the active preset with aria-pressed", () => {
    render(<PresetSelector presets={PRESETS} activeId="tohoku" onSelect={() => {}} />);
    const btn = screen.getByRole("button", { pressed: true });
    expect(btn).toHaveTextContent("Tōhoku 2011");
  });

  it("shows speculative badge on speculative presets", () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("Speculative")).toBeInTheDocument();
  });

  it("shows preset count in header", () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("3/3")).toBeInTheDocument();
  });
});
