/**
 * Units system: metric / imperial display formatting with optional
 * comparison anchors for energy and length. Solver values remain SI
 * internally — this module is presentation-only.
 */

export type UnitSystem = "metric" | "imperial";

type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string;

export interface FormattedQuantity {
  value: string;
  unit: string;
  anchor?: string;
}

// --- Length ---

const FEET_PER_METER = 3.28084;
const MILES_PER_METER = 0.000621371;
const SQ_MILES_PER_SQ_METER = 1 / 2.589_988_110_336e6;
const SQ_KM_PER_SQ_MILE = 2.589_988_110_336;
const LB_PER_KG = 2.204_622_621_85;
const CUBIC_FEET_PER_CUBIC_METER = 35.314_666_721_5;
const CUBIC_MILES_PER_CUBIC_METER = 2.399_127_585_79e-10;

/** Joins a display value and unit without leaking presentation rules to callers. */
export function quantityText(quantity: FormattedQuantity): string {
  return quantity.unit ? `${quantity.value} ${quantity.unit}` : quantity.value;
}

export function formatLength(
  m: number,
  formatNumber: FormatNumber,
  system: UnitSystem,
): FormattedQuantity {
  if (!Number.isFinite(m)) return { value: "—", unit: "" };
  if (system === "imperial") {
    const miles = m * MILES_PER_METER;
    if (Math.abs(miles) >= 0.1) {
      return { value: formatNumber(miles, { maximumFractionDigits: 1 }), unit: "mi" };
    }
    const feet = m * FEET_PER_METER;
    const absFeet = Math.abs(feet);
    return {
      value: formatNumber(feet, {
        maximumFractionDigits: absFeet < 10 ? 2 : absFeet < 100 ? 1 : 0,
      }),
      unit: "ft",
    };
  }
  if (Math.abs(m) >= 1000) return { value: formatNumber(m / 1000, { maximumFractionDigits: 1 }), unit: "km" };
  if (Math.abs(m) > 0 && Math.abs(m) < 0.1) {
    return { value: formatNumber(m * 100, { maximumFractionDigits: 2 }), unit: "cm" };
  }
  return {
    value: formatNumber(m, { maximumFractionDigits: Math.abs(m) < 10 ? 2 : 1 }),
    unit: "m",
  };
}

// --- Speed ---

const MPH_PER_MS = 2.23694;

export function formatSpeed(
  ms: number,
  formatNumber: FormatNumber,
  system: UnitSystem,
): FormattedQuantity {
  if (!Number.isFinite(ms)) return { value: "—", unit: "" };
  if (system === "imperial") {
    const mph = ms * MPH_PER_MS;
    return { value: formatNumber(mph, { maximumFractionDigits: 1 }), unit: "mph" };
  }
  if (ms >= 1000) return { value: formatNumber(ms / 1000, { maximumFractionDigits: 1 }), unit: "km/s" };
  return { value: formatNumber(ms, { maximumFractionDigits: 1 }), unit: "m/s" };
}

// --- Energy with comparison anchors ---

const HIROSHIMA_ENERGY_J = 6.3e13;
const TSAR_BOMBA_ENERGY_J = 2.1e17;

export function formatEnergy(
  j: number,
  formatNumber: FormatNumber,
  _system: UnitSystem,
  showAnchors = true,
): FormattedQuantity {
  if (!Number.isFinite(j)) return { value: "—", unit: "" };
  const mt = j / 4.184e15;
  let result: FormattedQuantity;
  if (mt >= 1) {
    const value =
      mt >= 10_000
        ? formatNumber(mt, { notation: "compact", maximumFractionDigits: 1 })
        : formatNumber(mt, { maximumFractionDigits: 1 });
    result = { value, unit: "Mt TNT" };
  } else {
    const kt = j / 4.184e12;
    if (kt >= 1) {
      result = { value: formatNumber(kt, { maximumFractionDigits: 1 }), unit: "kt TNT" };
    } else {
      const tons = j / 4.184e9;
      if (tons >= 1) {
        result = { value: formatNumber(tons, { maximumFractionDigits: 1 }), unit: "t TNT" };
      } else {
        result = {
          value: formatNumber(j, { notation: "compact", maximumFractionDigits: 2 }),
          unit: "J",
        };
      }
    }
  }

  if (showAnchors && j >= HIROSHIMA_ENERGY_J) {
    result.anchor = energyAnchor(j, formatNumber);
  }
  return result;
}

