import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { PresetSelector } from "../PresetSelector";
import type { Preset } from "../../types/scenario";
import { DIRECT_SCENARIOS } from "../../lib/scenario-library";

const PRESETS: Preset[] = [
  {
    id: "chicxulub",
    name: "Chicxulub Impact",
    date: "66 Ma",
    blurb: "14-km asteroid into a shallow Yucatan sea.",
    reference: "Range et al. 2022",
    source: {
      kind: "Asteroid",
      source: {
        diameter_m: 14_000,
        density_kg_m3: 2_700,
        velocity_m_s: 20_000,
        angle_deg: 45,
        water_depth_m: 1_500,
        location: { lat_deg: 21.4, lon_deg: -89.5 },
      },
    },
  },
  {
    id: "tohoku",
    name: "Tōhoku 2011",
    date: "2011-03-11",
    blurb: "M 9.1 megathrust earthquake off Japan.",
    reference: "Mori et al. 2011",
    source: {
      kind: "Earthquake",
      source: {
        mw: 9.1,
        depth_m: 24_000,
        strike_deg: 195,
        dip_deg: 14,
        rake_deg: 81,
        slip_m: 24,
        water_depth_m: 6_000,
        location: { lat_deg: 38.3, lon_deg: 142.37 },
      },
    },
  },
  {
    id: "poseidon",
    name: "Poseidon",
    date: "—",
    blurb: "100 Mt underwater deployment.",
    reference: "DNA 1996",
    is_speculative: true,
    controversy_note: "Disputed propaganda-grade claim.",
    source: {
      kind: "Nuclear",
      source: {
        yield_kt: 100_000,
        burst_mode: "DeepOptimal",
        burst_depth_m: 600,
        water_depth_m: 4_000,
        location: { lat_deg: 0, lon_deg: 0 },
      },
    },
  },
];

