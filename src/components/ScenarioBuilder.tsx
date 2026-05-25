import { useEffect, useState } from "react";
import type {
  AsteroidImpactInput,
  EarthquakeInput,
  LandslideInput,
  NuclearBurstInput,
} from "../types/scenario";

type ScenarioInput =
  | { kind: "Asteroid"; source: AsteroidImpactInput }
  | { kind: "Nuclear"; source: NuclearBurstInput }
  | { kind: "Earthquake"; source: EarthquakeInput }
  | { kind: "Landslide"; source: LandslideInput };

type Props = {
  onSimulate: (input: ScenarioInput) => void;
  /** Latitude/longitude that was just clicked on the globe — auto-fills the form. */
  pickedLocation: { lat: number; lon: number } | null;
  onTogglePick: () => void;
  pickActive: boolean;
};

type TabKey = "asteroid" | "nuclear" | "earthquake" | "landslide";

const TABS: { key: TabKey; label: string }[] = [
  { key: "asteroid", label: "Asteroid" },
  { key: "nuclear", label: "Nuclear" },
  { key: "earthquake", label: "Earthquake" },
  { key: "landslide", label: "Landslide" },
];

const INITIAL_ASTEROID: AsteroidImpactInput = {
  diameter_m: 500,
  density_kg_m3: 3000,
  velocity_m_s: 18_000,
  angle_deg: 45,
  water_depth_m: 4_000,
  location: { lat_deg: 0, lon_deg: -30, depth_m: 4_000 },
};
const INITIAL_NUCLEAR: NuclearBurstInput = {
  yield_kt: 1000,
  burst_mode: "DeepOptimal",
  burst_depth_m: 100,
  water_depth_m: 4_000,
  location: { lat_deg: 50, lon_deg: -10, depth_m: 4_000 },
};
const INITIAL_EARTHQUAKE: EarthquakeInput = {
  mw: 8.5,
  depth_m: 30_000,
  strike_deg: 195,
  dip_deg: 12,
  rake_deg: 85,
  slip_m: 15,
  fault_length_m: 0,
  fault_width_m: 0,
  water_depth_m: 2_000,
  location: { lat_deg: 38.0, lon_deg: 143.0, depth_m: 2_000 },
};
const INITIAL_LANDSLIDE: LandslideInput = {
  kind: "Submarine",
  volume_m3: 1.0e10,
  density_kg_m3: 2200,
  drop_height_m: 700,
  slope_deg: 25,
  water_depth_m: 1_500,
  water_body_width_m: 10_000,
  location: { lat_deg: -20.55, lon_deg: -175.39, depth_m: 1_500 },
};

type Bound = { min?: number; max?: number };
const BOUNDS: Record<string, Bound> = {
  diameter_m: { min: 1, max: 50_000 },
  density_kg_m3: { min: 500, max: 8_000 },
  velocity_m_s: { min: 1_000, max: 72_000 },
  angle_deg: { min: 1, max: 90 },
  water_depth_m: { min: 0, max: 12_000 },
  yield_kt: { min: 0.001, max: 1_000_000 },
  burst_depth_m: { min: 0, max: 6_000 },
  mw: { min: 5, max: 10 },
  depth_m: { min: 0, max: 100_000 },
  strike_deg: { min: 0, max: 360 },
  dip_deg: { min: 0, max: 90 },
  rake_deg: { min: -180, max: 180 },
  slip_m: { min: 0, max: 100 },
  fault_length_m: { min: 0, max: 2_000_000 },
  fault_width_m: { min: 0, max: 500_000 },
  volume_m3: { min: 1, max: 1.0e14 },
  drop_height_m: { min: 0, max: 10_000 },
  slope_deg: { min: 0, max: 90 },
  water_body_width_m: { min: 1, max: 1_000_000 },
  lat_deg: { min: -90, max: 90 },
  lon_deg: { min: -180, max: 180 },
};

