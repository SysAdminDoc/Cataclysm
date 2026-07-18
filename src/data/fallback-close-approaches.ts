import type { NeoCloseApproach } from "../types/jpl";

/**
 * Small offline teaching references, not a claim about today's next approaches.
 * Values mirror the worked examples in the JPL CAD API 1.5 documentation.
 */
export const FALLBACK_CLOSE_APPROACHES: readonly NeoCloseApproach[] = [
  {
    id: "reference-153814-2028-06-26",
    designation: "153814",
    fullname: "153814 (2001 WN5)",
    approachAtIso: "2028-06-26T05:23:00.000Z",
    nominalDistanceAu: 0.00166253924938707,
    minimumDistanceAu: 0.00166237672775144,
    maximumDistanceAu: 0.00166270177137481,
    relativeVelocityKmS: 10.2426019613426,
    infinityVelocityKmS: 10.084918538826,
    timeUncertainty: "< 00:01",
    absoluteMagnitude: 18.33,
    diameterMinM: 921,
    diameterMaxM: 943,
    diameterBasis: "measured",
    source: "Built-in reference",
  },
  {
    id: "reference-99942-2029-04-13",
    designation: "99942",
    fullname: "99942 Apophis (2004 MN4)",
    approachAtIso: "2029-04-13T21:46:00.000Z",
    nominalDistanceAu: 0.000254099098170977,
    minimumDistanceAu: 0.000254085852623379,
    maximumDistanceAu: 0.000254112343772133,
    relativeVelocityKmS: 7.42249308586014,
    infinityVelocityKmS: 5.84135545611464,
    timeUncertainty: "< 00:01",
    absoluteMagnitude: 19.7,
    diameterMinM: 300,
    diameterMaxM: 380,
    diameterBasis: "measured",
    source: "Built-in reference",
  },
  {
    id: "reference-2001-av43-2029-11-11",
    designation: "2001 AV43",
    fullname: "2001 AV43",
    approachAtIso: "2029-11-11T15:25:00.000Z",
    nominalDistanceAu: 0.00209271674918054,
    minimumDistanceAu: 0.00209125158265035,
    maximumDistanceAu: 0.00209418316351851,
    relativeVelocityKmS: 3.99789389003422,
    infinityVelocityKmS: 3.66561381185116,
    timeUncertainty: "00:03",
    absoluteMagnitude: 24.6,
    diameterMinM: 32,
    diameterMaxM: 72,
    diameterBasis: "estimated_from_h",
    source: "Built-in reference",
  },
];
