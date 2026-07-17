import {
  INITIAL_EARTHQUAKE,
  sourceBound,
  type ScenarioInput,
} from "./scenario-schema";

export type HazelEventSearchRequest = {
  year?: number;
  location?: string;
};

export type HazelTsunamiEvent = {
  id: number;
  year: number;
  month?: number | null;
  day?: number | null;
  eventValidity?: number | null;
  causeCode?: number | null;
  eqMagnitude?: number | null;
  country?: string | null;
  locationName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  maxWaterHeight?: number | null;
  numRunups?: number | null;
};

export type HazelEventSearchResponse = {
  items: HazelTsunamiEvent[];
  page: number;
  totalPages: number;
  itemsPerPage: number;
  totalItems: number;
};

export type HistoricalScenarioImport = {
  scenario: ScenarioInput;
  provenanceNote: string;
};

export type SearchParseResult =
  | { ok: true; request: HazelEventSearchRequest }
  | { ok: false; reason: string };

const YEAR_PATTERN = /(?:^|\s)(\d{4})(?=\s|$)/;

export function parseHistoricalEventSearch(query: string): SearchParseResult {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) return { ok: false, reason: "Enter a year, location, or both." };
  if (normalized.length > 65 || [...normalized].some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint < 32 || codePoint === 127;
  })) {
    return { ok: false, reason: "Search text must be 65 printable characters or fewer." };
  }
  const yearMatch = normalized.match(YEAR_PATTERN);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  if (year !== undefined && (year < 1 || year > 2100)) {
    return { ok: false, reason: "Search year must be between 0001 and 2100." };
  }
  const location = (yearMatch
    ? `${normalized.slice(0, yearMatch.index)} ${normalized.slice((yearMatch.index ?? 0) + yearMatch[0].length)}`
    : normalized)
    .trim()
    .replace(/^[,:;-]+|[,:;-]+$/g, "")
    .trim();
  if (location.length === 1) {
    return { ok: false, reason: "Location text must contain at least two characters." };
  }
  return {
    ok: true,
    request: {
      ...(year === undefined ? {} : { year }),
      ...(location ? { location } : {}),
    },
  };
}

export function historicalEventDate(event: HazelTsunamiEvent): string {
  const year = Math.trunc(event.year).toString().padStart(4, "0");
  if (!event.month) return year;
  const month = Math.trunc(event.month).toString().padStart(2, "0");
  if (!event.day) return `${year}-${month}`;
  return `${year}-${month}-${Math.trunc(event.day).toString().padStart(2, "0")}`;
}

export function historicalEventPlace(event: HazelTsunamiEvent): string {
  return event.locationName?.trim() || event.country?.trim() || "Unnamed location";
}

export function eventValidityLabel(value: number | null | undefined): string {
  if (value === 4) return "Definite tsunami";
  if (value === 3) return "Probable tsunami";
  if (value === 2) return "Questionable record";
  if (value === 1) return "Very doubtful record";
  return "Unrated record";
}

export function canImportHistoricalEvent(event: HazelTsunamiEvent): boolean {
  if (event.causeCode !== 1) return false;
  if (!Number.isFinite(event.eqMagnitude) || !Number.isFinite(event.latitude) || !Number.isFinite(event.longitude)) {
    return false;
  }
  const magnitude = event.eqMagnitude as number;
  const latitude = event.latitude as number;
  const longitude = event.longitude as number;
  const bounds = sourceBound("Earthquake", "mw");
  return magnitude >= bounds.min && magnitude <= bounds.max
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

export function historicalEventImport(event: HazelTsunamiEvent): HistoricalScenarioImport | null {
  if (!canImportHistoricalEvent(event)) return null;
  const magnitude = event.eqMagnitude as number;
  const latitude = event.latitude as number;
  const longitude = event.longitude as number;
  const date = historicalEventDate(event);
  const place = historicalEventPlace(event);
  return {
    scenario: {
      kind: "Earthquake",
      source: {
        ...INITIAL_EARTHQUAKE,
        mw: magnitude,
        location: {
          ...INITIAL_EARTHQUAKE.location,
          lat_deg: latitude,
          lon_deg: longitude,
        },
      },
    },
    provenanceNote: `Imported NOAA/NCEI HazEL event ${event.id}: ${date}, ${place}. HazEL supplied M_w ${magnitude.toFixed(1)} and epicentre ${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°. Fault geometry, slip, depth, and water depth remain Cataclysm defaults and must be reviewed before simulation. Historical records can contain location, datum, transcription, or classification uncertainty. Source: Global Historical Tsunami Database (doi:10.7289/V5PN93H7).`,
  };
}
