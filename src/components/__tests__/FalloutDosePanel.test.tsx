import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  desktop: true,
  probe: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => mocks.desktop,
  api: { falloutDoseProbe: mocks.probe },
}));

import { FalloutDosePanel } from "../FalloutDosePanel";
import { I18nProvider } from "../../lib/i18n";
import type { FalloutDoseReport } from "../../hazards";

function sample(rate: number, cumulative: number) {
  return {
    timeH: 24,
    doseRateSvH: rate,
    doseRateMinSvH: rate,
    doseRateMaxSvH: rate,
    cumulativeDoseSv: cumulative,
    cumulativeDoseMinSv: cumulative,
    cumulativeDoseMaxSv: cumulative,
  };
}

const report: FalloutDoseReport = {
  model: "WSEG-10 H+1 field + Glasstone-Dolan t^-1.2 decay",
  fieldClass: "dangerous_fallout_field",
  downwindKm: 16,
  crosswindKm: 0,
  windSpeedKmh: 40,
  windShearMphPerKft: 0.2,
  arrivalTimeH: 0.9,
  hPlus1DoseRateSvH: 3.2,
  selectedTimeH: 24,
  shelterCurves: [
    { shelterType: "Open air", exposureFraction: 1, selected: sample(0.05, 0.6), points: [] },
    { shelterType: "Concrete building", exposureFraction: 0.1, selected: sample(0.005, 0.06), points: [] },
  ],
  citations: [{ label: "Hanifen 1980", url: "https://apps.dtic.mil/sti/citations/ADA083515" }],
  assumptions: ["Single constant wind."],
  uncertainty: ["Real winds can dominate."],
  disclaimer: "Educational scenario estimate — not operational guidance.",
};

function renderPanel() {
  return render(
    <I18nProvider>
      <FalloutDosePanel yieldKt={100} fissionFraction={0.5} />
    </I18nProvider>,
  );
}

describe("FalloutDosePanel", () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.probe.mockReset();
    localStorage.clear();
  });

  it("probes the Rust fallout model and renders its report", async () => {
    mocks.probe.mockResolvedValue(report);
    renderPanel();

    await waitFor(() => expect(mocks.probe).toHaveBeenCalled());
    expect(mocks.probe).toHaveBeenCalledWith(
      expect.objectContaining({ yieldKt: 100, fissionFraction: 0.5 }),
    );

    expect(await screen.findByText("Dangerous fallout field")).toBeInTheDocument();
    expect(screen.getByText("Open air")).toBeInTheDocument();
    expect(screen.getByText("Concrete building")).toBeInTheDocument();
    expect(
      screen.getByText("Educational scenario estimate — not operational guidance."),
    ).toBeInTheDocument();
    expect(screen.getByText("Hanifen 1980")).toBeInTheDocument();
  });

  it("does not call the backend outside the desktop app", async () => {
    mocks.desktop = false;
    renderPanel();

    expect(screen.getByText("Early fallout dose is computed in the desktop app.")).toBeInTheDocument();
    expect(mocks.probe).not.toHaveBeenCalled();
  });
});
