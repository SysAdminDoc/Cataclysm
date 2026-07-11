import { Cartesian3 } from "cesium";
import { describe, expect, it } from "vitest";
import {
  convertVerticalHeight,
  ecefToLocalEnu,
  enuToUnrealCm,
  geodeticToEcef,
  getGeodesyDiagnosticsSnapshot,
} from "../geodesy";
import {
  asteroidTargetFromSurface,
  classifySurface,
  probeSurfaceLocal,
  surfaceBurstTypeFromSurface,
} from "../surface";

describe("renderer-neutral geodesy contract", () => {
  it("keeps Rust-formula, Cesium ECEF, and Unreal ENU fixtures within the declared budgets", () => {
    const contract = getGeodesyDiagnosticsSnapshot();
    expect(contract.coastal_benchmarks).toHaveLength(3);
    for (const fixture of contract.coastal_benchmarks) {
      const ellipsoidHeight = convertVerticalHeight(
        fixture.orthometric_height_m,
        "navd88_geoid18",
        "wgs84_ellipsoid",
        { geoidUndulationM: fixture.geoid_undulation_m },
      );
      expect(ellipsoidHeight).toBeCloseTo(fixture.ellipsoid_height_m, 6);

      const position = {
        latDeg: fixture.lat_deg,
        lonDeg: fixture.lon_deg,
        ellipsoidHeightM: ellipsoidHeight,
      };
      const rustFormula = geodeticToEcef(position);
      const cesium = Cartesian3.fromDegrees(fixture.lon_deg, fixture.lat_deg, ellipsoidHeight);
      for (const [actual, expected] of [rustFormula.xM, rustFormula.yM, rustFormula.zM]
        .map((value, index) => [value, fixture.expected_ecef_m[index]] as const)) {
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(contract.error_budget.geodetic_to_ecef_m);
      }
      expect(Math.abs(cesium.x - rustFormula.xM)).toBeLessThanOrEqual(contract.error_budget.geodetic_to_ecef_m);
      expect(Math.abs(cesium.y - rustFormula.yM)).toBeLessThanOrEqual(contract.error_budget.geodetic_to_ecef_m);
      expect(Math.abs(cesium.z - rustFormula.zM)).toBeLessThanOrEqual(contract.error_budget.geodetic_to_ecef_m);

      const unreal = enuToUnrealCm(ecefToLocalEnu(rustFormula, { ...position, ellipsoidHeightM: 0 }));
      const actualUnreal = [unreal.xEastCm, unreal.yNorthCm, unreal.zUpCm];
      fixture.expected_unreal_local_cm.forEach((expected, index) => {
        expect(Math.abs(actualUnreal[index] - expected)).toBeLessThanOrEqual(
          contract.error_budget.ecef_to_local_enu_m * 100,
        );
      });
    }
  });

  it("fails closed when a vertical conversion lacks a geoid or tide model", () => {
    expect(() => convertVerticalHeight(0, "wgs84_ellipsoid", "navd88_geoid18")).toThrow(/geoid/i);
    expect(() => convertVerticalHeight(0, "idealized_mean_sea_level", "wgs84_ellipsoid")).toThrow(/unsupported/i);
  });
});

describe("shared surface mask", () => {
  it("classifies ocean, inland water, land, ice, coast, and invalid coordinates deterministically", () => {
    expect(classifySurface(0, -150)).toBe("ocean");
    expect(classifySurface(45, -83)).toBe("inland_water");
    expect(classifySurface(0, 20)).toBe("land");
    expect(classifySurface(72, -40)).toBe("ice");
    expect(classifySurface(-15, -82.1)).toBe("coast");
    expect(classifySurface(Number.NaN, 0)).toBe("unknown");
  });

  it("carries CRS, datum, version, confidence, and declared error on every probe", () => {
    expect(probeSurfaceLocal(0, -150)).toMatchObject({
      surface_class: "ocean",
      is_wet: true,
      mask_version: "1.0.0",
      mask_source_asset_id: "cataclysm-coarse-bathymetry-v1",
      confidence: "low",
      height_field: {
        horizontal_crs: "EPSG:4326",
        vertical_datum: "depth_below_idealized_mean_sea_level",
        vertical_axis: "positive_down",
        unit: "metre",
      },
    });
  });

  it("drives impact collision response while preserving ambiguous coasts", () => {
    expect(asteroidTargetFromSurface("ocean")).toBe("water");
    expect(asteroidTargetFromSurface("inland_water")).toBe("water");
    expect(asteroidTargetFromSurface("land")).toBe("sedimentary_rock");
    expect(asteroidTargetFromSurface("ice")).toBe("sedimentary_rock");
    expect(asteroidTargetFromSurface("coast")).toBeNull();
    expect(surfaceBurstTypeFromSurface("surface", "ocean")).toBe("water");
    expect(surfaceBurstTypeFromSurface("water", "land")).toBe("surface");
    expect(surfaceBurstTypeFromSurface("airburst", "ocean")).toBe("airburst");
  });
});
