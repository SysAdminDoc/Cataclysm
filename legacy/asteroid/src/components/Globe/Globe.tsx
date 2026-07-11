import { useRef, useEffect } from 'react';
import {
  Viewer,
  Cartesian3,
  Color,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  Cartographic,
  Math as CesiumMath,
  EllipseGeometry,
  GeometryInstance,
  GroundPrimitive,
  ColorGeometryInstanceAttribute,
  VerticalOrigin,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { ImpactEffects } from '../../physics/types';
import type { FireballEvent } from '../../types/fireballs';
import { effectColors } from '../../theme';
import { EARTH_RADIUS } from '../../physics/constants';
import { useBlastWave } from './BlastWave';

interface GlobeProps {
  lat: number;
  lon: number;
  observerLat: number | null;
  observerLon: number | null;
  results: ImpactEffects | null;
  fireballs?: FireballEvent[];
  showFireballs?: boolean;
  onLocationClick: (lat: number, lon: number) => void;
  onObserverClick: (lat: number, lon: number) => void;
}

interface RingDef {
  radius: number;
  color: string;
  label: string;
}

function buildRings(results: ImpactEffects): RingDef[] {
  const rings: RingDef[] = [];

  if (results.crater) {
    rings.push({
      radius: results.crater.finalDiameter / 2,
      color: effectColors.craterRim,
      label: 'Crater rim',
    });
  }

  rings.push({
    radius: results.thermal.fireballRadius,
    color: effectColors.fireball,
    label: 'Fireball',
  });

  if (results.thermal.thermalRadiusThirdDegree > 0) {
    rings.push({
      radius: results.thermal.thermalRadiusThirdDegree,
      color: effectColors.thermal3,
      label: '3rd degree burns',
    });
  }
  if (results.thermal.thermalRadiusSecondDegree > 0) {
    rings.push({
      radius: results.thermal.thermalRadiusSecondDegree,
      color: effectColors.thermal2,
      label: '2nd degree burns',
    });
  }
  if (results.thermal.thermalRadiusFirstDegree > 0) {
    rings.push({
      radius: results.thermal.thermalRadiusFirstDegree,
      color: effectColors.thermal1,
      label: '1st degree burns',
    });
  }

  rings.push({
    radius: results.airblast.radiusTotalDestruction,
    color: effectColors.totalDestruction,
    label: 'Total destruction (20 psi)',
  });
  rings.push({
    radius: results.airblast.radiusSevereDamage,
    color: effectColors.severeDamage,
    label: 'Severe damage (7 psi)',
  });
  rings.push({
    radius: results.airblast.radiusModerateDamage,
    color: effectColors.moderateDamage,
    label: 'Moderate damage (4 psi)',
  });
  rings.push({
    radius: results.airblast.radiusMinorDamage,
    color: effectColors.minorDamage,
    label: 'Minor damage (2 psi)',
  });
  rings.push({
    radius: results.airblast.radiusWindowBreakage,
    color: effectColors.windowBreakage,
    label: 'Window breakage (1 psi)',
  });

  if (results.ejecta && results.ejecta.maxEjectaRange > 0) {
    rings.push({
      radius: results.ejecta.maxEjectaRange,
      color: effectColors.ejecta,
      label: 'Ejecta range',
    });
  }

  return rings.filter(r => r.radius > 10 && r.radius < 6_371_000 * Math.PI);
}

function parseRgba(rgba: string): Color {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)?\)/);
  if (!m) return Color.WHITE.withAlpha(0.2);
  return new Color(
    parseInt(m[1]) / 255,
    parseInt(m[2]) / 255,
    parseInt(m[3]) / 255,
    parseFloat(m[4] ?? '0.3'),
  );
}

function fireballSize(event: FireballEvent): number {
  const energy = Math.max(event.impactEnergyKt || event.energyKt || 1, 1);
  return Math.min(16, Math.max(5, 4 + Math.log10(energy + 1) * 3));
}

