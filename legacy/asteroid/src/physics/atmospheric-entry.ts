import {
  EARTH_RADIUS,
  GRAVITY,
  SEA_LEVEL_DENSITY,
  SCALE_HEIGHT,
  DRAG_COEFFICIENT,
  HEAT_TRANSFER_COEFF,
  MATERIAL_STRENGTH,
  HEAT_OF_ABLATION,
} from './constants';
import type { AtmosphericEntryResult, TrajectoryPoint } from './types';

function atmosphericDensity(altitude: number): number {
  if (altitude < 0) return SEA_LEVEL_DENSITY;
  return SEA_LEVEL_DENSITY * Math.exp(-altitude / SCALE_HEIGHT);
}

function guessComposition(density: number): string {
  if (density <= 1200) return 'ice';
  if (density <= 2000) return 'porous_rock';
  if (density <= 3200) return 'dense_rock';
  if (density <= 5000) return 'stony';
  return 'iron';
}

interface OdeState {
  v: number;
  m: number;
  theta: number;
  z: number;
  x: number;
  r: number;
}

function crossSection(r: number): number {
  return Math.PI * r ** 2;
}

function derivatives(
  s: OdeState,
  strength: number,
  ablationHeat: number,
  impactorDensity: number,
  initialRadius: number,
): OdeState {
  const rhoA = atmosphericDensity(s.z);
  const A = crossSection(s.r);
  const sinTheta = Math.sin(s.theta);
  const cosTheta = Math.cos(s.theta);

  const dvdt =
    (-DRAG_COEFFICIENT * rhoA * A * s.v ** 2) / (2 * s.m) +
    GRAVITY * sinTheta;

  const dmdt =
    (-HEAT_TRANSFER_COEFF * rhoA * A * s.v ** 3) / (2 * ablationHeat);

  const dthetadt =
    (GRAVITY * cosTheta) / s.v -
    (s.v * cosTheta) / (EARTH_RADIUS + s.z);

  const dzdt = -s.v * sinTheta;

  const dxdt = (s.v * cosTheta * EARTH_RADIUS) / (EARTH_RADIUS + s.z);

  let drdt = 0;
  const ramPressure = rhoA * s.v ** 2;
  if (ramPressure > strength) {
    const alpha = 0.5;
    const spreadFactor = 1 + (s.r / initialRadius - 1) * 0.5;
    drdt = s.v * alpha * Math.sqrt(rhoA / impactorDensity) * spreadFactor;
  }

  return { v: dvdt, m: dmdt, theta: dthetadt, z: dzdt, x: dxdt, r: drdt };
}

