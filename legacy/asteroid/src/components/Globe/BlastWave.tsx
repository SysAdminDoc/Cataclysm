import { useEffect, useRef } from 'react';
import {
  Viewer,
  Cartesian3,
  Color,
  CallbackProperty,
  Entity,
} from 'cesium';
import type { ImpactEffects } from '../../physics/types';

export function useBlastWave(
  viewer: Viewer | null,
  lat: number,
  lon: number,
  results: ImpactEffects | null,
) {
  const entityRef = useRef<Entity | null>(null);
  const animRef = useRef<number>(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!viewer || !results) return;

    if (entityRef.current) {
      try { viewer.entities.remove(entityRef.current); } catch {}
      entityRef.current = null;
    }
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    }

    const maxRadius = results.airblast.radiusWindowBreakage;
    if (maxRadius <= 10 || maxRadius > 10_000_000) return;

    const duration = Math.min(maxRadius / 340, 15);
    startRef.current = performance.now();
    let currentRadius = 1;
    let currentAlpha = 0.6;

    const entity = viewer.entities.add({
      position: Cartesian3.fromDegrees(lon, lat),
      ellipse: {
        semiMajorAxis: new CallbackProperty(() => currentRadius, false),
        semiMinorAxis: new CallbackProperty(() => currentRadius, false),
        material: new (Color as any).withAlpha(0.0),
        outline: true,
        outlineColor: new CallbackProperty(
          () => Color.fromCssColorString('#f38ba8').withAlpha(currentAlpha),
          false,
        ),
        outlineWidth: 3,
      },
    });
    entityRef.current = entity;

    function animate() {
      const elapsed = (performance.now() - startRef.current) / 1000;
      const frac = Math.min(elapsed / duration, 1);
      currentRadius = Math.max(10, frac * maxRadius);
      currentAlpha = 0.6 * (1 - frac * frac);

      if (frac < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        if (entityRef.current && viewer) {
          try { viewer.entities.remove(entityRef.current); } catch {}
          entityRef.current = null;
        }
      }
    }

    animRef.current = requestAnimationFrame(animate);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (entityRef.current && viewer) {
        try { viewer.entities.remove(entityRef.current); } catch {}
        entityRef.current = null;
      }
    };
  }, [viewer, lat, lon, results]);
}