describe("PresetSelector", () => {
  it("renders all presets", () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("Chicxulub Impact")).toBeInTheDocument();
    expect(screen.getByText("Tōhoku 2011")).toBeInTheDocument();
    expect(screen.getByText("Poseidon")).toBeInTheDocument();
  });

  it("groups recorded and what-if scenarios from preset metadata", () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByRole("heading", { name: "Recorded events" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What-if studies" })).toBeInTheDocument();
    expect(screen.getByLabelText("2 scenarios")).toBeInTheDocument();
    expect(screen.getByLabelText("1 scenario")).toBeInTheDocument();
  });

  it("shows compact source-specific metadata", () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("14 km body")).toBeInTheDocument();
    expect(screen.getByText("M_w 9.1")).toBeInTheDocument();
    expect(screen.getByText("100 Mt yield")).toBeInTheDocument();
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
    render(<PresetSelector presets={PRESETS} activeId="tohoku" onSelect={() => {}} onRunActive={() => {}} />);
    const pressed = screen.getAllByRole("button", { pressed: true });
    const presetBtn = pressed.find((b) => b.classList.contains("preset-card"));
    expect(presetBtn).toBeDefined();
    expect(presetBtn).toHaveTextContent("Tōhoku 2011");
    const selectedScenario = screen.getByRole("region", { name: "Selected scenario" });
    expect(selectedScenario).toHaveTextContent("Tōhoku 2011");
    expect(selectedScenario).toHaveTextContent("M_w 9.1 · 2011-03-11");
    expect(selectedScenario).toHaveTextContent("M 9.1 megathrust earthquake off Japan.");
    expect(selectedScenario).toHaveTextContent("Why trust this?");
  });

  it("shows what-if badge on speculative presets", () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByLabelText("Hypothetical or contested")).toHaveTextContent("What-if");
  });

  it("preserves recorded and what-if filters across card and timeline views", async () => {
    const user = userEvent.setup();
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);

    await user.click(screen.getByRole("button", { name: "What-if" }));
    expect(screen.getByText("Poseidon")).toBeInTheDocument();
    expect(screen.queryByText("Tōhoku 2011")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recorded events" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Timeline" }));
    expect(screen.getByText("No dated timeline events")).toBeInTheDocument();
    expect(screen.queryByText("Tōhoku 2011")).not.toBeInTheDocument();
  });

  it("classifies imported historical direct scenarios as recorded", async () => {
    const user = userEvent.setup();
    const recorded = DIRECT_SCENARIOS.find((scenario) => scenario.classification === "recorded")!;
    const whatIf = DIRECT_SCENARIOS.find((scenario) => scenario.classification === "what-if")!;
    render(
      <PresetSelector
        presets={[]}
        activeId={null}
        onSelect={() => {}}
        directScenarios={[whatIf, recorded]}
        onSelectDirect={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Recorded" }));
    expect(screen.getByText(recorded.name)).toBeInTheDocument();
    expect(screen.queryByText(whatIf.name)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hypothetical or contested")).not.toBeInTheDocument();
  });

  it("shows preset count in header", () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("3/3")).toBeInTheDocument();
  });

  it("shows completed guided lesson state", async () => {
    const user = userEvent.setup();
    render(
      <PresetSelector
        presets={PRESETS}
        activeId={null}
        onSelect={() => {}}
        onStartLesson={() => {}}
        completedLessons={{ "chicxulub-extinction": "2026-07-01T00:00:00.000Z" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Guided training/i }));

    const completedLesson = screen.getByRole("button", {
      name: /Chicxulub: The extinction-level tsunami/i,
    });
    expect(completedLesson).toHaveAttribute("data-complete", "true");
    expect(screen.getByLabelText("Lesson completed")).toHaveTextContent("Done");
  });

  it("exposes the three Quick Start choices and a disabled recent action", () => {
    render(<PresetSelector presets={PRESETS} activeId={null} onSelect={() => {}} directScenarios={DIRECT_SCENARIOS} />);

    expect(screen.getByRole("button", { name: /Watch a famous event/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Explore a what-if/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Create my own/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Continue recent/i })).toBeDisabled();
  });

  it("previews direct scenarios without running until the primary action is used", async () => {
    const user = userEvent.setup();
    const onSelectDirect = vi.fn();
    const onRunActive = vi.fn();
    const scenario = DIRECT_SCENARIOS[0];
    const { rerender } = render(
      <PresetSelector
        presets={PRESETS}
        activeId={null}
        onSelect={() => {}}
        directScenarios={[scenario]}
        onSelectDirect={onSelectDirect}
        onRunActive={onRunActive}
      />,
    );

    await user.click(screen.getByRole("button", { name: new RegExp(scenario.name, "i") }));
    expect(onSelectDirect).toHaveBeenCalledWith(scenario);
    expect(onRunActive).not.toHaveBeenCalled();

    rerender(
      <PresetSelector
        presets={PRESETS}
        activeId={null}
        activeDirectId={scenario.id}
        onSelect={() => {}}
        directScenarios={[scenario]}
        onSelectDirect={onSelectDirect}
        onRunActive={onRunActive}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Run & Watch" }));
    expect(onRunActive).toHaveBeenCalledTimes(1);
  });

  it("favorites the selected scenario and filters to saved choices", async () => {
    const user = userEvent.setup();
    const onToggleFavorite = vi.fn();
    const { rerender } = render(
      <PresetSelector
        presets={PRESETS}
        activeId="chicxulub"
        onSelect={() => {}}
        onToggleFavorite={onToggleFavorite}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Favorite selected scenario" }));
    expect(onToggleFavorite).toHaveBeenCalledWith("preset:chicxulub");

    rerender(
      <PresetSelector
        presets={PRESETS}
        activeId="chicxulub"
        onSelect={() => {}}
        favoriteIds={["preset:chicxulub"]}
        onToggleFavorite={onToggleFavorite}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Favorites" }));
    expect(screen.getByText("Chicxulub Impact")).toBeInTheDocument();
    expect(screen.queryByText("Poseidon")).not.toBeInTheDocument();
  });
});
