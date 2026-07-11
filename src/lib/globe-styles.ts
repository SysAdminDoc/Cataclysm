/**
 * Globe imagery / terrain style options. Each entry says how to construct
 * a Cesium imagery provider + optional terrain. Natural Earth II is bundled
 * with Cesium and is the explicit fallback for offline or failed providers.
 */

import * as Cesium from "cesium";
import { tokenConfigured } from "./cesium";

export type GlobeStyleId =
  | "osm"
  | "natural-earth-2"
  | "esri-world-imagery"
  | "cesium-bathymetry"
  | "cesium-world-imagery";

export type GlobeStyleMeta = {
  id: GlobeStyleId;
  label: string;
  description: string;
  requires_token: boolean;
};

// Esri World Imagery is high-resolution satellite (zoom to level 19) and needs
// no token, so a fresh install shows a crisp Earth instead of the 2-level
// Natural Earth raster. Natural Earth remains selectable as the offline option.
export const DEFAULT_STYLE: GlobeStyleId = "esri-world-imagery";
export const OFFLINE_STYLE: GlobeStyleId = "natural-earth-2";

export type ImageryFallbackReason = "offline" | "missing-token" | null;

export type ImagerySelection = {
  provider: Cesium.ImageryProvider;
  requestedStyle: GlobeStyleId;
  resolvedStyle: GlobeStyleId;
  fallbackReason: ImageryFallbackReason;
};

export const GLOBE_STYLES: GlobeStyleMeta[] = [
  {
    id: "natural-earth-2",
    label: "Natural Earth II (offline-friendly)",
    description: "Local Natural Earth raster. Fast, stable, and usable without network tiles.",
    requires_token: false,
  },
  {
    id: "osm",
    label: "OpenStreetMap (no token)",
    description: "Free OSM raster tiles. More detailed online map context; no token required.",
    requires_token: false,
  },
  {
    id: "esri-world-imagery",
    label: "Esri World Imagery (satellite, no token)",
    description: "Free public Esri satellite imagery tiles. No token required.",
    requires_token: false,
  },
  {
    id: "cesium-world-imagery",
    label: "Cesium World Imagery (token required)",
    description: "High-resolution global imagery streamed from Cesium ion.",
    requires_token: true,
  },
  {
    id: "cesium-bathymetry",
    label: "Cesium World Bathymetry (token required)",
    description: "GEBCO bathymetric terrain for visual context; solver still uses coarse offline depth.",
    requires_token: true,
  },
];

export function findStyle(id: GlobeStyleId | string | undefined | null): GlobeStyleMeta {
  return GLOBE_STYLES.find((s) => s.id === id)
    ?? GLOBE_STYLES.find((s) => s.id === DEFAULT_STYLE)
    ?? GLOBE_STYLES[0];
}

export function resolveImageryStyle(
  requestedStyle: GlobeStyleId,
  online: boolean,
  hasToken: boolean,
): Omit<ImagerySelection, "provider"> {
  const meta = findStyle(requestedStyle);
  if (!online && requestedStyle !== OFFLINE_STYLE) {
    return {
      requestedStyle,
      resolvedStyle: OFFLINE_STYLE,
      fallbackReason: "offline",
    };
  }
  if (meta.requires_token && !hasToken) {
    return {
      requestedStyle,
      resolvedStyle: OFFLINE_STYLE,
      fallbackReason: "missing-token",
    };
  }
  return { requestedStyle, resolvedStyle: requestedStyle, fallbackReason: null };
}

function naturalEarthImagery(): Cesium.ImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: `${CESIUM_BASE_URL}/Assets/Textures/NaturalEarthII/{z}/{x}/{reverseY}.jpg`,
    tilingScheme: new Cesium.GeographicTilingScheme(),
    credit: "Natural Earth II — public domain (https://www.naturalearthdata.com/)",
    maximumLevel: 2,
  });
}

/**
 * Build a Cesium imagery selection for the requested style. The returned
 * metadata makes fallback explicit so the UI cannot label Natural Earth as the
 * requested online provider. Token presence and network state are preflighted.
 */
export async function buildImagery(
  id: GlobeStyleId,
  options: { online?: boolean; hasToken?: boolean } = {},
): Promise<ImagerySelection> {
  const selection = resolveImageryStyle(
    id,
    options.online ?? true,
    options.hasToken ?? tokenConfigured(),
  );
  if (selection.fallbackReason) {
    console.info(`[globe] '${id}' resolved to bundled Natural Earth (${selection.fallbackReason}).`);
  }

  let provider: Cesium.ImageryProvider;
  switch (selection.resolvedStyle) {
    case "osm":
      provider = new Cesium.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: "© OpenStreetMap contributors",
      });
      break;
    case "esri-world-imagery":
      provider = new Cesium.UrlTemplateImageryProvider({
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        credit: "Esri, Maxar, Earthstar Geographics, USGS, AeroGRID, IGN, et al.",
        maximumLevel: 19,
      });
      break;
    case "natural-earth-2":
      provider = naturalEarthImagery();
      break;
    case "cesium-world-imagery":
      provider = await Cesium.IonImageryProvider.fromAssetId(2);
      break;
    case "cesium-bathymetry":
      provider = naturalEarthImagery();
      break;
    default:
      provider = naturalEarthImagery();
  }
  return { ...selection, provider };
}

/** Build a Cesium terrain provider if the style implies one. */
export async function buildTerrain(id: GlobeStyleId): Promise<Cesium.TerrainProvider | undefined> {
  if (id === "cesium-bathymetry") {
    if (!tokenConfigured()) return undefined;
    return await Cesium.createWorldBathymetryAsync({ requestVertexNormals: true });
  }
  return undefined;
}
