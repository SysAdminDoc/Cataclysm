import { describe, it, expect } from "vitest";
import { findStyle, GLOBE_STYLES, DEFAULT_STYLE } from "../globe-styles";

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
  it("is local-first Natural Earth", () => {
    expect(DEFAULT_STYLE).toBe("natural-earth-2");
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
