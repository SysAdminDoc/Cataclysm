import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWw3ExchangePlan } from "../../lib/ww3";
import { WW3ExchangeHud, WW3ExchangePanel } from "../WW3Exchange";
import { I18nProvider } from "../../lib/i18n";

describe("WW3ExchangePanel", () => {
  beforeEach(() => localStorage.clear());

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

  it("localizes scenario framing, controls, and the exchange HUD in Japanese", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    const plan = buildWw3ExchangePlan("first_strike_us", "counterforce");
    render(
      <I18nProvider>
        <WW3ExchangePanel session={null} onStart={() => {}} onPause={() => {}} onResume={() => {}} onStop={() => {}} />
        <WW3ExchangeHud session={{ plan, visibleStrikeCount: 10, speed: 5, state: "running" }} />
      </I18nProvider>,
    );
    expect(screen.getByText("世界規模交換ラボ")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "目標区分" })).toBeInTheDocument();
    expect(screen.getAllByText("世界熱核戦争")).toHaveLength(2);
    expect(screen.getByRole("complementary", { name: "例示的世界規模交換の状態" })).toBeInTheDocument();
    expect(screen.getAllByText("米国によるロシア先制攻撃")).toHaveLength(2);
    expect(screen.getByText("米国先制攻撃")).toBeInTheDocument();
  });
});
