import type { ColormapId } from "./settings";

/**
 * Legend presentation for each solver colormap. The gradients approximate the
 * authoritative Rust colormaps (`diverging_colormap` / `cividis_colormap` /
 * `viridis_colormap` in `src-tauri/src/physics/solver/mod.rs`) so the viewport
 * legend actually matches the rendered overlay instead of a fixed rainbow.
 *
 * `diverging` and `cividis` are signed (trough ↔ crest around zero); `viridis`
 * is a sequential magnitude ramp. The scale labels and caption reflect that so a
 * colourblind user who selects a CVD-safe map is never shown a misleading key.
 */
export type ColormapLegend = {
  gradient: string;
  scale: string[];
  caption: string;
  signed: boolean;
};

const SIGNED_SCALE = ["−10", "−1", "0", "+1", "+10"];
const MAGNITUDE_SCALE = ["0", "0.1", "1", "5", "10+"];

const LEGENDS: Record<ColormapId, ColormapLegend> = {
  diverging: {
    gradient:
      "linear-gradient(90deg, rgb(30,120,255) 0%, rgb(65,165,255) 25%, #eef3f8 50%, rgb(255,95,75) 75%, rgb(255,20,10) 100%)",
    scale: SIGNED_SCALE,
    caption: "metres · − trough / + crest",
    signed: true,
  },
  cividis: {
    gradient:
      "linear-gradient(90deg, rgb(0,34,78) 0%, rgb(15,20,30) 48%, rgb(60,55,15) 52%, rgb(253,231,37) 100%)",
    scale: SIGNED_SCALE,
    caption: "metres · − trough / + crest (CVD-safe)",
    signed: true,
  },
  viridis: {
    gradient:
      "linear-gradient(90deg, rgb(68,1,84) 0%, rgb(59,82,139) 25%, rgb(33,145,140) 50%, rgb(94,201,98) 75%, rgb(253,231,37) 100%)",
    scale: MAGNITUDE_SCALE,
    caption: "metres · magnitude (CVD-safe)",
    signed: false,
  },
};

export function colormapLegend(id: ColormapId): ColormapLegend {
  return LEGENDS[id] ?? LEGENDS.diverging;
}
