import type { ImpactParams } from '../physics/types';

export type ValidationSeverity = 'warning' | 'danger';

export interface ParameterWarning {
  severity: ValidationSeverity;
  message: string;
  detail: string;
}

export function validateImpactParams(params: ImpactParams): ParameterWarning[] {
  const warnings: ParameterWarning[] = [];

  if (params.diameter <= 0) {
    warnings.push({
      severity: 'danger',
      message: 'Projectile diameter must be positive.',
      detail: 'A zero or negative diameter cannot produce a physical impact solution.',
    });
  } else if (params.diameter > 50_000) {
    warnings.push({
      severity: 'warning',
      message: 'Diameter is beyond the calibrated crater range.',
      detail: 'Global-scale bodies need full climate and geologic models beyond this local effects chain.',
    });
  }

  if (params.density <= 0) {
    warnings.push({
      severity: 'danger',
      message: 'Projectile density must be positive.',
      detail: 'Negative or zero density makes mass and kinetic energy invalid.',
    });
  } else if (params.density < 500 || params.density > 9_000) {
    warnings.push({
      severity: 'warning',
      message: 'Density is outside common asteroid/comet material bounds.',
      detail: 'Most impactors fall between porous ice near 1,000 kg/m3 and iron near 7,800 kg/m3.',
    });
  }

  if (params.velocity <= 0) {
    warnings.push({
      severity: 'danger',
      message: 'Impact velocity must be positive.',
      detail: 'A non-moving projectile has no impact energy.',
    });
  } else if (params.velocity < 11_200) {
    warnings.push({
      severity: 'warning',
      message: 'Velocity is below Earth escape speed.',
      detail: 'Natural heliocentric impactors usually arrive at 11.2 km/s or faster.',
    });
  } else if (params.velocity > 72_000) {
    warnings.push({
      severity: 'warning',
      message: 'Velocity exceeds typical Solar System impact limits.',
      detail: 'Values above 72 km/s are not representative of bound asteroid/comet impacts.',
    });
  }

  if (params.angle <= 0 || params.angle > 90) {
    warnings.push({
      severity: 'danger',
      message: 'Impact angle must be between 1 and 90 degrees.',
      detail: 'The atmospheric entry model expects an angle measured upward from horizontal.',
    });
  } else if (params.angle < 5) {
    warnings.push({
      severity: 'warning',
      message: 'Very shallow entry has high uncertainty.',
      detail: 'Grazing impacts can skip, fragment, or travel far beyond this compact model.',
    });
  }

  if (params.distance < 0) {
    warnings.push({
      severity: 'danger',
      message: 'Observer distance cannot be negative.',
      detail: 'Distance is measured outward from ground zero.',
    });
  }

  if (params.targetType === 'water') {
    if (params.waterDepth <= 0) {
      warnings.push({
        severity: 'danger',
        message: 'Ocean impacts need a positive water depth.',
        detail: 'Use a land target or set water depth above zero.',
      });
    } else if (params.waterDepth > 11_000) {
      warnings.push({
        severity: 'warning',
        message: 'Water depth exceeds known ocean trenches.',
        detail: 'The deepest known seafloor is about 11 km below sea level.',
      });
    }
  } else if (params.waterDepth > 0) {
    warnings.push({
      severity: 'warning',
      message: 'Water depth is ignored for land targets.',
      detail: 'Switch target type to water if tsunami effects should apply.',
    });
  }

  if (params.beachSlope <= 0) {
    warnings.push({
      severity: 'danger',
      message: 'Coastal slope must be positive.',
      detail: 'Tsunami runup scaling divides by beach slope.',
    });
  } else if (params.beachSlope > 0.2) {
    warnings.push({
      severity: 'warning',
      message: 'Coastal slope is steeper than the preset coastal range.',
      detail: 'Runup estimates are tuned for continental shelves through steep volcanic coasts.',
    });
  }

  return warnings;
}
