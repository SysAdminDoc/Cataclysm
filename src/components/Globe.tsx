import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import { configureCesium, tokenConfigured } from "../lib/cesium";
import type { InitialDisplacement, PropagationSnapshot } from "../types/scenario";

type Props = {
  initial: InitialDisplacement | null;
  wavefront: PropagationSnapshot | null;
};

/**
 * Cesium globe with GEBCO bathymetry. Renders:
 *  - the source location as a yellow point
 *  - the cavity radius as a translucent disc
 *  - the wavefront sample ring(s) as concentric polylines colored by amplitude
 *
 * All physics state comes from props. The Viewer is created once and reused.
 */
export function Globe({ initial, wavefront }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const sourceEntityRef = useRef<Cesium.Entity | null>(null);
  const wavefrontEntitiesRef = useRef<Cesium.Entity[]>([]);

  // One-time viewer mount
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    configureCesium();

    const useBathymetry = tokenConfigured();

    const viewer = new Cesium.Viewer(containerRef.current, {
      // Avoid the default ion default terrain that needs auth; pass undefined
      // to get the WGS84 ellipsoid, then upgrade asynchronously if we can.
      terrain: undefined,
      baseLayerPicker: false,
      geocoder: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      homeButton: false,
      timeline: false,
      animation: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
    });

    viewer.scene.globe.enableLighting = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;

    if (useBathymetry) {
      // Cesium World Bathymetry — GEBCO 15-arcsec + higher-res inserts.
      Cesium.createWorldBathymetryAsync({ requestVertexNormals: true })
        .then((provider) => {
          viewer.scene.terrainProvider = provider;
        })
        .catch((err) => {
          console.warn("Cesium World Bathymetry failed to load — falling back to ellipsoid.", err);
        });
    }

    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // React to a new initial displacement
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !initial) return;

    if (sourceEntityRef.current) viewer.entities.remove(sourceEntityRef.current);

    const { center, cavity_radius_m, peak_amplitude_m, label } = initial;
    const position = Cesium.Cartesian3.fromDegrees(center.lon_deg, center.lat_deg, 0);

    sourceEntityRef.current = viewer.entities.add({
      name: label,
      position,
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString("#f9e2af"),
        outlineColor: Cesium.Color.fromCssColorString("#11111b"),
        outlineWidth: 2,
      },
      ellipse: {
        semiMajorAxis: Math.max(cavity_radius_m, 1000),
        semiMinorAxis: Math.max(cavity_radius_m, 1000),
        material: Cesium.Color.fromCssColorString("#f38ba8").withAlpha(0.25),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#eba0ac"),
        height: 0,
      },
      label: {
        text: `${label}\nA₀ = ${peak_amplitude_m.toFixed(1)} m`,
        font: "12px Inter, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#cdd6f4"),
        outlineColor: Cesium.Color.fromCssColorString("#11111b"),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#1e1e2e").withAlpha(0.85),
        backgroundPadding: new Cesium.Cartesian2(8, 6),
      },
    });

    viewer.flyTo(sourceEntityRef.current, {
      duration: 1.8,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), Math.max(cavity_radius_m * 20, 1.5e6)),
    });
  }, [initial]);

  // React to a new wavefront snapshot
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !initial || !wavefront) return;

    for (const e of wavefrontEntitiesRef.current) viewer.entities.remove(e);
    wavefrontEntitiesRef.current = [];

    const { lat_deg, lon_deg } = initial.center;
    const maxA = wavefront.amplitudes_m[0] || 1;

    for (let i = 0; i < wavefront.ranges_m.length; i += 2) {
      const r = wavefront.ranges_m[i];
      const a = wavefront.amplitudes_m[i];
      const t = Math.min(1, a / maxA);
      const e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon_deg, lat_deg, 0),
        ellipse: {
          semiMajorAxis: r,
          semiMinorAxis: r,
          material: Cesium.Color.fromCssColorString("#74c7ec").withAlpha(0.0),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#74c7ec").withAlpha(0.3 + 0.5 * t),
          height: 0,
        },
      });
      wavefrontEntitiesRef.current.push(e);
    }
  }, [initial, wavefront]);

  if (!tokenConfigured()) {
    return (
      <div className="app__globe-empty">
        <h2>Cesium ion token not configured</h2>
        <p>
          GEBCO bathymetry streams from Cesium ion. Copy <code>.env.example</code> to{" "}
          <code>.env</code> and paste your free token, then restart{" "}
          <code>npm run tauri dev</code>.
        </p>
        <p style={{ marginTop: 10 }}>
          Get one at <code>https://cesium.com/ion/signup</code>.
        </p>
      </div>
    );
  }

  return <div className="app__globe-mount" ref={containerRef} />;
}
