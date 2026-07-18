import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitialDisplacement, Preset } from "../../types/scenario";
import { SourceModelSummary } from "../SourceModelSummary";
import { I18nProvider } from "../../lib/i18n";

const initial: InitialDisplacement = {
  center: { lat_deg: 38.3, lon_deg: 142.37, depth_m: 1_500 },
  cavity_radius_m: 1_000,
  peak_amplitude_m: 40,
  source_energy_j: 1e18,
  seismic_mw_equivalent: 9.1,
  label: "Tohoku",
};

const preset: Preset = {
  id: "tohoku",
  name: "Tohoku 2011",
  date: "2011-03-11",
  blurb: "Reference earthquake",
  reference: "Okada",
  source: {
    kind: "Earthquake",
    source: {
      mw: 9.1,
      depth_m: 1_500,
      strike_deg: 193,
      dip_deg: 14,
      rake_deg: 81,
      slip_m: 20,
      water_depth_m: 1_500,
      location: initial.center,
    },
  },
};

describe("SourceModelSummary", () => {
  beforeEach(() => localStorage.clear());

  it("shows a clear empty source state", () => {
    render(<SourceModelSummary preset={null} initial={null} onEdit={vi.fn()} />);
    expect(screen.getByText("No active source")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("renders source provenance, contextual evidence, and edit action", () => {
    render(<SourceModelSummary preset={preset} initial={initial} onEdit={vi.fn()} />);
    expect(screen.getByText("Tohoku 2011")).toBeInTheDocument();
    expect(screen.getByText("Okada dislocation model")).toBeInTheDocument();
    expect(screen.getByText("Why trust this?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit source parameters" })).toBeEnabled();
  });

  it("localizes source type, model metadata, confidence, and actions", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    render(
      <I18nProvider>
        <SourceModelSummary preset={preset} initial={initial} onEdit={vi.fn()} />
      </I18nProvider>,
    );

    expect(screen.getAllByText("発生源モデル")).toHaveLength(2);
    expect(screen.getByText("地震")).toBeInTheDocument();
    expect(screen.getByText("Okada断層変位モデル")).toBeInTheDocument();
    expect(screen.getAllByText("参照データ")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "発生源パラメータを編集" })).toBeEnabled();
  });
});