function energyAnchor(j: number, formatNumber: FormatNumber): string {
  const tsarBombas = j / TSAR_BOMBA_ENERGY_J;
  if (tsarBombas >= 2) {
    return `≈ ${formatNumber(tsarBombas, { maximumFractionDigits: 0 })}× Tsar Bomba`;
  }
  const hiroshimas = j / HIROSHIMA_ENERGY_J;
  if (hiroshimas >= 1) {
    if (hiroshimas < 10) {
      return `≈ ${formatNumber(hiroshimas, { maximumFractionDigits: 1 })}× Hiroshima`;
    }
    return `≈ ${formatNumber(hiroshimas, { notation: "compact", maximumFractionDigits: 0 })}× Hiroshima`;
  }
  return "";
}

// --- Depth (height above/below sea level) ---

export function formatDepth(
  m: number,
  formatNumber: FormatNumber,
  system: UnitSystem,
): FormattedQuantity {
  if (!Number.isFinite(m)) return { value: "—", unit: "" };
  return formatLength(m, formatNumber, system);
}

// --- Area ---

export function formatArea(
  sqm: number,
  formatNumber: FormatNumber,
  system: UnitSystem,
): FormattedQuantity {
  if (!Number.isFinite(sqm)) return { value: "—", unit: "" };
  if (system === "imperial") {
    const sqmi = sqm * SQ_MILES_PER_SQ_METER;
    if (sqmi >= 0.1) return { value: formatNumber(sqmi, { maximumFractionDigits: 1 }), unit: "mi²" };
    const sqft = sqm * 10.7639;
    return { value: formatNumber(sqft, { notation: "compact", maximumFractionDigits: 0 }), unit: "ft²" };
  }
  if (sqm >= 1e6) return { value: formatNumber(sqm / 1e6, { maximumFractionDigits: 1 }), unit: "km²" };
  return { value: formatNumber(sqm, { maximumFractionDigits: 0 }), unit: "m²" };
}

// --- Density ---

export function formatPopulationDensity(
  peoplePerSqKm: number,
  formatNumber: FormatNumber,
  system: UnitSystem,
): FormattedQuantity {
  if (!Number.isFinite(peoplePerSqKm)) return { value: "—", unit: "" };
  const value = system === "imperial" ? peoplePerSqKm * SQ_KM_PER_SQ_MILE : peoplePerSqKm;
  return {
    value: formatNumber(value, { maximumFractionDigits: 0 }),
    unit: system === "imperial" ? "people/mi²" : "people/km²",
  };
}

export function formatMassDensity(
  kgPerM3: number,
  formatNumber: FormatNumber,
  system: UnitSystem,
): FormattedQuantity {
  if (!Number.isFinite(kgPerM3)) return { value: "—", unit: "" };
  if (system === "imperial") {
    return {
      value: formatNumber((kgPerM3 * LB_PER_KG) / CUBIC_FEET_PER_CUBIC_METER, {
        maximumFractionDigits: 4,
      }),
      unit: "lb/ft³",
    };
  }
  return { value: formatNumber(kgPerM3, { maximumFractionDigits: 1 }), unit: "kg/m³" };
}

// --- Volume ---

export function formatVolume(
  cubicMeters: number,
  formatNumber: FormatNumber,
  system: UnitSystem,
): FormattedQuantity {
  if (!Number.isFinite(cubicMeters)) return { value: "—", unit: "" };
  if (system === "imperial") {
    const cubicMiles = cubicMeters * CUBIC_MILES_PER_CUBIC_METER;
    if (Math.abs(cubicMiles) >= 0.001) {
      return {
        value: formatNumber(cubicMiles, { maximumFractionDigits: 2 }),
        unit: "mi³",
      };
    }
    return {
      value: formatNumber(cubicMeters * CUBIC_FEET_PER_CUBIC_METER, { maximumFractionDigits: 1 }),
      unit: "ft³",
    };
  }
  if (Math.abs(cubicMeters) >= 1e9) {
    return { value: formatNumber(cubicMeters / 1e9, { maximumFractionDigits: 2 }), unit: "km³" };
  }
  return { value: formatNumber(cubicMeters, { maximumFractionDigits: 1 }), unit: "m³" };
}

