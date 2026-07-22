import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerInspector } from "../LayerInspector";
import { I18nProvider } from "../../lib/i18n";
import { defaultLayerState, updateLayerSetting } from "../../lib/layer-controller";
import { publishEarthSession } from "../../lib/earth-assets";

describe("LayerInspector trust evidence", () => {
  beforeEach(() => {
    localStorage.clear();
    publishEarthSession({
      requestedStyle: "natural-earth-2",
      resolvedStyle: "natural-earth-2",
      fallbackReason: null,
      health: "ready",
    });
  });

  it("states whether overlays use terrain draping without implying solver coupling", () => {
    publishEarthSession({
      requestedStyle: "cesium-world-imagery",
      resolvedStyle: "cesium-world-imagery",
      fallbackReason: null,
      health: "ready",
      dynamicAttributions: ["Cesium World Terrain"],
    });
    render(
      <LayerInspector
        domain="nuclear"
        hasSource
        hasWavefront={false}
        hasSweField={false}
        hasMaxField={false}
        arrivalCount={0}
        runupCount={0}
        dartCount={0}
        hasFallout
        layerState={defaultLayerState("nuclear")}
        timeS={0}
        onLayerStateChange={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByText(/Terrain draping on/)).toHaveTextContent("Solver fields are unchanged.");
  });

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
        layerState={defaultLayerState("tsunami")}
        timeS={1800}
        onLayerStateChange={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const disclosures = screen.getAllByText("Why trust this?");
    expect(disclosures).toHaveLength(8);
    expect(screen.getByText("MODELED INUNDATION · NON-OPERATIONAL")).toBeInTheDocument();
    expect(screen.getByText(/Unshaded areas are not confirmed safe/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Modeled coastal screening-height legend")).toHaveTextContent("0.1–<2 m");
    expect(screen.getByRole("link", { name: "IOC-informed map-reading guidance" })).toHaveAttribute(
      "href",
      "https://tsunami.ioc.unesco.org/en/tsunami-ready",
    );
    const sweRow = screen.getByText("SWE water field").closest("li");
    expect(sweRow).not.toBeNull();
    await user.click(within(sweRow!).getByText("Legend and provenance"));
    await user.click(within(sweRow!).getByText("Why trust this?"));
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
        layerState={defaultLayerState("tsunami")}
        timeS={0}
        onLayerStateChange={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Needs data")).toHaveLength(8);
    expect(screen.getAllByRole("checkbox")).toHaveLength(8);
    expect(screen.getByText("Run the SWE solver to create a surface field.")).toBeInTheDocument();
  });

  it("requires explicit opt-in and lists grouped OSM facilities with limitations", async () => {
    const user = userEvent.setup();
    const onLayerStateChange = vi.fn();
    const visibleFacilities = updateLayerSetting(defaultLayerState("tsunami"), "humanitarian-facilities", { visible: true });
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
        layerState={visibleFacilities}
        timeS={1200}
        onLayerStateChange={onLayerStateChange}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "Harbor Clinic" })).toHaveAttribute("href", "https://www.openstreetmap.org/node/7");
    expect(screen.getByText(/does not establish damage, operability, access/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Show humanitarian facilities from OpenStreetMap" }));
    expect(onLayerStateChange).toHaveBeenCalledWith(expect.objectContaining({
      "humanitarian-facilities": expect.objectContaining({ visible: false }),
    }));
  });

  it("keeps USGS official products visibly separate from modeled output", () => {
    render(
      <LayerInspector
        domain="tsunami"
        hasSource
        hasWavefront={false}
        hasSweField={false}
        hasMaxField={false}
        arrivalCount={0}
        runupCount={0}
        dartCount={0}
        hasFallout={false}
        usgsComparison={{
          eventId: "us7000test",
          title: "Test event",
          eventUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test",
          fetchedAtMs: 1,
          stale: true,
          pager: { alertLevel: "yellow", maxMmi: 7, reviewStatus: "reviewed" },
          shakemap: {
            maxMmi: 7,
            mapStatus: "RELEASED",
            reviewStatus: "reviewed",
            processTimestamp: null,
            bounds: [140, 36, 144, 40],
            contours: [{ mmi: 6, color: "#e5383b", points: [[141, 37], [143, 39]] }],
          },
        }}
        layerState={defaultLayerState("tsunami")}
        timeS={0}
        onLayerStateChange={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByText("USGS official comparison")).toBeInTheDocument();
    expect(screen.getByText("Showing the last event-detail cache from this device.")).toBeInTheDocument();
    expect(screen.getByText("Comparison product only; not a live warning.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the cited USGS event" })).toHaveAttribute("href", expect.stringContaining("us7000test"));
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
          layerState={defaultLayerState("tsunami")}
          timeS={0}
          onLayerStateChange={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("可視化レイヤー")).toBeInTheDocument();
    expect(screen.getByText("解析的波面")).toBeInTheDocument();
    expect(screen.getByText("人道支援施設")).toBeInTheDocument();
    expect(screen.getAllByText("凡例と由来").length).toBeGreaterThan(0);
    expect(screen.getByRole("checkbox", { name: "OpenStreetMapの人道支援施設を表示" })).toBeInTheDocument();
  });

  it("exposes native keyboard controls for visibility, opacity, order, and reset", async () => {
    const user = userEvent.setup();
    const onLayerStateChange = vi.fn();
    render(
      <LayerInspector
        domain="nuclear"
        hasSource
        hasWavefront={false}
        hasSweField={false}
        hasMaxField={false}
        arrivalCount={0}
        runupCount={0}
        dartCount={0}
        hasFallout
        layerState={defaultLayerState("nuclear")}
        timeS={0}
        onLayerStateChange={onLayerStateChange}
        onOpenSettings={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Show Fallout plume" }));
    expect(onLayerStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      "fallout-plume": expect.objectContaining({ visible: false }),
    }));

    fireEvent.change(screen.getByRole("slider", { name: "Opacity for Hazard effect rings" }), {
      target: { value: "55" },
    });
    expect(onLayerStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      "hazard-rings": expect.objectContaining({ opacity: 0.55 }),
    }));

    await user.click(screen.getByRole("button", { name: "Move Effects origin up" }));
    expect(onLayerStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      source: expect.objectContaining({ order: 1 }),
    }));

    await user.click(screen.getByRole("button", { name: "Reset scenario layers to defaults" }));
    expect(onLayerStateChange).toHaveBeenLastCalledWith(defaultLayerState("nuclear"));
  });
});