function clamp(field: string, v: number): number {
  if (!Number.isFinite(v)) return BOUNDS[field]?.min ?? 0;
  const b = BOUNDS[field];
  if (!b) return v;
  if (b.min !== undefined && v < b.min) return b.min;
  if (b.max !== undefined && v > b.max) return b.max;
  return v;
}

function NumField({
  field,
  label,
  value,
  onChange,
  step,
}: {
  field: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  const b = BOUNDS[field];
  return (
    <label>
      <span>
        {label}
        {b && (
          <span className="scenario-form__bound" aria-hidden>
            {" "}({b.min ?? "−∞"} … {b.max ?? "+∞"})
          </span>
        )}
      </span>
      <input
        type="number"
        value={value}
        step={step ?? "any"}
        min={b?.min}
        max={b?.max}
        onChange={(e) => onChange(clamp(field, Number(e.target.value)))}
      />
    </label>
  );
}

export function ScenarioBuilder({ onSimulate, pickedLocation, onTogglePick, pickActive }: Props) {
  const [tab, setTab] = useState<TabKey>("asteroid");
  const [asteroid, setAsteroid] = useState(INITIAL_ASTEROID);
  const [nuclear, setNuclear] = useState(INITIAL_NUCLEAR);
  const [earthquake, setEarthquake] = useState(INITIAL_EARTHQUAKE);
  const [landslide, setLandslide] = useState(INITIAL_LANDSLIDE);

  // When the globe pick reports a location, push it into whichever tab is active.
  useEffect(() => {
    if (!pickedLocation) return;
    const { lat, lon } = pickedLocation;
    const loc = { lat_deg: clamp("lat_deg", lat), lon_deg: clamp("lon_deg", lon) };
    if (tab === "asteroid") setAsteroid((s) => ({ ...s, location: { ...s.location, ...loc } }));
    else if (tab === "nuclear") setNuclear((s) => ({ ...s, location: { ...s.location, ...loc } }));
    else if (tab === "earthquake") setEarthquake((s) => ({ ...s, location: { ...s.location, ...loc } }));
    else setLandslide((s) => ({ ...s, location: { ...s.location, ...loc } }));
  }, [pickedLocation, tab]);

  function submit() {
    if (tab === "asteroid") onSimulate({ kind: "Asteroid", source: asteroid });
    else if (tab === "nuclear") onSimulate({ kind: "Nuclear", source: nuclear });
    else if (tab === "earthquake") onSimulate({ kind: "Earthquake", source: earthquake });
    else onSimulate({ kind: "Landslide", source: landslide });
  }

  return (
    <div className="section">
      <div className="section__title">Custom Scenario Builder</div>
      <div className="scenario-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className="scenario-tab"
            data-active={tab === t.key ? "true" : "false"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="scenario-form">
        {tab === "asteroid" && (
          <>
            <NumField field="diameter_m" label="Diameter (m)" value={asteroid.diameter_m}
              onChange={(v) => setAsteroid({ ...asteroid, diameter_m: v })} />
            <NumField field="density_kg_m3" label="Density (kg/m³)" value={asteroid.density_kg_m3}
              onChange={(v) => setAsteroid({ ...asteroid, density_kg_m3: v })} />
            <NumField field="velocity_m_s" label="Velocity (m/s)" value={asteroid.velocity_m_s}
              onChange={(v) => setAsteroid({ ...asteroid, velocity_m_s: v })} />
            <NumField field="angle_deg" label="Angle (°)" value={asteroid.angle_deg}
              onChange={(v) => setAsteroid({ ...asteroid, angle_deg: v })} />
          </>
        )}
        {tab === "nuclear" && (
          <>
            <NumField field="yield_kt" label="Yield (kt TNT)" value={nuclear.yield_kt}
              onChange={(v) => setNuclear({ ...nuclear, yield_kt: v })} />
            <label>
              <span>Burst geometry</span>
              <select
                value={nuclear.burst_mode}
                onChange={(e) =>
                  setNuclear({ ...nuclear, burst_mode: e.target.value as NuclearBurstInput["burst_mode"] })
                }
              >
                <option value="Surface">Surface</option>
                <option value="Shallow">Shallow underwater</option>
                <option value="DeepOptimal">Deep (optimal)</option>
                <option value="Abyssal">Abyssal (overburdened)</option>
              </select>
            </label>
            <NumField field="burst_depth_m" label="Burst depth (m)" value={nuclear.burst_depth_m}
              onChange={(v) => setNuclear({ ...nuclear, burst_depth_m: v })} />
          </>
        )}
        {tab === "earthquake" && (
          <>
            <NumField field="mw" label="Magnitude (M_w)" value={earthquake.mw} step={0.1}
              onChange={(v) => setEarthquake({ ...earthquake, mw: v })} />
            <NumField field="depth_m" label="Hypocentre depth (m)" value={earthquake.depth_m}
              onChange={(v) => setEarthquake({ ...earthquake, depth_m: v })} />
            <NumField field="strike_deg" label="Strike (°)" value={earthquake.strike_deg}
              onChange={(v) => setEarthquake({ ...earthquake, strike_deg: v })} />
            <NumField field="dip_deg" label="Dip (°)" value={earthquake.dip_deg}
              onChange={(v) => setEarthquake({ ...earthquake, dip_deg: v })} />
            <NumField field="rake_deg" label="Rake (°)" value={earthquake.rake_deg}
              onChange={(v) => setEarthquake({ ...earthquake, rake_deg: v })} />
            <NumField field="slip_m" label="Slip (m)" value={earthquake.slip_m}
              onChange={(v) => setEarthquake({ ...earthquake, slip_m: v })} />
            <NumField field="fault_length_m" label="Fault length (m, 0 = auto)" value={earthquake.fault_length_m ?? 0}
              onChange={(v) => setEarthquake({ ...earthquake, fault_length_m: v })} />
            <NumField field="fault_width_m" label="Fault width (m, 0 = auto)" value={earthquake.fault_width_m ?? 0}
              onChange={(v) => setEarthquake({ ...earthquake, fault_width_m: v })} />
          </>
        )}
        {tab === "landslide" && (
          <>
            <label>
              <span>Type</span>
              <select
                value={landslide.kind}
                onChange={(e) =>
                  setLandslide({ ...landslide, kind: e.target.value as LandslideInput["kind"] })
                }
              >
                <option value="Subaerial">Subaerial (rock-fall into water)</option>
                <option value="Submarine">Submarine (slope failure)</option>
              </select>
            </label>
            <NumField field="volume_m3" label="Volume (m³)" value={landslide.volume_m3}
              onChange={(v) => setLandslide({ ...landslide, volume_m3: v })} />
            <NumField field="density_kg_m3" label="Density (kg/m³)" value={landslide.density_kg_m3}
              onChange={(v) => setLandslide({ ...landslide, density_kg_m3: v })} />
            <NumField field="drop_height_m" label="Drop height (m)" value={landslide.drop_height_m}
              onChange={(v) => setLandslide({ ...landslide, drop_height_m: v })} />
            <NumField field="slope_deg" label="Slope (°)" value={landslide.slope_deg}
              onChange={(v) => setLandslide({ ...landslide, slope_deg: v })} />
            <NumField field="water_body_width_m" label="Receiving body width (m)" value={landslide.water_body_width_m}
              onChange={(v) => setLandslide({ ...landslide, water_body_width_m: v })} />
          </>
        )}

        <NumField field="lat_deg" label="Latitude (°)"
          value={currentLat({ tab, asteroid, nuclear, earthquake, landslide })}
          onChange={(v) =>
            applyLocation(v, "lat", { tab, asteroid, setAsteroid, nuclear, setNuclear, earthquake, setEarthquake, landslide, setLandslide })
          } />
        <NumField field="lon_deg" label="Longitude (°)"
          value={currentLon({ tab, asteroid, nuclear, earthquake, landslide })}
          onChange={(v) =>
            applyLocation(v, "lon", { tab, asteroid, setAsteroid, nuclear, setNuclear, earthquake, setEarthquake, landslide, setLandslide })
          } />
        <NumField field="water_depth_m" label="Water depth (m)"
          value={currentDepth({ tab, asteroid, nuclear, earthquake, landslide })}
          onChange={(v) =>
            applyDepth(v, { tab, asteroid, setAsteroid, nuclear, setNuclear, earthquake, setEarthquake, landslide, setLandslide })
          } />

        <label className="full" style={{ flexDirection: "row", gap: 8 }}>
          <button
            className="scenario-pick"
            data-active={pickActive ? "true" : "false"}
            onClick={onTogglePick}
            type="button"
          >
            {pickActive ? "Click globe to pick (Esc to cancel)" : "Pick on globe →"}
          </button>
          <button className="primary" style={{ flex: 1 }} onClick={submit} type="button">
            Simulate
          </button>
        </label>
      </div>
    </div>
  );
}

// --- Helpers to thread the lat/lon/depth fields across whichever tab is active. ---

type Bundle = {
  tab: TabKey;
  asteroid: AsteroidImpactInput;
  nuclear: NuclearBurstInput;
  earthquake: EarthquakeInput;
  landslide: LandslideInput;
};
type SetBundle = Bundle & {
  setAsteroid: (s: AsteroidImpactInput) => void;
  setNuclear: (s: NuclearBurstInput) => void;
  setEarthquake: (s: EarthquakeInput) => void;
  setLandslide: (s: LandslideInput) => void;
};

function currentLat(b: Bundle): number {
  return b.tab === "asteroid" ? b.asteroid.location.lat_deg
       : b.tab === "nuclear" ? b.nuclear.location.lat_deg
       : b.tab === "earthquake" ? b.earthquake.location.lat_deg
       : b.landslide.location.lat_deg;
}
function currentLon(b: Bundle): number {
  return b.tab === "asteroid" ? b.asteroid.location.lon_deg
       : b.tab === "nuclear" ? b.nuclear.location.lon_deg
       : b.tab === "earthquake" ? b.earthquake.location.lon_deg
       : b.landslide.location.lon_deg;
}
function currentDepth(b: Bundle): number {
  return b.tab === "asteroid" ? b.asteroid.water_depth_m
       : b.tab === "nuclear" ? b.nuclear.water_depth_m
       : b.tab === "earthquake" ? b.earthquake.water_depth_m
       : b.landslide.water_depth_m;
}
function applyLocation(v: number, axis: "lat" | "lon", b: SetBundle) {
  const key = axis === "lat" ? "lat_deg" : "lon_deg";
  if (b.tab === "asteroid") b.setAsteroid({ ...b.asteroid, location: { ...b.asteroid.location, [key]: v } });
  else if (b.tab === "nuclear") b.setNuclear({ ...b.nuclear, location: { ...b.nuclear.location, [key]: v } });
  else if (b.tab === "earthquake") b.setEarthquake({ ...b.earthquake, location: { ...b.earthquake.location, [key]: v } });
  else b.setLandslide({ ...b.landslide, location: { ...b.landslide.location, [key]: v } });
}
function applyDepth(v: number, b: SetBundle) {
  if (b.tab === "asteroid") b.setAsteroid({ ...b.asteroid, water_depth_m: v, location: { ...b.asteroid.location, depth_m: v } });
  else if (b.tab === "nuclear") b.setNuclear({ ...b.nuclear, water_depth_m: v, location: { ...b.nuclear.location, depth_m: v } });
  else if (b.tab === "earthquake") b.setEarthquake({ ...b.earthquake, water_depth_m: v, location: { ...b.earthquake.location, depth_m: v } });
  else b.setLandslide({ ...b.landslide, water_depth_m: v, location: { ...b.landslide.location, depth_m: v } });
}
