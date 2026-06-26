/**
 * Globe imagery / terrain style options. Each entry says how to construct
 * a Cesium imagery provider + optional terrain. The Natural Earth default is
 * bundled with Cesium, so the app is usable on first launch without network
 * tiles or a token.
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

export const DEFAULT_STYLE: GlobeStyleId = "natural-earth-2";

export const GLOBE_STYLES: GlobeStyleMeta[] = [
  {
    id: "natural-earth-2",
    label: "Natural Earth II (offline-friendly)",
    description: "Local Natural Earth raster. Default — fast, stable, and usable without network tiles.",
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

function naturalEarthImagery(): Cesium.ImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: `${CESIUM_BASE_URL}/Assets/Textures/NaturalEarthII/{z}/{x}/{reverseY}.jpg`,
    tilingScheme: new Cesium.GeographicTilingScheme(),
    credit: "Natural Earth II — public domain (https://www.naturalearthdata.com/)",
    maximumLevel: 2,
  });
}

/**
 * Build a Cesium imagery provider for the given style id. Falls back to the
 * default Natural Earth provider if the requested style isn't constructable (e.g.
 * token-gated provider but no token). Token presence is preflighted before
 * hitting the network so a misconfigured request doesn't waste a Cesium ion
 * quota point.
 */
export async function buildImagery(id: GlobeStyleId): Promise<Cesium.ImageryProvider> {
  // If the style requires a token and we don't have one, short-circuit to
  // OSM so the user gets a working globe instead of a 401-driven fallback.
  const meta = findStyle(id);
  if (meta.requires_token && !tokenConfigured()) {
    console.info(
      `[globe] '${id}' requires a Cesium ion token; falling back to Natural Earth. Paste a token in Settings to enable.`,
    );
    return naturalEarthImagery();
  }

  switch (id) {
    case "osm":
      return new Cesium.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: "© OpenStreetMap contributors",
      });
    case "esri-world-imagery":
      return new Cesium.UrlTemplateImageryProvider({
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        credit: "Esri, Maxar, Earthstar Geographics, USGS, AeroGRID, IGN, et al.",
        maximumLevel: 17,
      });
    case "natural-earth-2":
      // Cesium ships a tiny Natural Earth II tileset locally in its Assets.
      // No network or token needed.
      return naturalEarthImagery();
    case "cesium-world-imagery":
      return Cesium.IonImageryProvider.fromAssetId(2);
    case "cesium-bathymetry":
      // Bathymetry is a terrain layer, not imagery — the caller pairs it
      // with one of the imagery options above. Return Natural Earth as the
      // matching imagery default.
      return naturalEarthImagery();
    default:
      return naturalEarthImagery();
  }
}

/** Build a Cesium terrain provider if the style implies one. */
export async function buildTerrain(id: GlobeStyleId): Promise<Cesium.TerrainProvider | undefined> {
  if (id === "cesium-bathymetry") {
    if (!tokenConfigured()) return undefined;
    return await Cesium.createWorldBathymetryAsync({ requestVertexNormals: true });
  }
  return undefined;
}
