import { describe, it, expect } from "vitest";
import {
  findStyle,
  GLOBE_STYLES,
  DEFAULT_STYLE,
  OFFLINE_STYLE,
  resolveImageryStyle,
  terrainModeForStyle,
} from "../globe-styles";

describe("findStyle", () => {
  it("returns matching style by id", () => {
    const style = findStyle("osm");
    expect(style.id).toBe("osm");
    expect(style.requires_token).toBe(false);
  });

  it("returns default for unknown id", () => {
    const style = findStyle("nonexistent");
    expect(style.id).toBe(DEFAULT_STYLE);
  });

  it("returns default for null", () => {
    const style = findStyle(null);
    expect(style.id).toBe(DEFAULT_STYLE);
  });

  it("returns default for undefined", () => {
    const style = findStyle(undefined);
    expect(style.id).toBe(DEFAULT_STYLE);
  });

  it("marks token-requiring styles", () => {
    const cesiumImg = findStyle("cesium-world-imagery");
    expect(cesiumImg.requires_token).toBe(true);

    const cesiumBathy = findStyle("cesium-bathymetry");
    expect(cesiumBathy.requires_token).toBe(true);
  });

  it("marks free styles as not requiring token", () => {
    const osm = findStyle("osm");
    expect(osm.requires_token).toBe(false);

    const esri = findStyle("esri-world-imagery");
    expect(esri.requires_token).toBe(false);

    const ne = findStyle("natural-earth-2");
    expect(ne.requires_token).toBe(false);
  });
});

describe("DEFAULT_STYLE", () => {
  it("is high-res Esri World Imagery (no token, crisp on zoom)", () => {
    expect(DEFAULT_STYLE).toBe("esri-world-imagery");
  });
});

describe("resolveImageryStyle", () => {
  it("uses bundled Natural Earth immediately when an online style starts offline", () => {
    expect(resolveImageryStyle("esri-world-imagery", false, false)).toEqual({
      requestedStyle: "esri-world-imagery",
      resolvedStyle: OFFLINE_STYLE,
      fallbackReason: "offline",
    });
  });

  it("keeps bundled Natural Earth ready while offline", () => {
    expect(resolveImageryStyle(OFFLINE_STYLE, false, false)).toEqual({
      requestedStyle: OFFLINE_STYLE,
      resolvedStyle: OFFLINE_STYLE,
      fallbackReason: null,
    });
  });

  it("makes a missing token an explicit local fallback", () => {
    expect(resolveImageryStyle("cesium-world-imagery", true, false)).toEqual({
      requestedStyle: "cesium-world-imagery",
      resolvedStyle: OFFLINE_STYLE,
      fallbackReason: "missing-token",
    });
  });

  it("keeps the chosen online provider when prerequisites are healthy", () => {
    expect(resolveImageryStyle("cesium-world-imagery", true, true)).toEqual({
      requestedStyle: "cesium-world-imagery",
      resolvedStyle: "cesium-world-imagery",
      fallbackReason: null,
    });
  });
});

describe("GLOBE_STYLES", () => {
  it("has 5 entries", () => {
    expect(GLOBE_STYLES).toHaveLength(5);
  });

  it("every style has required fields", () => {
    for (const s of GLOBE_STYLES) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(typeof s.requires_token).toBe("boolean");
    }
  });
});

describe("terrainModeForStyle", () => {
  it("keeps the offline and token-free styles on the flat ellipsoid baseline", () => {
    expect(terrainModeForStyle("natural-earth-2")).toBe("ellipsoid");
    expect(terrainModeForStyle("osm")).toBe("ellipsoid");
    expect(terrainModeForStyle("esri-world-imagery")).toBe("ellipsoid");
  });

  it("separates land elevation from visual bathymetry", () => {
    expect(terrainModeForStyle("cesium-world-imagery")).toBe("world-terrain");
    expect(terrainModeForStyle("cesium-bathymetry")).toBe("bathymetry");
  });
});
