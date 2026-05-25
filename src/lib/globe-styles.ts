/**
 * Globe imagery / terrain style options. Each entry says how to construct
 * a Cesium imagery provider + optional terrain. The OSM default works with
 * no token, so the app is usable on first launch.
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

export const GLOBE_STYLES: GlobeStyleMeta[] = [
  {
    id: "osm",
    label: "OpenStreetMap (no token)",
    description: "Free OSM raster tiles. Default — works without any setup.",
    requires_token: false,
  },
  {
    id: "esri-world-imagery",
    label: "Esri World Imagery (satellite, no token)",
    description: "Free public Esri satellite imagery tiles. No token required.",
    requires_token: false,
  },
  {
    id: "natural-earth-2",
    label: "Natural Earth II (offline-friendly)",
    description: "Generalised world raster from Natural Earth. Lightweight.",
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
    description: "GEBCO bathymetric terrain — shows real seafloor topography.",
    requires_token: true,
  },
];

export const DEFAULT_STYLE: GlobeStyleId = "osm";

export function findStyle(id: GlobeStyleId | string | undefined | null): GlobeStyleMeta {
  return GLOBE_STYLES.find((s) => s.id === id) ?? GLOBE_STYLES[0];
}

/**
 * Build a Cesium imagery provider for the given style id. Falls back to the
 * default OSM provider if the requested style isn't constructable (e.g.
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
      `[globe] '${id}' requires a Cesium ion token; falling back to OSM. Paste a token in Settings to enable.`,
    );
    return new Cesium.OpenStreetMapImageryProvider({
      url: "https://tile.openstreetmap.org/",
      credit: "© OpenStreetMap contributors",
    });
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
      return await Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
        {
          credit: "Natural Earth II — public domain (https://www.naturalearthdata.com/)",
          maximumLevel: 5,
        },
      );
    case "cesium-world-imagery":
      return Cesium.IonImageryProvider.fromAssetId(2);
    case "cesium-bathymetry":
      // Bathymetry is a terrain layer, not imagery — the caller pairs it
      // with one of the imagery options above. Return Natural Earth as the
      // matching imagery default.
      return await Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
        { credit: "Natural Earth II — public domain", maximumLevel: 5 },
      );
    default:
      return new Cesium.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: "© OpenStreetMap contributors",
      });
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
