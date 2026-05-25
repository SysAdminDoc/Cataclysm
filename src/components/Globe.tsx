import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import { configureCesium, tokenConfigured } from "../lib/cesium";
import type { InitialDisplacement, PropagationSnapshot } from "../types/scenario";

type Props = {
  initial: InitialDisplacement | null;
  wavefront: PropagationSnapshot | null;
  /**
   * When set, the globe is in "pick" mode: the next click is consumed,
   * cartographic coords are reported, and the mode toggles off automatically.
   */
  pickMode?: boolean;
  onPick?: (lat: number, lon: number) => void;
  onPickCancel?: () => void;
};

const PICK_CURSOR_STYLE = "crosshair";

/**
 * Cesium globe with optional GEBCO bathymetry. Renders:
 *  - the source location as a 3D cavity cylinder (height = cavity depth, colored
 *    by amplitude)
 *  - the wavefront sample ring(s) as concentric polylines, updated in-place to
 *    avoid entity thrash on time-slider drag.
 *  - empty state when no source is selected
 *  - loading badge while bathymetry tileset streams
 *  - click-to-pick mode for scenario-builder location selection
 *
 * All physics state comes from props. The Viewer is created once and reused.
 */
export function Globe({ initial, wavefront, pickMode, onPick, onPickCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const sourceEntityRef = useRef<Cesium.Entity | null>(null);
  const wavefrontEntitiesRef = useRef<Cesium.Entity[]>([]);
  const pickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const [bathymetryStatus, setBathymetryStatus] = useState<"idle" | "loading" | "ready" | "error">(
    () => (tokenConfigured() ? "loading" : "idle"),
  );

  // One-time viewer mount
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    configureCesium();

    const viewer = new Cesium.Viewer(containerRef.current, {
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

    if (tokenConfigured()) {
      setBathymetryStatus("loading");
      Cesium.createWorldBathymetryAsync({ requestVertexNormals: true })
        .then((provider) => {
          viewer.scene.terrainProvider = provider;
          setBathymetryStatus("ready");
        })
        .catch((err) => {
          console.warn("Cesium World Bathymetry failed to load — falling back to ellipsoid.", err);
          setBathymetryStatus("error");
        });
    }

    viewerRef.current = viewer;

    return () => {
      pickHandlerRef.current?.destroy();
      pickHandlerRef.current = null;
      viewer.destroy();
      viewerRef.current = null;
      sourceEntityRef.current = null;
      wavefrontEntitiesRef.current = [];
    };
  }, []);

  // Pick mode: install a left-click handler that reports cartographic coords.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (!pickMode) {
      pickHandlerRef.current?.destroy();
      pickHandlerRef.current = null;
      viewer.canvas.style.cursor = "";
      return;
    }

    viewer.canvas.style.cursor = PICK_CURSOR_STYLE;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((evt: { position: Cesium.Cartesian2 }) => {
      const cartesian = viewer.scene.camera.pickEllipsoid(evt.position, viewer.scene.globe.ellipsoid);
      if (!cartesian) return;
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      onPick?.(Cesium.Math.toDegrees(carto.latitude), Cesium.Math.toDegrees(carto.longitude));
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Escape to cancel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onPickCancel?.();
    };
    window.addEventListener("keydown", onKey);
    pickHandlerRef.current = handler;

    return () => {
      handler.destroy();
      window.removeEventListener("keydown", onKey);
      viewer.canvas.style.cursor = "";
    };
  }, [pickMode, onPick, onPickCancel]);

  // React to a new initial displacement
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!initial) {
      if (sourceEntityRef.current) {
        viewer.entities.remove(sourceEntityRef.current);
        sourceEntityRef.current = null;
      }
      return;
    }

    if (sourceEntityRef.current) viewer.entities.remove(sourceEntityRef.current);

    const { center, cavity_radius_m, peak_amplitude_m, label } = initial;
    const position = Cesium.Cartesian3.fromDegrees(center.lon_deg, center.lat_deg, 0);
    // Cavity depth ≈ cavity_diameter / 2.83 (Ward-Asphaug parabolic).
    const cavityDepthM = Math.max(2 * cavity_radius_m / 2.83, 1.0);

    sourceEntityRef.current = viewer.entities.add({
      name: label,
      position,
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString("#f9e2af"),
        outlineColor: Cesium.Color.fromCssColorString("#11111b"),
        outlineWidth: 2,
      },
      // Translucent 3D cylinder = the impact cavity.
      cylinder: {
        length: cavityDepthM,
        topRadius: Math.max(cavity_radius_m, 500),
        bottomRadius: Math.max(cavity_radius_m * 0.3, 250),
        material: Cesium.Color.fromCssColorString("#f38ba8").withAlpha(0.3),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#eba0ac"),
      },
      // Surface ring outlining the cavity rim on the water surface.
      ellipse: {
        semiMajorAxis: Math.max(cavity_radius_m, 1000),
        semiMinorAxis: Math.max(cavity_radius_m, 1000),
        material: Cesium.Color.fromCssColorString("#f38ba8").withAlpha(0.18),
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

    // Tune the fly-to range so small cavities (Lituya 100 m) don't zoom to the
    // centre of Earth and Chicxulub-class events (~50 km cavity) aren't lost.
    const flyRange = Cesium.Math.clamp(cavity_radius_m * 25, 5e5, 8e6);
    viewer.flyTo(sourceEntityRef.current, {
      duration: 1.8,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), flyRange),
    });
  }, [initial]);

  // React to a new wavefront snapshot — update existing entities in place.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !initial || !wavefront) return;

    const { lat_deg, lon_deg } = initial.center;
    const position = Cesium.Cartesian3.fromDegrees(lon_deg, lat_deg, 0);
    const maxA = Math.max(...wavefront.amplitudes_m.filter(Number.isFinite), 1e-9);

    const targetCount = Math.ceil(wavefront.ranges_m.length / 2);

    // Grow if needed.
    while (wavefrontEntitiesRef.current.length < targetCount) {
      const e = viewer.entities.add({
        position,
        ellipse: {
          semiMajorAxis: 1.0,
          semiMinorAxis: 1.0,
          material: Cesium.Color.fromCssColorString("#74c7ec").withAlpha(0.0),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#74c7ec").withAlpha(0.3),
          height: 0,
        },
      });
      wavefrontEntitiesRef.current.push(e);
    }
    // Shrink if needed.
    while (wavefrontEntitiesRef.current.length > targetCount) {
      const e = wavefrontEntitiesRef.current.pop();
      if (e) viewer.entities.remove(e);
    }

    // Update each ring in place.
    for (let i = 0, j = 0; i < wavefront.ranges_m.length; i += 2, j++) {
      const r = wavefront.ranges_m[i];
      const a = wavefront.amplitudes_m[i];
      const t = Math.min(1, (Number.isFinite(a) ? a : 0) / maxA);
      const entity = wavefrontEntitiesRef.current[j];
      if (!entity?.ellipse) continue;
      entity.position = new Cesium.ConstantPositionProperty(position);
      entity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(Math.max(r, 1));
      entity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(Math.max(r, 1));
      entity.ellipse.outlineColor = new Cesium.ConstantProperty(
        Cesium.Color.fromCssColorString("#74c7ec").withAlpha(0.25 + 0.55 * t),
      );
    }
  }, [initial, wavefront]);

  // No token configured → friendly setup empty-state.
  if (!tokenConfigured()) {
    return (
      <div className="app__globe-empty">
        <h2>Cesium ion token not configured</h2>
        <p>
          The 3D globe and GEBCO bathymetry stream from Cesium ion. Open the{" "}
          <strong>Settings</strong> panel (top right gear) and paste your free
          token, or set <code>VITE_CESIUM_TOKEN</code> in <code>.env</code>{" "}
          before running <code>npm run tauri dev</code>.
        </p>
        <p style={{ marginTop: 10 }}>
          Get one at <code>https://cesium.com/ion/signup</code> — the free tier
          is sufficient.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="app__globe-mount" ref={containerRef} />
      {pickMode && (
        <div className="app__globe-pickbanner">
          Click anywhere on the globe to set scenario location. Press
          <kbd> Esc </kbd>
          to cancel.
        </div>
      )}
      {bathymetryStatus === "loading" && (
        <div className="app__globe-status" data-status="loading">
          Loading GEBCO bathymetry…
        </div>
      )}
      {bathymetryStatus === "error" && (
        <div className="app__globe-status" data-status="error">
          Bathymetry unavailable; using WGS84 ellipsoid.
        </div>
      )}
      {!initial && bathymetryStatus !== "loading" && (
        <div className="app__globe-hint">
          Choose a preset on the left, or build a custom scenario on the right,
          to see the source event animate.
        </div>
      )}
    </>
  );
}