function rk4Step(
  s: OdeState,
  dt: number,
  strength: number,
  ablationHeat: number,
  impactorDensity: number,
  initialRadius: number,
): OdeState {
  function evalDerivs(state: OdeState): OdeState {
    return derivatives(state, strength, ablationHeat, impactorDensity, initialRadius);
  }

  function addStates(a: OdeState, b: OdeState, scale: number): OdeState {
    return {
      v: a.v + b.v * scale,
      m: a.m + b.m * scale,
      theta: a.theta + b.theta * scale,
      z: a.z + b.z * scale,
      x: a.x + b.x * scale,
      r: a.r + b.r * scale,
    };
  }

  const k1 = evalDerivs(s);
  const k2 = evalDerivs(addStates(s, k1, dt / 2));
  const k3 = evalDerivs(addStates(s, k2, dt / 2));
  const k4 = evalDerivs(addStates(s, k3, dt));

  return {
    v: s.v + (dt / 6) * (k1.v + 2 * k2.v + 2 * k3.v + k4.v),
    m: s.m + (dt / 6) * (k1.m + 2 * k2.m + 2 * k3.m + k4.m),
    theta: s.theta + (dt / 6) * (k1.theta + 2 * k2.theta + 2 * k3.theta + k4.theta),
    z: s.z + (dt / 6) * (k1.z + 2 * k2.z + 2 * k3.z + k4.z),
    x: s.x + (dt / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    r: s.r + (dt / 6) * (k1.r + 2 * k2.r + 2 * k3.r + k4.r),
  };
}

export function simulateAtmosphericEntry(
  diameter: number,
  density: number,
  velocity: number,
  angleDeg: number,
): AtmosphericEntryResult {
  const composition = guessComposition(density);
  const strength = MATERIAL_STRENGTH[composition];
  const ablationHeat = HEAT_OF_ABLATION[composition];
  const radius = diameter / 2;
  const volume = (4 / 3) * Math.PI * radius ** 3;
  const mass = density * volume;
  const initialKE = 0.5 * mass * velocity ** 2;

  const entryAltitude = 100_000;
  const angleRad = (angleDeg * Math.PI) / 180;

  let state: OdeState = {
    v: velocity,
    m: mass,
    theta: angleRad,
    z: entryAltitude,
    x: 0,
    r: radius,
  };

  const trajectory: TrajectoryPoint[] = [];
  let breakupAltitude = -1;
  let time = 0;
  const dt = 0.02;
  const maxSteps = 5_000_000;

  let peakDEdz = 0;
  let airburstAlt = 0;
  let prevKE = initialKE;
  let prevZ = entryAltitude;
  let pastPeak = false;
  let peakSteps = 0;

  const estimatedDuration = entryAltitude / (velocity * Math.sin(angleRad) * 0.5);
  const recordInterval = Math.max(1, Math.floor(estimatedDuration / dt / 2000));

  for (let step = 0; step < maxSteps; step++) {
    if (step % recordInterval === 0) {
      trajectory.push({
        altitude: state.z,
        velocity: state.v,
        mass: state.m,
        radius: state.r,
        groundDistance: state.x,
        time,
      });
    }

    if (breakupAltitude < 0) {
      const rhoA = atmosphericDensity(state.z);
      const ramPressure = rhoA * state.v ** 2;
      if (ramPressure > strength) {
        breakupAltitude = state.z;
      }
    }

    state = rk4Step(state, dt, strength, ablationHeat, density, radius);
    time += dt;

    const currentKE = 0.5 * state.m * state.v ** 2;
    const dz = prevZ - state.z;
    if (dz > 0) {
      const dEdz = (prevKE - currentKE) / dz;
      if (dEdz > peakDEdz) {
        peakDEdz = dEdz;
        airburstAlt = state.z;
        pastPeak = false;
        peakSteps = 0;
      } else if (peakDEdz > 0) {
        peakSteps++;
        if (peakSteps > 50) pastPeak = true;
      }
    }
    prevKE = currentKE;
    prevZ = state.z;

    if (state.m <= mass * 0.01) {
      trajectory.push({
        altitude: state.z,
        velocity: state.v,
        mass: state.m,
        radius: state.r,
        groundDistance: state.x,
        time,
      });
      return {
        reachesGround: false,
        airburstAltitude: Math.max(0, airburstAlt),
        airburstEnergy: initialKE * (1 - state.m / mass),
        impactVelocity: state.v,
        breakupAltitude,
        trajectory,
      };
    }

    if (state.r > radius * 4 && breakupAltitude > 0) {
      trajectory.push({
        altitude: state.z,
        velocity: state.v,
        mass: state.m,
        radius: state.r,
        groundDistance: state.x,
        time,
      });
      return {
        reachesGround: false,
        airburstAltitude: Math.max(0, airburstAlt > 0 ? airburstAlt : state.z),
        airburstEnergy: 0.5 * state.m * state.v ** 2,
        impactVelocity: state.v,
        breakupAltitude,
        trajectory,
      };
    }

    if (pastPeak && breakupAltitude > 0 && state.v < velocity * 0.3) {
      trajectory.push({
        altitude: state.z,
        velocity: state.v,
        mass: state.m,
        radius: state.r,
        groundDistance: state.x,
        time,
      });
      return {
        reachesGround: false,
        airburstAltitude: Math.max(0, airburstAlt),
        airburstEnergy: initialKE - currentKE,
        impactVelocity: state.v,
        breakupAltitude,
        trajectory,
      };
    }

    if (state.z <= 0) {
      state.z = 0;
      trajectory.push({
        altitude: 0,
        velocity: state.v,
        mass: state.m,
        radius: state.r,
        groundDistance: state.x,
        time,
      });
      return {
        reachesGround: true,
        airburstAltitude: 0,
        airburstEnergy: 0.5 * state.m * state.v ** 2,
        impactVelocity: state.v,
        breakupAltitude,
        trajectory,
      };
    }

    if (state.v < 1) {
      trajectory.push({
        altitude: state.z,
        velocity: state.v,
        mass: state.m,
        radius: state.r,
        groundDistance: state.x,
        time,
      });
      const nearGround = state.z < 500;
      return {
        reachesGround: nearGround,
        airburstAltitude: nearGround ? 0 : Math.max(0, state.z),
        airburstEnergy: currentKE,
        impactVelocity: state.v,
        breakupAltitude,
        trajectory,
      };
    }
  }

  return {
    reachesGround: true,
    airburstAltitude: 0,
    airburstEnergy: 0.5 * state.m * state.v ** 2,
    impactVelocity: state.v,
    breakupAltitude,
    trajectory,
  };
}
