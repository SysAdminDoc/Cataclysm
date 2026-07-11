export interface FallbackNeo {
  keys: string[];
  fullname: string;
  diameter: number;
  velocity: number;
  density: number;
}

export const FALLBACK_NEOS: FallbackNeo[] = [
  {
    keys: ['apophis', '99942', '2004 mn4'],
    fullname: '99942 Apophis (2004 MN4)',
    diameter: 340,
    velocity: 12_600,
    density: 3300,
  },
  {
    keys: ['bennu', '101955', '1999 rq36'],
    fullname: '101955 Bennu (1999 RQ36)',
    diameter: 490,
    velocity: 12_800,
    density: 1260,
  },
  {
    keys: ['2024 yr4', 'yr4'],
    fullname: '(2024 YR4)',
    diameter: 55,
    velocity: 17_000,
    density: 2600,
  },
];

export function findFallbackNeo(query: string): FallbackNeo | undefined {
  const q = query.trim().toLowerCase();
  return FALLBACK_NEOS.find(neo => neo.keys.some(key => q.includes(key)));
}
