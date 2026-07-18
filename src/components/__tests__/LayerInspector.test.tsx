import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerInspector } from "../LayerInspector";
import { I18nProvider } from "../../lib/i18n";

describe("LayerInspector trust evidence", () => {
  beforeEach(() => localStorage.clear());

  it("provides a contextual evidence disclosure for every analytical layer", async () => {
    const user = userEvent.setup();
    render(
      <LayerInspector
        domain="tsunami"
        hasSource
        hasWavefront
        hasSweField
        hasMaxField
        arrivalCount={3}
        runupCount={2}
        dartCount={1}
        hasFallout={false}
        onOpenSettings={vi.fn()}
      />,
    );

    const disclosures = screen.getAllByText("Why trust this?");
    expect(disclosures).toHaveLength(8);
    await user.click(disclosures[2]);
    expect(screen.getByText("Finite-volume shallow-water-equation solver")).toBeInTheDocument();
    expect(screen.getByText("layer:custom:scenario:swe-field")).toBeInTheDocument();
  });

  it("shows each inactive layer state once without duplicating Waiting in evidence", () => {
    render(
      <LayerInspector
        domain="tsunami"
        hasSource={false}
        hasWavefront={false}
        hasSweField={false}
        hasMaxField={false}
        arrivalCount={0}
        runupCount={0}
        dartCount={0}
        hasFallout={false}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Waiting")).toHaveLength(7);
    expect(screen.getAllByText("Evidence")).toHaveLength(7);
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("requires explicit opt-in and lists grouped OSM facilities with limitations", async () => {
    const user = userEvent.setup();
    const onEnabledChange = vi.fn();
    render(
      <LayerInspector
        domain="tsunami"
        hasSource
        hasWavefront
        hasSweField={false}
        hasMaxField={false}
        arrivalCount={0}
        runupCount={1}
        dartCount={0}
        hasFallout={false}
        humanitarianEnabled
        humanitarianState={{
          status: "ready",
          facilities: [{
            id: "node/7",
            osmType: "node",
            osmId: 7,
            osmUrl: "https://www.openstreetmap.org/node/7",
            name: "Harbor Clinic",
            category: "health",
            kind: "clinic",
            lat: 38,
            lon: 142,
            runupPointIds: ["coast-1"],
          }],
          message: "Mapped 1 facility inside the screened extents.",
          cached: false,
          stale: false,
          fetchedAt: 1,
          osmDataTimestamp: "2026-07-17T15:00:00Z",
          plan: {
            signature: "v1-test",
            query: "query",
            discs: [{ id: "coast-1", name: "Coast", lat: 38, lon: 142, radiusM: 1000 }],
            totalEligibleDiscs: 1,
            truncatedDiscCount: 0,
            clampedDiscCount: 0,
          },
        }}
        onHumanitarianEnabledChange={onEnabledChange}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "Harbor Clinic" })).toHaveAttribute("href", "https://www.openstreetmap.org/node/7");
    expect(screen.getByText(/does not establish damage, operability, access/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Show humanitarian facilities from OpenStreetMap" }));
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });

  it("localizes analytical layers and humanitarian privacy states", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    render(
      <I18nProvider>
        <LayerInspector
          domain="tsunami"
          hasSource
          hasWavefront
          hasSweField={false}
          hasMaxField={false}
          arrivalCount={2}
          runupCount={1}
          dartCount={0}
          hasFallout={false}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("可視化レイヤー")).toBeInTheDocument();
    expect(screen.getByText("解析的波面")).toBeInTheDocument();
    expect(screen.getByText("人道支援施設")).toBeInTheDocument();
    expect(screen.getAllByText("信頼性の根拠").length).toBeGreaterThan(0);
    expect(screen.getByRole("checkbox", { name: "OpenStreetMapの人道支援施設を表示" })).toBeInTheDocument();
    expect(screen.getByText(/シナリオ名と発生源パラメータは送信しません/)).toBeInTheDocument();
  });
});
