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

export function formatLength(
  m: number,
  formatNumber: FormatNumber,
  system: UnitSystem,
): FormattedQuantity {
  if (!Number.isFinite(m)) return { value: "—", unit: "" };
  if (system === "imperial") {
    const miles = m * MILES_PER_METER;
    if (miles >= 0.1) {
      return { value: formatNumber(miles, { maximumFractionDigits: 1 }), unit: "mi" };
    }
    const feet = m * FEET_PER_METER;
    return { value: formatNumber(feet, { maximumFractionDigits: 0 }), unit: "ft" };
  }
  if (m >= 1000) return { value: formatNumber(m / 1000, { maximumFractionDigits: 1 }), unit: "km" };
  return { value: formatNumber(m, { maximumFractionDigits: 1 }), unit: "m" };
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
  if (system === "imperial") {
    const feet = m * FEET_PER_METER;
    return { value: formatNumber(feet, { maximumFractionDigits: 0 }), unit: "ft" };
  }
  if (Math.abs(m) >= 1000) return { value: formatNumber(m / 1000, { maximumFractionDigits: 1 }), unit: "km" };
  return { value: formatNumber(m, { maximumFractionDigits: 1 }), unit: "m" };
}

// --- Area ---

export function formatArea(
  sqm: number,
  formatNumber: FormatNumber,
  system: UnitSystem,
): FormattedQuantity {
  if (!Number.isFinite(sqm)) return { value: "—", unit: "" };
  if (system === "imperial") {
    const sqmi = sqm / 2.59e6;
    if (sqmi >= 0.1) return { value: formatNumber(sqmi, { maximumFractionDigits: 1 }), unit: "mi²" };
    const sqft = sqm * 10.7639;
    return { value: formatNumber(sqft, { notation: "compact", maximumFractionDigits: 0 }), unit: "ft²" };
  }
  if (sqm >= 1e6) return { value: formatNumber(sqm / 1e6, { maximumFractionDigits: 1 }), unit: "km²" };
  return { value: formatNumber(sqm, { maximumFractionDigits: 0 }), unit: "m²" };
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
