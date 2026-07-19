import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PointProbeReport } from "../../render/cesium/inspection";
import { PointProbePanel } from "../PointProbePanel";
import { I18nProvider } from "../../lib/i18n";

const exportMocks = vi.hoisted(() => ({ downloadBlob: vi.fn(() => ({ ok: true })) }));
vi.mock("../../lib/export", () => ({
  downloadBlob: exportMocks.downloadBlob,
  exportFailureLabel: (code: string) => code,
}));

const REPORT: PointProbeReport = {
  domain: "nuclear",
  lat: 10,
  lon: 20,
  rangeM: 30_000,
  status: "1 displayed threshold reached",
  metrics: [{ label: "Threshold lower bounds", value: "5 psi", arrivalTimeS: 87.5 }],
  governingModel: "nuclear-direct-1.0.0",
  citations: ["Glasstone & Dolan (1977)"],
  assumptions: ["Level terrain"],
  confidence: "screening estimate",
  unknowns: ["Local shielding is not modeled"],
};

describe("PointProbePanel", () => {
  beforeEach(() => localStorage.clear());

  it("shows both comparison reports at one coordinate with full explainability", () => {
    render(<PointProbePanel primary={REPORT} comparison={{ ...REPORT, domain: "asteroid" }} />);
    expect(screen.getByText(/Slot A: 10.00°, 20.00°/)).toBeInTheDocument();
    expect(screen.getByText(/Slot B: 10.00°, 20.00°/)).toBeInTheDocument();
    expect(screen.getAllByText("nuclear-direct-1.0.0")).toHaveLength(2);
    expect(screen.getAllByText(/Glasstone & Dolan/)).toHaveLength(2);
    expect(screen.getAllByText(/Local shielding/)).toHaveLength(2);
  });

  it("exports structured text and CSV reports", async () => {
    exportMocks.downloadBlob.mockClear();
    const user = userEvent.setup();
    render(<PointProbePanel primary={REPORT} />);
    await user.click(screen.getByRole("button", { name: "Export probe text" }));
    await user.click(screen.getByRole("button", { name: "Export probe CSV" }));
    expect(exportMocks.downloadBlob).toHaveBeenNthCalledWith(
      1,
      expect.any(Blob),
      "cataclysm-point-probe.txt",
    );
    expect(exportMocks.downloadBlob).toHaveBeenNthCalledWith(
      2,
      expect.any(Blob),
      "cataclysm-point-probe.csv",
    );
  });

  it("localizes point-probe chrome and locale-aware coordinates in Japanese", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    render(<I18nProvider><PointProbePanel primary={REPORT} /></I18nProvider>);
    expect(screen.getByText("地点プローブ")).toBeInTheDocument();
    expect(screen.getByText("説明可能")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "プローブCSVをエクスポート" })).toBeInTheDocument();
    expect(screen.getByText(/震源から 30 km/)).toBeInTheDocument();
  });

  it("converts probe assumptions and range in imperial mode", async () => {
    localStorage.setItem("tsunamisim.units", JSON.stringify("imperial"));
    render(<PointProbePanel primary={{ ...REPORT, assumptions: ["Nominal 50 m depth"] }} />);
    expect(await screen.findByText(/18\.6 mi from source/)).toBeInTheDocument();
    expect(screen.getByText(/Nominal 164 ft depth/)).toBeInTheDocument();
  });
});
