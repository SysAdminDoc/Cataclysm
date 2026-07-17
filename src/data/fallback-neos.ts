import type { NeoLookupResult } from "../types/jpl";

type FallbackNeo = NeoLookupResult & { keys: string[] };

const FALLBACK_NEOS: FallbackNeo[] = [
  {
    keys: ["apophis", "99942", "2004 mn4"],
    fullname: "99942 Apophis (2004 MN4)",
    designation: "99942",
    diameterM: 340,
    velocityMps: 12_600,
    densityKgM3: 3_300,
    source: "Built-in fallback",
    assumptions: ["Reference diameter, encounter-speed input, and stony density from the bundled offline catalog."],
  },
  {
    keys: ["bennu", "101955", "1999 rq36"],
    fullname: "101955 Bennu (1999 RQ36)",
    designation: "101955",
    diameterM: 490,
    velocityMps: 12_800,
    densityKgM3: 1_260,
    source: "Built-in fallback",
    assumptions: ["Reference diameter, encounter-speed input, and measured low bulk density from the bundled offline catalog."],
  },
  {
    keys: ["2024 yr4", "yr4"],
    fullname: "(2024 YR4)",
    designation: "2024 YR4",
    diameterM: 55,
    velocityMps: 17_000,
    densityKgM3: 2_600,
    source: "Built-in fallback",
    assumptions: ["Reference diameter and generic asteroid density from the bundled offline catalog."],
  },
];

export function findFallbackNeo(query: string): NeoLookupResult | null {
  const normalized = query.trim().toLowerCase();
  const match = FALLBACK_NEOS.find((neo) => neo.keys.some((key) => normalized.includes(key)));
  if (!match) return null;
  return {
    fullname: match.fullname,
    designation: match.designation,
    diameterM: match.diameterM,
    velocityMps: match.velocityMps,
    densityKgM3: match.densityKgM3,
    source: match.source,
    assumptions: [...match.assumptions],
  };
}
