import { describe, expect, it } from "vitest";

import {
  formatArea,
  formatDepth,
  formatEmbeddedLengthValues,
  formatEnergy,
  formatLength,
  formatMassDensity,
  formatPopulationDensity,
  formatReadoutValue,
  formatSpeed,
  formatVolume,
  quantityText,
} from "../units";

const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat("en-US", options).format(value);

describe("units", () => {
  it("formats signed lengths and depths in the selected system", () => {
    expect(quantityText(formatLength(1_500, formatNumber, "metric"))).toBe("1.5 km");
    expect(quantityText(formatLength(1_500, formatNumber, "imperial"))).toBe("0.9 mi");
    expect(quantityText(formatLength(0.03, formatNumber, "metric"))).toBe("3 cm");
    expect(quantityText(formatDepth(-2_000, formatNumber, "metric"))).toBe("-2 km");
    expect(quantityText(formatDepth(-2_000, formatNumber, "imperial"))).toBe("-1.2 mi");
    expect(quantityText(formatLength(0.05, formatNumber, "imperial"))).toBe("0.16 ft");
  });

  it("formats speed, area, density, and volume without changing SI inputs", () => {
    expect(quantityText(formatSpeed(10, formatNumber, "imperial"))).toBe("22.4 mph");
    expect(quantityText(formatArea(2_589_988.110336, formatNumber, "imperial"))).toBe("1 mi²");
    expect(quantityText(formatPopulationDensity(1_000, formatNumber, "imperial"))).toBe("2,590 people/mi²");
    expect(quantityText(formatMassDensity(1_000, formatNumber, "imperial"))).toBe("62.428 lb/ft³");
    expect(quantityText(formatVolume(1e9, formatNumber, "metric"))).toBe("1 km³");
    expect(quantityText(formatVolume(1e9, formatNumber, "imperial"))).toBe("0.24 mi³");
  });

  it("adds intuitive energy anchors without depending on distance units", () => {
    const energy = formatEnergy(2.1e17, formatNumber, "imperial");
    expect(quantityText(energy)).toBe("50.2 Mt TNT");
    expect(energy.anchor).toContain("Hiroshima");
  });

  it("converts backend-authored standalone and embedded SI readouts", () => {
    expect(formatReadoutValue("29.01 km", formatNumber, "imperial")).toBe("18 mi");
    expect(formatEmbeddedLengthValues("Nominal 1° slope / 50 m depth; 2 km reach", formatNumber, "imperial"))
      .toBe("Nominal 1° slope / 164 ft depth; 1.2 mi reach");
    expect(formatEmbeddedLengthValues("18,000 km range", formatNumber, "imperial"))
      .toBe("11,184.7 mi range");
    expect(formatEmbeddedLengthValues("200 m/s in 4 km water", formatNumber, "imperial"))
      .toBe("447.4 mph in 2.5 mi water");
    expect(formatEmbeddedLengthValues("30 M m³ slide", formatNumber, "imperial"))
      .toBe("0.01 mi³ slide");
    expect(formatEmbeddedLengthValues("14-km asteroid", formatNumber, "imperial"))
      .toBe("8.7-mi asteroid");
    expect(formatReadoutValue("M 4.3", formatNumber, "imperial")).toBe("M 4.3");
    expect(formatReadoutValue("12 Mt TNT", formatNumber, "imperial")).toBe("12 Mt TNT");
  });
});