/**
 * Converts a backend-authored scalar readout such as `29.01 km` or `237 m`.
 * Non-length scientific labels (Mt, kt, magnitude, recurrence text) pass through.
 */
export function formatReadoutValue(
  readout: string,
  formatNumber: FormatNumber,
  system: UnitSystem,
): string {
  return formatEmbeddedLengthValues(readout, formatNumber, system);
}

/** Converts embedded SI lengths while preserving the surrounding model text. */
export function formatEmbeddedLengthValues(
  text: string,
  formatNumber: FormatNumber,
  system: UnitSystem,
): string {
  const numberPattern = "[+-]?(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|[.,]\\d+)";
  const parseNumber = (rawValue: string) => Number(
    /^[+-]?\d{1,3}(?:,\d{3})+/.test(rawValue)
      ? rawValue.replace(/,/g, "")
      : rawValue.replace(",", "."),
  );
  const volumePattern = new RegExp(`(${numberPattern})\\s*(M\\s*m³|million\\s+m³|Mm³|km³|m³)(?!\\w)`, "gu");
  const speedPattern = new RegExp(`(${numberPattern})\\s*(km/s|m/s)\\b`, "gu");
  const lengthPattern = new RegExp(`(${numberPattern})(-|\\s*)(km|m)\\b`, "gu");

  return text
    .replace(volumePattern, (match, rawValue: string, rawUnit: string) => {
      const numeric = parseNumber(rawValue);
      if (!Number.isFinite(numeric)) return match;
      const cubicMeters = rawUnit === "km³"
        ? numeric * 1e9
        : rawUnit === "m³"
          ? numeric
          : numeric * 1e6;
      return quantityText(formatVolume(cubicMeters, formatNumber, system));
    })
    .replace(speedPattern, (match, rawValue: string, rawUnit: string) => {
      const numeric = parseNumber(rawValue);
      if (!Number.isFinite(numeric)) return match;
      return quantityText(formatSpeed(rawUnit === "km/s" ? numeric * 1000 : numeric, formatNumber, system));
    })
    .replace(lengthPattern, (match, rawValue: string, separator: string, rawUnit: string) => {
      const numeric = parseNumber(rawValue);
      if (!Number.isFinite(numeric)) return match;
      const formatted = formatLength(rawUnit === "km" ? numeric * 1000 : numeric, formatNumber, system);
      return separator === "-" ? `${formatted.value}-${formatted.unit}` : quantityText(formatted);
    });
}

// --- Length comparison anchors for large distances ---

const CITY_DIAMETER_KM: ReadonlyArray<{ name: string; km: number }> = [
  { name: "Manhattan", km: 3.7 },
  { name: "Paris", km: 10.5 },
  { name: "London", km: 50 },
];

export function lengthAnchor(m: number): string | undefined {
  const km = m / 1000;
  if (km < 1) return undefined;
  for (let i = CITY_DIAMETER_KM.length - 1; i >= 0; i--) {
    const city = CITY_DIAMETER_KM[i];
    const ratio = km / city.km;
    if (ratio >= 0.5 && ratio <= 50) {
      if (Math.abs(ratio - 1) < 0.15) return `≈ ${city.name} diameter`;
      return `≈ ${ratio.toFixed(1)}× ${city.name}`;
    }
  }
  return undefined;
}

// --- Magnitude (always displayed as Mw, no unit conversion) ---

export function formatMagnitude(mw: number): string {
  return Number.isFinite(mw) ? mw.toFixed(2) : "—";
}

// --- Time (not affected by unit system — always minutes/hours) ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslateFn = (key: any, params?: Record<string, string>) => string;

export function formatResultTime(
  seconds: number,
  t: TranslateFn,
  formatNumber: FormatNumber,
): string {
  if (!Number.isFinite(seconds) || seconds < 0) return t("results.timeUnavailable");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("results.timeMinutes", { minutes: formatNumber(minutes) });
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0
    ? t("results.timeHours", { hours: formatNumber(hours) })
    : t("results.timeHoursMinutes", { hours: formatNumber(hours), minutes: formatNumber(remaining) });
}

// --- Coordinates (not affected by unit system) ---

export function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}
