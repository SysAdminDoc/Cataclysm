import { INITIAL_EARTHQUAKE, sourceBound, type ScenarioInput } from "./scenario-schema";
import { api, isTauri } from "./tauri";

export type UsgsEarthquakeEvent = {
  id: string;
  title: string;
  place: string;
  magnitude: number;
  magnitudeType: string | null;
  timeMs: number;
  updatedMs: number;
  latitude: number;
  longitude: number;
  depthKm: number;
  status: string;
  significance: number;
  tsunamiFlag: boolean;
  alertLevel: string | null;
  maxMmi: number | null;
  hasShakemap: boolean;
  hasPager: boolean;
  hasFiniteFault: boolean;
  hasMomentTensor: boolean;
  eventUrl: string;
};

export type UsgsRecentEarthquakesResponse = {
  generatedAtMs: number;
  sourceUrl: string;
  events: UsgsEarthquakeEvent[];
};

export type UsgsOkadaSource = {
  basis: "finite_fault" | "moment_tensor";
  strikeDeg: number;
  dipDeg: number;
  rakeDeg: number;
  averageSlipM: number;
  faultLengthM: number;
  faultWidthM: number;
  scalarMomentNm: number;
  reviewStatus: string;
  assumptions: string[];
};

export type UsgsMmiContour = {
  mmi: number;
  color: string;
  points: Array<[number, number]>;
};

export type UsgsShakeMap = {
  maxMmi: number;
  mapStatus: string;
  reviewStatus: string;
  processTimestamp: string | null;
  bounds: [number, number, number, number];
  contours: UsgsMmiContour[];
};

export type UsgsPager = {
  alertLevel: string;
  maxMmi: number | null;
  reviewStatus: string;
};

export type UsgsEarthquakeDetail = {
  event: UsgsEarthquakeEvent;
  okadaSource: UsgsOkadaSource | null;
  shakemap: UsgsShakeMap | null;
  pager: UsgsPager | null;
  fetchedAtMs: number;
};

export type UsgsRecentFeed = UsgsRecentEarthquakesResponse & {
  status: "live" | "cached" | "unavailable";
  stale: boolean;
  notice: "offline-cache" | "desktop-cache" | "unavailable" | "browser-only" | null;
};

export type UsgsOfficialComparison = {
  eventId: string;
  title: string;
  eventUrl: string;
  fetchedAtMs: number;
  stale: boolean;
  shakemap: UsgsShakeMap | null;
  pager: UsgsPager | null;
};

export type RecentEarthquakeImport = {
  scenario: ScenarioInput;
  provenanceNote: string;
  officialComparison: UsgsOfficialComparison;
};

type FeedCache = {
  schemaVersion: 1;
  cachedAtMs: number;
  response: UsgsRecentEarthquakesResponse;
};

type DetailCache = {
  schemaVersion: 1;
  details: UsgsEarthquakeDetail[];
};

const FEED_CACHE_KEY = "cataclysm.usgs.recent-earthquakes.v1";
const DETAIL_CACHE_KEY = "cataclysm.usgs.earthquake-details.v1";
const USGS_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson";
const EVENT_URL_PREFIX = "https://earthquake.usgs.gov/earthquakes/eventpage/";
const MAX_EVENTS = 32;
const MAX_CACHED_DETAILS = 4;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function printable(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
}

function validEventId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{2,32}$/.test(value);
}

function validEvent(value: unknown): value is UsgsEarthquakeEvent {
  const event = record(value);
  if (!event || !validEventId(event.id)) return false;
  const eventUrl = `${EVENT_URL_PREFIX}${event.id}`;
  return printable(event.title, 220)
    && printable(event.place, 180)
    && finite(event.magnitude, 5, 10)
    && (event.magnitudeType === null || printable(event.magnitudeType, 24))
    && Number.isSafeInteger(event.timeMs)
    && Number.isSafeInteger(event.updatedMs)
    && finite(event.latitude, -90, 90)
    && finite(event.longitude, -180, 180)
    && finite(event.depthKm, 0, 1_000)
    && printable(event.status, 32)
    && Number.isSafeInteger(event.significance)
    && typeof event.tsunamiFlag === "boolean"
    && (event.alertLevel === null || printable(event.alertLevel, 16))
    && (event.maxMmi === null || finite(event.maxMmi, 0, 10))
    && typeof event.hasShakemap === "boolean"
    && typeof event.hasPager === "boolean"
    && typeof event.hasFiniteFault === "boolean"
    && typeof event.hasMomentTensor === "boolean"
    && event.eventUrl === eventUrl;
}

