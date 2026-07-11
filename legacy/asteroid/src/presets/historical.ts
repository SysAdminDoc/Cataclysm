import type { ImpactParams } from '../physics/types';

export interface HistoricalPreset {
  name: string;
  description: string;
  year: string;
  params: ImpactParams;
  expectedCrater?: string;
  expectedEnergy?: string;
}

export const PRESETS: HistoricalPreset[] = [
  {
    name: 'Chelyabinsk',
    description: 'Airburst over Russia, ~1500 injuries from window glass',
    year: '2013',
    params: {
      diameter: 19,
      density: 3300,
      velocity: 19000,
      angle: 18,
      targetType: 'sedimentary_rock',
      waterDepth: 0,
      beachSlope: 0.02,
      distance: 50000,
    },
    expectedEnergy: '~500 kt',
  },
  {
    name: 'Tunguska',
    description: 'Airburst flattened 2,150 km² of forest in Siberia',
    year: '1908',
    params: {
      diameter: 65,
      density: 2000,
      velocity: 15000,
      angle: 30,
      targetType: 'sedimentary_rock',
      waterDepth: 0,
      beachSlope: 0.02,
      distance: 50000,
    },
    expectedEnergy: '3–15 Mt',
  },
  {
    name: 'Meteor Crater',
    description: '1.18 km simple crater in Arizona, USA',
    year: '~50,000 BP',
    params: {
      diameter: 50,
      density: 7800,
      velocity: 12800,
      angle: 45,
      targetType: 'sedimentary_rock',
      waterDepth: 0,
      beachSlope: 0.02,
      distance: 50000,
    },
    expectedCrater: '1.18 km diameter',
    expectedEnergy: '~10 Mt',
  },
  {
    name: 'Ries Crater',
    description: '24 km complex crater in Bavaria, Germany',
    year: '~14.8 Ma',
    params: {
      diameter: 1500,
      density: 3500,
      velocity: 20000,
      angle: 30,
      targetType: 'crystalline_rock',
      waterDepth: 0,
      beachSlope: 0.02,
      distance: 100000,
    },
    expectedCrater: '24 km diameter',
  },
  {
    name: 'Chesapeake Bay',
    description: '85 km crater, ocean impact off Virginia coast',
    year: '~35 Ma',
    params: {
      diameter: 3000,
      density: 3500,
      velocity: 20000,
      angle: 45,
      targetType: 'water',
      waterDepth: 500,
      beachSlope: 0.02,
      distance: 200000,
    },
    expectedCrater: '85 km diameter',
  },
  {
    name: 'Chicxulub',
    description: 'Mass extinction event, 180 km crater in Yucatán',
    year: '~66 Ma',
    params: {
      diameter: 12000,
      density: 2600,
      velocity: 20000,
      angle: 60,
      targetType: 'crystalline_rock',
      waterDepth: 0,
      beachSlope: 0.02,
      distance: 1000000,
    },
    expectedCrater: '180 km diameter',
    expectedEnergy: '>1e23 J',
  },
];
