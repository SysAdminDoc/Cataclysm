export const EARTH_RADIUS = 6.371e6;          // m
export const GRAVITY = 9.81;                   // m/s^2
export const SEA_LEVEL_DENSITY = 1.225;        // kg/m^3
export const SCALE_HEIGHT = 8500;              // m
export const SEA_LEVEL_PRESSURE = 1.013e5;     // Pa

export const DRAG_COEFFICIENT = 1.0;
export const HEAT_TRANSFER_COEFF = 0.1;
export const SPREADING_COEFFICIENT = 0.3;

export const SEAWATER_DENSITY = 1025;          // kg/m^3
export const SEISMIC_VELOCITY = 5000;          // m/s (surface wave, approximate)
export const SOUND_SPEED_AIR = 340;            // m/s

export const MT_TO_JOULES = 4.184e15;
export const KT_TO_JOULES = 4.184e12;

export const MATERIAL_STRENGTH: Record<string, number> = {
  ice: 1e5,
  porous_rock: 5e5,
  dense_rock: 5e6,
  stony: 1e7,
  iron: 2e8,
};

export const HEAT_OF_ABLATION: Record<string, number> = {
  ice: 2.5e6,
  porous_rock: 5e6,
  dense_rock: 8e6,
  stony: 8e6,
  iron: 8e6,
};

export const TARGET_DENSITY: Record<string, number> = {
  sedimentary_rock: 2500,
  crystalline_rock: 2750,
  water: 1025,
};

export const SIMPLE_COMPLEX_TRANSITION: Record<string, number> = {
  sedimentary_rock: 3200,
  crystalline_rock: 4000,
  water: 3200,
};

export const COMPOSITION_DENSITY: Record<string, number> = {
  ice: 1000,
  porous_rock: 1500,
  dense_rock: 3000,
  stony: 3300,
  iron: 7800,
};

export const THERMAL_THRESHOLDS = {
  thirdDegreeBurn: 250e3,    // J/m^2
  secondDegreeBurn: 125e3,
  firstDegreeBurn: 60e3,
  paperIgnition: 100e3,
  woodIgnition: 250e3,
  firestorm: 300e3,
};

export const OVERPRESSURE_THRESHOLDS = {
  windowBreakage: 6.9e3,      // Pa (1 psi)
  minorDamage: 13.8e3,        // 2 psi
  moderateDamage: 27.6e3,     // 4 psi
  severeDamage: 48.3e3,       // 7 psi
  reinforcedDamage: 68.9e3,   // 10 psi
  totalDestruction: 137.9e3,  // 20 psi
};

export const MERCALLI_DESCRIPTIONS: Record<number, string> = {
  1: 'Not felt',
  2: 'Felt by few at rest',
  3: 'Felt indoors, hanging objects swing',
  4: 'Felt by many indoors, dishes rattle',
  5: 'Felt by most, some dishes break',
  6: 'Felt by all, heavy furniture moves',
  7: 'Difficult to stand, moderate damage',
  8: 'Considerable damage to structures',
  9: 'Heavy damage, ground cracks',
  10: 'Severe destruction, landslides',
  11: 'Widespread destruction',
  12: 'Total destruction',
};
