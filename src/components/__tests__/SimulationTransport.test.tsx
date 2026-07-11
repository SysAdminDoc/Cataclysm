import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SimulationTransport } from "../SimulationTransport";

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
});