function validRecentResponse(value: unknown): value is UsgsRecentEarthquakesResponse {
  const response = record(value);
  return Boolean(response
    && Number.isSafeInteger(response.generatedAtMs)
    && response.sourceUrl === USGS_FEED_URL
    && Array.isArray(response.events)
    && response.events.length <= MAX_EVENTS
    && response.events.every(validEvent));
}

function validOkadaSource(value: unknown): value is UsgsOkadaSource {
  const source = record(value);
  return Boolean(source
    && ["finite_fault", "moment_tensor"].includes(String(source.basis))
    && finite(source.strikeDeg, 0, 360)
    && finite(source.dipDeg, 0, 90)
    && finite(source.rakeDeg, -180, 180)
    && finite(source.averageSlipM, 0, 100)
    && finite(source.faultLengthM, 1, 2_000_000)
    && finite(source.faultWidthM, 1, 500_000)
    && finite(source.scalarMomentNm, Number.MIN_VALUE, Number.MAX_VALUE)
    && printable(source.reviewStatus, 80)
    && Array.isArray(source.assumptions)
    && source.assumptions.length <= 8
    && source.assumptions.every((entry) => printable(entry, 300)));
}

function validContour(value: unknown): value is UsgsMmiContour {
  const contour = record(value);
  return Boolean(contour
    && finite(contour.mmi, 0, 10)
    && typeof contour.color === "string"
    && /^#[0-9a-f]{6}$/i.test(contour.color)
    && Array.isArray(contour.points)
    && contour.points.length >= 2
    && contour.points.every((point) => Array.isArray(point)
      && point.length === 2
      && finite(point[0], -180, 180)
      && finite(point[1], -90, 90)));
}

function validShakeMap(value: unknown): value is UsgsShakeMap {
  const shakemap = record(value);
  return Boolean(shakemap
    && finite(shakemap.maxMmi, 0, 10)
    && printable(shakemap.mapStatus, 80)
    && printable(shakemap.reviewStatus, 80)
    && (shakemap.processTimestamp === null || printable(shakemap.processTimestamp, 80))
    && Array.isArray(shakemap.bounds)
    && shakemap.bounds.length === 4
    && finite(shakemap.bounds[0], -180, 180)
    && finite(shakemap.bounds[1], -90, 90)
    && finite(shakemap.bounds[2], -180, 180)
    && finite(shakemap.bounds[3], -90, 90)
    && shakemap.bounds[0] < shakemap.bounds[2]
    && shakemap.bounds[1] < shakemap.bounds[3]
    && Array.isArray(shakemap.contours)
    && shakemap.contours.length <= 512
    && shakemap.contours.reduce((total, contour) => {
      const points = record(contour)?.points;
      return total + (Array.isArray(points) ? points.length : 0);
    }, 0) <= 24_000
    && shakemap.contours.every(validContour));
}

function validPager(value: unknown): value is UsgsPager {
  const pager = record(value);
  return Boolean(pager
    && printable(pager.alertLevel, 80)
    && (pager.maxMmi === null || finite(pager.maxMmi, 0, 10))
    && printable(pager.reviewStatus, 80));
}

function validDetail(value: unknown): value is UsgsEarthquakeDetail {
  const detail = record(value);
  return Boolean(detail
    && validEvent(detail.event)
    && (detail.okadaSource === null || validOkadaSource(detail.okadaSource))
    && (detail.shakemap === null || validShakeMap(detail.shakemap))
    && (detail.pager === null || validPager(detail.pager))
    && Number.isSafeInteger(detail.fetchedAtMs));
}

function readFeedCache(): FeedCache | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = record(JSON.parse(localStorage.getItem(FEED_CACHE_KEY) ?? "null"));
    if (!parsed
      || parsed.schemaVersion !== 1
      || !Number.isSafeInteger(parsed.cachedAtMs)
      || !validRecentResponse(parsed.response)) return null;
    return parsed as FeedCache;
  } catch {
    return null;
  }
}

function writeFeedCache(response: UsgsRecentEarthquakesResponse): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ schemaVersion: 1, cachedAtMs: Date.now(), response } satisfies FeedCache));
  } catch {
    // Live discovery remains usable if local storage is unavailable or full.
  }
}

function readDetailCache(): UsgsEarthquakeDetail[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = record(JSON.parse(localStorage.getItem(DETAIL_CACHE_KEY) ?? "null"));
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.details)) return [];
    return parsed.details.filter(validDetail).slice(0, MAX_CACHED_DETAILS);
  } catch {
    return [];
  }
}

