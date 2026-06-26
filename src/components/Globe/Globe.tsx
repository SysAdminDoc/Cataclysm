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
import { effectColors } from '../../theme';

interface GlobeProps {
  lat: number;
  lon: number;
  results: ImpactEffects | null;
  onLocationClick: (lat: number, lon: number) => void;
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

  return rings.filter(r => r.radius > 10 && r.radius < 20_000_000);
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

export function Globe({ lat, lon, results, onLocationClick }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);

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
    viewer.scene.primitives.removeAll();

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
        viewer.scene.primitives.add(
          new GroundPrimitive({ geometryInstances: instance }),
        );
      } catch {
        // skip rings too small or too large for Cesium
      }
    }
  }, [lat, lon, results]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
    />
  );
}
