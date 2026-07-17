import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildWw3ExchangePlan } from "../../lib/ww3";
import { WW3ExchangeHud, WW3ExchangePanel } from "../WW3Exchange";

describe("WW3ExchangePanel", () => {
  it("presents every scenario and starts the deterministic global plan", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(
      <WW3ExchangePanel
        session={null}
        onStart={onStart}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Scenario" }).querySelectorAll("option")).toHaveLength(7);
    expect(screen.getByText("712")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run illustrative exchange" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0].strikes).toHaveLength(712);
    expect(onStart.mock.calls[0][1]).toBe(5);
  });

  it("renders an accessible progress HUD from the completed-strike prefix", () => {
    const plan = buildWw3ExchangePlan("first_strike_us", "counterforce");
    render(<WW3ExchangeHud session={{ plan, visibleStrikeCount: 10, speed: 5, state: "running" }} />);
    expect(screen.getByRole("complementary", { name: "Illustrative global exchange status" })).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "1");
    expect(screen.getByText(/not a forecast/i)).toBeInTheDocument();
  });
});
