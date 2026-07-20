import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SimulationTransport } from "../SimulationTransport";
import type { SecondaryEffectEvent } from "../../hazards";

function effect(id: string, onsetSeconds: number, timeLabel: string, title: string): SecondaryEffectEvent {
  return {
    id,
    onsetSeconds,
    timeLabel,
    title,
    summary: `${title} summary`,
    metricLabel: "Modeled value",
    metricValue: "Screening",
    category: "climate",
    confidence: "qualitative_scenario",
    uncertainty: "Scenario uncertainty.",
    citations: [{ label: "Primary source", url: "https://example.com/source" }],
  };
}

const baseProps = {
  timeS: 900,
  onTimeChange: vi.fn(),
  playing: false,
  onTogglePlaying: vi.fn(),
  rate: 1,
  onRateChange: vi.fn(),
  hasSource: true,
  sourceLabel: "Tohoku 2011",
  solverReady: true,
  domain: "tsunami" as const,
  frameCount: 60,
  onOpenDetails: vi.fn(),
};

describe("SimulationTransport", () => {
  it("reports solver frames and scenario time", () => {
    render(<SimulationTransport {...baseProps} durationS={3600} />);
    expect(screen.getByText("60 frames ready")).toBeInTheDocument();
    expect(screen.getByLabelText("Scenario time 00:15:00")).toBeInTheDocument();
    expect(screen.getByText("16 / 60")).toBeInTheDocument();
    expect(screen.getByText("15 min / 60 min")).toBeInTheDocument();
    expect(screen.getByLabelText("Scenario timeline scrubber")).toHaveAttribute("max", "3600");
    expect(screen.getByRole("button", { name: "Details" })).toBeEnabled();
  });

  it("uses a truthful effect status outside tsunami mode", () => {
    render(<SimulationTransport {...baseProps} domain="nuclear" solverReady={false} frameCount={0} />);
    expect(screen.getByText("Nuclear effects ready")).toBeInTheDocument();
    expect(screen.queryByLabelText("Scenario timeline scrubber")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open setup" })).toBeEnabled();
  });

  it("maps irregular asteroid aftermath phases onto the shared scrubber", async () => {
    const onTimeChange = vi.fn();
    const user = userEvent.setup();
    const effectTimeline = [
      effect("seismic", 5, "seconds", "Equivalent seismic shaking"),
      effect("dust", 86_400, "days", "Dust and sulfur spread"),
      effect("winter", 31_536_000, "years", "Long climate recovery tail"),
    ];
    render(
      <SimulationTransport
        {...baseProps}
        domain="asteroid"
        solverReady={false}
        frameCount={0}
        timeS={86_400}
        durationS={31_536_000}
        effectTimeline={effectTimeline}
        onTimeChange={onTimeChange}
      />,
    );

    const scrubber = screen.getByLabelText("Long-term impact timeline scrubber");
    expect(scrubber).toHaveAttribute("max", "2");
    expect(scrubber).toHaveValue("1");
    expect(screen.getByLabelText("Impact aftermath: days")).toBeInTheDocument();
    expect(screen.getByText("Phase 2 / 3")).toBeInTheDocument();
    expect(screen.getByText("Rust-authored")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset long-term impact timeline" }));
    expect(onTimeChange).toHaveBeenCalledWith(5);
  });

  it("restarts from source time when Play is pressed at the end", async () => {
    const onTimeChange = vi.fn();
    const onTogglePlaying = vi.fn();
    const user = userEvent.setup();
    render(
      <SimulationTransport
        {...baseProps}
        timeS={3600}
        durationS={3600}
        onTimeChange={onTimeChange}
        onTogglePlaying={onTogglePlaying}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Play scenario timeline" }));
    expect(onTimeChange).toHaveBeenCalledWith(0);
    expect(onTogglePlaying).toHaveBeenCalledTimes(1);
  });
});
