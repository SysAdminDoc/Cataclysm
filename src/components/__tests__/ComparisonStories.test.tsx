import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComparisonStories } from "../ComparisonStories";
import type { InitialDisplacement, Preset } from "../../types/scenario";
import { I18nProvider } from "../../lib/i18n";

const PRESETS = [
  ["tohoku_2011", "Tōhoku 2011"],
  ["indian_ocean_2004", "Indian Ocean 2004"],
  ["chicxulub", "Chicxulub"],
  ["eltanin", "Eltanin"],
  ["poseidon_realistic", "Poseidon (physics)"],
  ["poseidon_propaganda", "Poseidon (claim)"],
].map(([id, name]) => ({ id, name, date: "Reference", source: { kind: "Earthquake", source: {} } })) as Preset[];

const initial = (peak: number): InitialDisplacement => ({
  center: { lat_deg: 0, lon_deg: 0 },
  cavity_radius_m: 1_000,
  peak_amplitude_m: peak,
  source_energy_j: peak * 1e15,
  seismic_mw_equivalent: 0,
  label: "Fixture",
});

describe("ComparisonStories", () => {
  beforeEach(() => localStorage.clear());

  it("starts curated pairs and exposes objective source deltas", async () => {
    const onSelectStory = vi.fn();
    render(
      <ComparisonStories
        presets={PRESETS}
        activePresetAId="tohoku_2011"
        activePresetBId="indian_ocean_2004"
        initialA={initial(20)}
        initialB={initial(5)}
        busy={false}
        onSelectStory={onSelectStory}
        onSelectCustomB={() => {}}
      />,
    );

    expect(screen.getByRole("region", { name: "Comparison stories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Two ocean-basin megathrusts/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("A 20 m · B 5.0 m")).toBeInTheDocument();
    expect(screen.getAllByText("4.0× larger in Slot A")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: /Asteroid ocean-impact scale/ }));
    expect(onSelectStory).toHaveBeenCalledWith(expect.objectContaining({ id: "asteroid-scale-ladder" }));
  });

  it("retains the advanced custom Slot B selector and retry state", async () => {
    const onSelectCustomB = vi.fn();
    const onRetry = vi.fn();
    render(
      <ComparisonStories
        presets={PRESETS}
        activePresetAId="tohoku_2011"
        activePresetBId={null}
        initialA={initial(1)}
        initialB={null}
        busy={false}
        onSelectStory={() => {}}
        onSelectCustomB={onSelectCustomB}
        error="backend unavailable"
        onRetry={onRetry}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Compare against"), "chicxulub");
    expect(onSelectCustomB).toHaveBeenCalledWith("chicxulub");
    await userEvent.click(screen.getByRole("button", { name: "Retry Slot B" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("converts comparison length metrics in imperial mode", async () => {
    localStorage.setItem("tsunamisim.units", JSON.stringify("imperial"));
    render(
      <ComparisonStories
        presets={PRESETS}
        activePresetAId="tohoku_2011"
        activePresetBId="indian_ocean_2004"
        initialA={initial(20)}
        initialB={initial(5)}
        busy={false}
        onSelectStory={() => {}}
        onSelectCustomB={() => {}}
      />,
    );
    expect(await screen.findByText("A 65.6 ft · B 16.4 ft")).toBeInTheDocument();
  });

  it("localizes curated stories, metrics, and advanced controls in Japanese", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    render(
      <I18nProvider>
        <ComparisonStories
          presets={PRESETS}
          activePresetAId="tohoku_2011"
          activePresetBId="indian_ocean_2004"
          initialA={initial(20)}
          initialB={initial(5)}
          busy={false}
          onSelectStory={() => {}}
          onSelectCustomB={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("region", { name: "比較ストーリー" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2つの海洋巨大地震/ })).toBeInTheDocument();
    expect(screen.getByText("震源最大振幅")).toBeInTheDocument();
    expect(screen.getAllByText("スロットAが 4.0倍大きい")).toHaveLength(2);
    expect(screen.getByLabelText("比較対象")).toBeInTheDocument();
  });
});