function fireballLabel(event: FireballEvent): string {
  const date = event.date.slice(0, 10);
  const energy = event.impactEnergyKt || event.energyKt;
  const energyText = energy >= 1000 ? `${(energy / 1000).toFixed(1)} Mt` : `${energy.toFixed(1)} kt`;
  return `${date} ${energyText}`;
}

export function Globe({
  lat,
  lon,
  observerLat,
  observerLon,
  results,
  fireballs = [],
  showFireballs = false,
  onLocationClick,
  onObserverClick,
}: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const addedPrimitivesRef = useRef<any[]>([]);

  useBlastWave(viewerRef.current, lat, lon, results);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new Viewer(containerRef.current, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      vrButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      creditContainer: document.createElement('div'),
    });

    viewer.scene.globe.enableLighting = false;
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
    }

    viewerRef.current = viewer;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: any) => {
      const cartesian = viewer.camera.pickEllipsoid(
        movement.position,
        viewer.scene.globe.ellipsoid,
      );
      if (defined(cartesian)) {
        const carto = Cartographic.fromCartesian(cartesian!);
        onLocationClick(
          CesiumMath.toDegrees(carto.latitude),
          CesiumMath.toDegrees(carto.longitude),
        );
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement: any) => {
      const cartesian = viewer.camera.pickEllipsoid(
        movement.position,
        viewer.scene.globe.ellipsoid,
      );
      if (defined(cartesian)) {
        const carto = Cartographic.fromCartesian(cartesian!);
        onObserverClick(
          CesiumMath.toDegrees(carto.latitude),
          CesiumMath.toDegrees(carto.longitude),
        );
      }
    }, ScreenSpaceEventType.RIGHT_CLICK);

    handlerRef.current = handler;

    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lon, lat, 2_000_000),
      duration: 0,
    });

    return () => {
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  const prevLocationRef = useRef({ lat, lon });
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (prevLocationRef.current.lat !== lat || prevLocationRef.current.lon !== lon) {
      prevLocationRef.current = { lat, lon };
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(lon, lat, viewer.camera.positionCartographic.height),
        duration: 0.5,
      });
    }
  }, [lat, lon]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.entities.removeAll();
    for (const p of addedPrimitivesRef.current) {
      try { viewer.scene.primitives.remove(p); } catch { /* already destroyed */ }
    }
    addedPrimitivesRef.current = [];

    viewer.entities.add({
      position: Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: 10,
        color: Color.fromCssColorString('#f38ba8'),
        outlineColor: Color.BLACK,
        outlineWidth: 2,
      },
      label: {
        text: 'Ground Zero',
        font: '13px sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian3(0, -15, 0) as any,
      },
    });

    if (results && results.atmosphericEntry.trajectory.length > 2) {
      const traj = results.atmosphericEntry.trajectory;
      const bearing = Math.PI;

      const positions: Cartesian3[] = [];
      const maxDist = traj[traj.length - 1].groundDistance;

      for (let i = 0; i < traj.length; i += Math.max(1, Math.floor(traj.length / 200))) {
        const pt = traj[i];
        const distFrac = maxDist > 0 ? pt.groundDistance / EARTH_RADIUS : 0;
        const ptLat = lat - distFrac * (180 / Math.PI) * Math.cos(bearing);
        const ptLon = lon + distFrac * (180 / Math.PI) * Math.sin(bearing) / Math.cos(lat * Math.PI / 180);

        positions.push(Cartesian3.fromDegrees(ptLon, ptLat, pt.altitude));
      }

      if (positions.length > 1) {
        viewer.entities.add({
          polyline: {
            positions,
            width: 3,
            material: Color.fromCssColorString('#fab387').withAlpha(0.8),
          },
        });

        const entryPt = traj[0];
        const entryDistFrac = maxDist > 0 ? entryPt.groundDistance / EARTH_RADIUS : 0;
        const entryLat = lat - entryDistFrac * (180 / Math.PI) * Math.cos(bearing);
        const entryLon = lon + entryDistFrac * (180 / Math.PI) * Math.sin(bearing) / Math.cos(lat * Math.PI / 180);

        viewer.entities.add({
          position: Cartesian3.fromDegrees(entryLon, entryLat, entryPt.altitude),
          point: {
            pixelSize: 6,
            color: Color.fromCssColorString('#fab387'),
            outlineColor: Color.BLACK,
            outlineWidth: 1,
          },
          label: {
            text: `Entry ${(entryPt.altitude / 1000).toFixed(0)} km`,
            font: '11px sans-serif',
            fillColor: Color.fromCssColorString('#fab387'),
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian3(0, -10, 0) as any,
          },
        });

        if (!results.atmosphericEntry.reachesGround && results.atmosphericEntry.airburstAltitude > 0) {
          const burstIdx = traj.length - 1;
          const burstPt = traj[burstIdx];
          const burstDistFrac = maxDist > 0 ? burstPt.groundDistance / EARTH_RADIUS : 0;
          const burstLat = lat - burstDistFrac * (180 / Math.PI) * Math.cos(bearing);
          const burstLon = lon + burstDistFrac * (180 / Math.PI) * Math.sin(bearing) / Math.cos(lat * Math.PI / 180);

          viewer.entities.add({
            position: Cartesian3.fromDegrees(burstLon, burstLat, results.atmosphericEntry.airburstAltitude),
            point: {
              pixelSize: 12,
              color: Color.fromCssColorString('#f38ba8'),
              outlineColor: Color.fromCssColorString('#fab387'),
              outlineWidth: 3,
            },
            label: {
              text: `Airburst ${(results.atmosphericEntry.airburstAltitude / 1000).toFixed(1)} km`,
              font: '12px sans-serif',
              fillColor: Color.fromCssColorString('#f38ba8'),
              outlineColor: Color.BLACK,
              outlineWidth: 2,
              verticalOrigin: VerticalOrigin.BOTTOM,
              pixelOffset: new Cartesian3(0, -15, 0) as any,
            },
          });
        }
      }
    }

    if (observerLat !== null && observerLon !== null) {
      viewer.entities.add({
        position: Cartesian3.fromDegrees(observerLon, observerLat),
        point: {
          pixelSize: 8,
          color: Color.fromCssColorString('#89b4fa'),
          outlineColor: Color.BLACK,
          outlineWidth: 2,
        },
        label: {
          text: 'Observer',
          font: '12px sans-serif',
          fillColor: Color.fromCssColorString('#89b4fa'),
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian3(0, -12, 0) as any,
        },
      });

      viewer.entities.add({
        polyline: {
          positions: [
            Cartesian3.fromDegrees(lon, lat),
            Cartesian3.fromDegrees(observerLon, observerLat),
          ],
          width: 2,
          material: Color.fromCssColorString('#89b4fa').withAlpha(0.5),
          clampToGround: true,
        },
      });
    }

    if (!results) return;

    const rings = buildRings(results);

    for (const ring of rings) {
      const center = Cartesian3.fromDegrees(lon, lat);
      try {
        const instance = new GeometryInstance({
          geometry: new EllipseGeometry({
            center,
            semiMajorAxis: ring.radius,
            semiMinorAxis: ring.radius,
          }),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(parseRgba(ring.color)),
          },
        });
        const prim = new GroundPrimitive({ geometryInstances: instance });
        viewer.scene.primitives.add(prim);
        addedPrimitivesRef.current.push(prim);
      } catch {
        // skip rings too small or too large for Cesium
      }
    }

    if (showFireballs) {
      for (const event of fireballs) {
        viewer.entities.add({
          position: Cartesian3.fromDegrees(event.lon, event.lat, (event.altitudeKm ?? 0) * 1000),
          point: {
            pixelSize: fireballSize(event),
            color: Color.fromCssColorString('#fab387').withAlpha(0.85),
            outlineColor: Color.BLACK,
            outlineWidth: 1,
          },
          label: {
            text: fireballLabel(event),
            font: '10px sans-serif',
            fillColor: Color.fromCssColorString('#fab387'),
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian3(0, -10, 0) as any,
            show: (event.impactEnergyKt || event.energyKt) >= 50,
          },
        });
      }
    }
  }, [lat, lon, observerLat, observerLon, results, fireballs, showFireballs]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
    />
  );
}
