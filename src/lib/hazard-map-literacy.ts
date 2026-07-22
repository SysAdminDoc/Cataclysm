export type RunupScreeningBandId = "lower" | "moderate" | "high";

export type RunupScreeningBand = Readonly<{
  id: RunupScreeningBandId;
  minimumM: number;
  maximumExclusiveM: number | null;
  colorCss: string;
}>;

/**
 * A deliberately discrete, non-green screening palette. The categories make
 * modeled height easier to read while avoiding the common inference that an
 * unshaded or green area is proven safe. These are display bands, not warning
 * levels or evacuation zones.
 */
export const RUNUP_SCREENING_BANDS: readonly RunupScreeningBand[] = [
  { id: "lower", minimumM: 0.1, maximumExclusiveM: 2, colorCss: "#3b82f6" },
  { id: "moderate", minimumM: 2, maximumExclusiveM: 10, colorCss: "#f59e0b" },
  { id: "high", minimumM: 10, maximumExclusiveM: null, colorCss: "#dc2626" },
];

export function runupScreeningBand(runupM: number): RunupScreeningBand {
  return RUNUP_SCREENING_BANDS.find((band) => (
    runupM >= band.minimumM
    && (band.maximumExclusiveM === null || runupM < band.maximumExclusiveM)
  )) ?? RUNUP_SCREENING_BANDS[0];
}
