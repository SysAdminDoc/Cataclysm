/**
 * Globe imagery / terrain style options. Each entry says how to construct
 * a Cesium imagery provider + optional terrain. Natural Earth II is bundled
 * with Cesium and is the explicit fallback for offline or failed providers.
 */

import * as Cesium from "cesium";
import PRODUCT_TRUTH from "../data/product-truth.json";
import { tokenConfigured } from "./cesium";
import {
  assertEarthAssetOperationAllowed,
  EARTH_STYLE_BINDINGS,
  getEarthAsset,
  getEarthStyleBinding,
  type GlobeStyleId,
} from "./earth-assets";

export type { GlobeStyleId } from "./earth-assets";

export type GlobeStyleMeta = {
  id: GlobeStyleId;
  label: string;
  description: string;
  requires_token: boolean;
};

// Esri World Imagery is high-resolution satellite (zoom to level 19) and needs
// no token, so a fresh install shows a crisp Earth instead of the 2-level
// Natural Earth raster. Natural Earth remains selectable as the offline option.
export const DEFAULT_STYLE = PRODUCT_TRUTH.globe.defaultStyleId as GlobeStyleId;
export const OFFLINE_STYLE = PRODUCT_TRUTH.globe.offlineStyleId as GlobeStyleId;

export type ImageryFallbackReason = "offline" | "missing-token" | null;

export type TerrainMode = "ellipsoid" | "world-terrain" | "bathymetry";

const WORLD_TERRAIN_ASSET_ID = "cesium-ion-world-terrain-1";
const BATHYMETRY_ASSET_ID = "cesium-ion-world-bathymetry-2426648";

export type ImagerySelection = {
  provider: Cesium.ImageryProvider;
  requestedStyle: GlobeStyleId;
  resolvedStyle: GlobeStyleId;
  fallbackReason: ImageryFallbackReason;
  imageryAssetId: string;
  terrainAssetId: string;
  providerId: string;
  attribution: string;
};

type ImageryResolution = Pick<
  ImagerySelection,
  "requestedStyle" | "resolvedStyle" | "fallbackReason"
>;

export const GLOBE_STYLES: GlobeStyleMeta[] = EARTH_STYLE_BINDINGS.map((binding) => ({
  id: binding.id,
  label: binding.label,
  description: binding.description,
  requires_token: binding.requires_token,
}));

export function findStyle(id: GlobeStyleId | string | undefined | null): GlobeStyleMeta {
  return GLOBE_STYLES.find((s) => s.id === id)
    ?? GLOBE_STYLES.find((s) => s.id === DEFAULT_STYLE)
    ?? GLOBE_STYLES[0];
}

export function resolveImageryStyle(
  requestedStyle: GlobeStyleId,
  online: boolean,
  hasToken: boolean,
): ImageryResolution {
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
  const asset = getEarthAsset(getEarthStyleBinding(OFFLINE_STYLE).imagery_asset_id);
  return new Cesium.UrlTemplateImageryProvider({
    url: `${CESIUM_BASE_URL}/Assets/Textures/NaturalEarthII/{z}/{x}/{reverseY}.jpg`,
    tilingScheme: new Cesium.GeographicTilingScheme(),
    credit: asset.license.attribution_text,
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

  const binding = getEarthStyleBinding(selection.resolvedStyle);
  const imageryAsset = getEarthAsset(binding.imagery_asset_id);
  assertEarthAssetOperationAllowed(imageryAsset.id, "interactive_render");

  let provider: Cesium.ImageryProvider;
  switch (selection.resolvedStyle) {
    case "osm":
      provider = new Cesium.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: imageryAsset.license.attribution_text,
      });
      break;
    case "esri-world-imagery":
      provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
      );
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
  return {
    ...selection,
    provider,
    imageryAssetId: imageryAsset.id,
    terrainAssetId: binding.terrain_asset_id,
    providerId: imageryAsset.provider_id,
    attribution: imageryAsset.license.attribution_text,
  };
}

export function terrainModeForStyle(id: GlobeStyleId): TerrainMode {
  const terrainAssetId = getEarthStyleBinding(id).terrain_asset_id;
  if (terrainAssetId === WORLD_TERRAIN_ASSET_ID) return "world-terrain";
  if (terrainAssetId === BATHYMETRY_ASSET_ID) return "bathymetry";
  return "ellipsoid";
}

/** Build the registered visual terrain provider, or let the controller use its ellipsoid fallback. */
export async function buildTerrain(id: GlobeStyleId): Promise<Cesium.TerrainProvider | undefined> {
  const binding = getEarthStyleBinding(id);
  const terrainAsset = getEarthAsset(binding.terrain_asset_id);
  assertEarthAssetOperationAllowed(terrainAsset.id, "interactive_render");
  if (!tokenConfigured()) return undefined;
  const mode = terrainModeForStyle(id);
  if (mode === "world-terrain") {
    return await Cesium.createWorldTerrainAsync({
      requestVertexNormals: true,
      requestWaterMask: true,
    });
  }
  if (mode === "bathymetry") {
    return await Cesium.createWorldBathymetryAsync({ requestVertexNormals: true });
  }
  return undefined;
}