function writeDetailCache(detail: UsgsEarthquakeDetail): void {
  if (typeof localStorage === "undefined") return;
  try {
    const details = [
      detail,
      ...readDetailCache().filter((entry) => entry.event.id !== detail.event.id),
    ].slice(0, MAX_CACHED_DETAILS);
    localStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify({ schemaVersion: 1, details } satisfies DetailCache));
  } catch {
    // The selected live result remains usable if the cache cannot be written.
  }
}

export async function loadRecentUsgsEarthquakes(): Promise<UsgsRecentFeed> {
  if (isTauri()) {
    try {
      const response = await api.usgsRecentEarthquakes();
      if (!validRecentResponse(response)) throw new Error("USGS recent-event response failed validation.");
      writeFeedCache(response);
      return { ...response, status: "live", stale: false, notice: null };
    } catch {
      const cached = readFeedCache();
      if (cached) {
        return {
          ...cached.response,
          status: "cached",
          stale: true,
          notice: "offline-cache",
        };
      }
    }
  }
  const cached = readFeedCache();
  if (cached) {
    return {
      ...cached.response,
      status: "cached",
      stale: true,
      notice: "desktop-cache",
    };
  }
  return {
    generatedAtMs: 0,
    sourceUrl: USGS_FEED_URL,
    events: [],
    status: "unavailable",
    stale: true,
    notice: isTauri() ? "unavailable" : "browser-only",
  };
}

export async function loadUsgsEarthquakeDetail(eventId: string): Promise<{ detail: UsgsEarthquakeDetail; stale: boolean }> {
  if (!validEventId(eventId)) throw new Error("Invalid USGS event ID.");
  if (isTauri()) {
    try {
      const detail = await api.usgsEarthquakeDetail(eventId);
      if (!validDetail(detail) || detail.event.id !== eventId) throw new Error("USGS detail response failed validation.");
      writeDetailCache(detail);
      return { detail, stale: false };
    } catch {
      // Fall through to the on-device detail cache.
    }
  }
  const detail = readDetailCache().find((entry) => entry.event.id === eventId);
  if (!detail) throw new Error("USGS detail is unavailable and this event has not been cached on this device.");
  return { detail, stale: true };
}

export function canImportRecentEarthquake(detail: UsgsEarthquakeDetail): boolean {
  const depth = detail.event.depthKm * 1_000;
  const depthBounds = sourceBound("Earthquake", "depth_m");
  return detail.okadaSource !== null
    && depth >= depthBounds.min
    && depth <= depthBounds.max;
}

export function recentEarthquakeImport(
  detail: UsgsEarthquakeDetail,
  stale: boolean,
): RecentEarthquakeImport | null {
  if (!canImportRecentEarthquake(detail) || !detail.okadaSource) return null;
  const event = detail.event;
  const source = detail.okadaSource;
  const eventTime = new Date(event.timeMs).toISOString();
  const basis = source.basis === "finite_fault" ? "preferred finite-fault product" : "preferred moment-tensor product";
  const scenario: ScenarioInput = {
    kind: "Earthquake",
    source: {
      ...INITIAL_EARTHQUAKE,
      mw: event.magnitude,
      depth_m: event.depthKm * 1_000,
      strike_deg: source.strikeDeg,
      dip_deg: source.dipDeg,
      rake_deg: source.rakeDeg,
      slip_m: source.averageSlipM,
      fault_length_m: source.faultLengthM,
      fault_width_m: source.faultWidthM,
      location: {
        ...INITIAL_EARTHQUAKE.location,
        lat_deg: event.latitude,
        lon_deg: event.longitude,
      },
    },
  };
  const cacheLabel = stale ? " This detail came from the on-device cache and may be stale." : "";
  return {
    scenario,
    provenanceNote: `Imported USGS ComCat event ${event.id}: ${eventTime}, ${event.place}. Catalog M ${event.magnitude.toFixed(1)}, epicentre ${event.latitude.toFixed(3)}°, ${event.longitude.toFixed(3)}°, depth ${event.depthKm.toFixed(1)} km; Okada geometry uses the ${basis}. ${source.assumptions.join(" ")} Water depth remains Cataclysm's default and must be reviewed before simulation. USGS products are preliminary, can be revised, and are not a live warning.${cacheLabel} Source: ${event.eventUrl}`,
    officialComparison: {
      eventId: event.id,
      title: event.title,
      eventUrl: event.eventUrl,
      fetchedAtMs: detail.fetchedAtMs,
      stale,
      shakemap: detail.shakemap,
      pager: detail.pager,
    },
  };
}

export const USGS_RECENT_FEED_URL = USGS_FEED_URL;
