import { useEffect, useRef, useState } from "react";
import { settings, type SavedScenario } from "../lib/settings";
import {
  createScenarioPayload,
  INITIAL_ASTEROID,
  INITIAL_EARTHQUAKE,
  INITIAL_LANDSLIDE,
  INITIAL_NUCLEAR,
  parseScenarioPayload,
  SCENARIO_BOUNDS as BOUNDS,
  type ScenarioInput,
} from "../lib/scenario-schema";
import type {
  AsteroidImpactInput,
  EarthquakeInput,
  LandslideInput,
  NuclearBurstInput,
} from "../types/scenario";

type Props = {
  onSimulate: (input: ScenarioInput) => void;
  /** Latitude/longitude that was just clicked on the globe — auto-fills the form. */
  pickedLocation: { lat: number; lon: number } | null;
  onTogglePick: () => void;
  pickActive: boolean;
};

type TabKey = "asteroid" | "nuclear" | "earthquake" | "landslide";
type InlineStatus = { text: string; tone: "info" | "success" | "error" };

const TABS: { key: TabKey; label: string }[] = [
  { key: "asteroid", label: "Asteroid" },
  { key: "nuclear", label: "Nuclear" },
  { key: "earthquake", label: "Earthquake" },
  { key: "landslide", label: "Landslide" },
];

const TAB_DESCRIPTIONS: Record<TabKey, string> = {
  asteroid: "Impact cavity model with water-depth-aware source geometry.",
  nuclear: "Underwater and surface burst coupling with yield and depth controls.",
  earthquake: "Fault-source parameters for Okada-style seafloor displacement.",
  landslide: "Subaerial and submarine slide source geometry for confined or open water.",
};

const PARAM_HELP: Record<string, string> = {
  diameter_m: "Impactor diameter. Chicxulub: ~14 km; typical NEO: 100–500 m. Ward & Asphaug 2000.",
  density_kg_m3: "Material density. Iron: ~7 800; stony: ~3 000; cometary ice: ~500. Schmidt & Holsapple 1982.",
  velocity_m_s: "Impact speed. Earth-crossing asteroids average ~18 km/s; comets up to 72 km/s.",
  angle_deg: "Impact angle from horizontal. 45° is most probable. Steeper = deeper cavity.",
  water_depth_m: "Ocean depth at the source. Controls wave speed c = √(gh) and cavity geometry.",
  yield_kt: "Nuclear yield in kilotons TNT equivalent. Glasstone & Dolan 1977.",
  burst_depth_m: "Detonation depth below surface. Deeper = more coupling to water column. Le Méhauté 1996.",
  mw: "Moment magnitude. Controls fault slip area and displacement. Kanamori 1977.",
  depth_m: "Hypocentre depth below seafloor. Shallower = more seafloor displacement.",
  strike_deg: "Fault strike azimuth (0–360°). Direction the fault plane faces. Okada 1985.",
  dip_deg: "Fault dip angle (0–90°). Angle the fault plane makes with horizontal. Okada 1985.",
  rake_deg: "Slip direction on the fault plane (−180 to 180°). 90° = pure thrust. Okada 1985.",
  slip_m: "Average coseismic displacement on the fault. Tōhoku 2011: ~15 m. Okada 1985.",
  fault_length_m: "Along-strike fault dimension. 0 = auto from Wells–Coppersmith 1994 scaling.",
  fault_width_m: "Down-dip fault dimension. 0 = auto from Wells–Coppersmith 1994 scaling.",
  volume_m3: "Slide volume. Lituya Bay 1958: ~30 M m³; Storegga: ~3 000 km³.",
  drop_height_m: "Vertical fall of the slide mass centre. Fritz & Hager 2001.",
  slope_deg: "Slope angle of the failure surface. Steeper = faster slide. Slingerland & Voight.",
  water_body_width_m: "Width of the receiving water body. Constrains 2D channel geometry.",
  lat_deg: "Source latitude (−90° to 90°).",
  lon_deg: "Source longitude (−180° to 180°).",
};

const SLIDER_FIELDS = new Set([
  "diameter_m", "density_kg_m3", "velocity_m_s", "angle_deg",
  "water_depth_m", "yield_kt", "burst_depth_m", "mw",
  "dip_deg", "slope_deg", "drop_height_m", "slip_m",
]);

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
  const help = PARAM_HELP[field];
  const showSlider = SLIDER_FIELDS.has(field);
  const [helpOpen, setHelpOpen] = useState(false);
  const [draft, setDraft] = useState<string>(() => String(value));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value));
  }, [value]);

  function commit() {
    const parsed = Number(draft);
    const next = clamp(field, parsed);
    onChange(next);
    setDraft(String(next));
  }

  return (
    <label className="scenario-field">
      <span className="scenario-field__header">
        <span>
          {label}
          {b && (
            <span className="scenario-form__bound" aria-hidden>
              {" "}({b.min ?? "−∞"} … {b.max ?? "+∞"})
            </span>
          )}
        </span>
        {help && (
          <button
            type="button"
            className="scenario-field__help-btn"
            aria-label={`Help: ${label}`}
            aria-expanded={helpOpen}
            onClick={(e) => { e.preventDefault(); setHelpOpen((v) => !v); }}
          >
            ?
          </button>
        )}
      </span>
      {helpOpen && help && (
        <span className="scenario-field__help-text" role="note">
          {help}
        </span>
      )}
      <span className="scenario-field__inputs">
        <input
          type="number"
          value={draft}
          step={step ?? "any"}
          min={b?.min}
          max={b?.max}
          onFocus={() => { focusedRef.current = true; }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { focusedRef.current = false; commit(); }}
        />
        {showSlider && b?.min !== undefined && b?.max !== undefined && (
          <input
            type="range"
            className="scenario-field__slider"
            min={b.min}
            max={b.max}
            step={step ?? (b.max - b.min) / 200}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange(v);
              setDraft(String(v));
            }}
            aria-label={`${label} slider`}
          />
        )}
      </span>
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

  const [clipMsg, setClipMsg] = useState<InlineStatus | null>(null);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const clipTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    settings.getSavedScenarios().then(setSavedScenarios).catch(() => {});
  }, []);
  useEffect(() => () => window.clearTimeout(clipTimer.current), []);

  function showStatus(text: string, tone: InlineStatus["tone"] = "info") {
    setClipMsg({ text, tone });
    window.clearTimeout(clipTimer.current);
    clipTimer.current = window.setTimeout(() => setClipMsg(null), tone === "error" ? 5000 : 2200);
  }

  function currentScenarioData(): ScenarioInput {
    return tab === "asteroid" ? { kind: "Asteroid", source: asteroid }
      : tab === "nuclear" ? { kind: "Nuclear", source: nuclear }
      : tab === "earthquake" ? { kind: "Earthquake", source: earthquake }
      : { kind: "Landslide", source: landslide };
  }

  function applyScenario(data: ScenarioInput) {
    if (data.kind === "Asteroid") {
      setTab("asteroid");
      setAsteroid(data.source);
    } else if (data.kind === "Nuclear") {
      setTab("nuclear");
      setNuclear(data.source);
    } else if (data.kind === "Earthquake") {
      setTab("earthquake");
      setEarthquake(data.source);
    } else {
      setTab("landslide");
      setLandslide(data.source);
    }
  }

  function saveCurrentScenario() {
    const data = currentScenarioData();
    const payload = createScenarioPayload(data);
    if (!payload.ok) {
      showStatus(`Save blocked: ${payload.reason}`, "error");
      return;
    }
    const name = `${data.kind} — ${new Date().toLocaleString()}`;
    settings.saveScenario(name, payload.payload).then(() => {
      settings.getSavedScenarios().then(setSavedScenarios);
      showStatus("Saved scenario.", "success");
    }).catch((err) => {
      showStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    });
  }

  function loadScenario(s: SavedScenario) {
    const parsed = parseScenarioPayload(s.data);
    if (!parsed.ok) {
      showStatus(`Saved scenario rejected: ${parsed.reason}`, "error");
      return;
    }
    applyScenario(parsed.scenario);
    setShowSaved(false);
    showStatus(parsed.migrated ? "Loaded legacy scenario." : "Loaded scenario.", "success");
  }

  function deleteScenario(idx: number) {
    settings.deleteScenario(idx).then(() => {
      settings.getSavedScenarios().then(setSavedScenarios);
    });
  }

  function submit() {
    if (tab === "asteroid") onSimulate({ kind: "Asteroid", source: asteroid });
    else if (tab === "nuclear") onSimulate({ kind: "Nuclear", source: nuclear });
    else if (tab === "earthquake") onSimulate({ kind: "Earthquake", source: earthquake });
    else onSimulate({ kind: "Landslide", source: landslide });
  }

  function copyScenario() {
    const payload = createScenarioPayload(currentScenarioData());
    if (!payload.ok) {
      showStatus(`Copy blocked: ${payload.reason}`, "error");
      return;
    }
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) {
      showStatus("Copy failed: clipboard is unavailable.", "error");
      return;
    }
    writeText.call(navigator.clipboard, JSON.stringify(payload.payload)).then(
      () => showStatus("Copied scenario.", "success"),
      () => showStatus("Copy failed.", "error"),
    );
  }

  function pasteScenario() {
    const readText = navigator.clipboard?.readText;
    if (!readText) {
      showStatus("Paste failed: clipboard is unavailable.", "error");
      return;
    }
    readText.call(navigator.clipboard).then((text) => {
      try {
        const parsed = parseScenarioPayload(JSON.parse(text));
        if (!parsed.ok) {
          showStatus(`Paste rejected: ${parsed.reason}`, "error");
          return;
        }
        applyScenario(parsed.scenario);
        showStatus(parsed.migrated ? "Pasted legacy scenario." : "Pasted scenario.", "success");
      } catch {
        showStatus("Paste rejected: clipboard does not contain valid JSON.", "error");
      }
    }).catch(() => showStatus("Paste failed.", "error"));
  }

  return (
    <div className="section">
      <div className="section__title">Custom scenario</div>
      <div className="scenario-tabs" role="tablist" aria-label="Scenario source type">
        {TABS.map((t) => (
          <button
            key={t.key}
            className="scenario-tab"
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            data-active={tab === t.key ? "true" : "false"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="scenario-summary">{TAB_DESCRIPTIONS[tab]}</p>

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

        <div className="scenario-form__actions">
          <button
            className="scenario-pick"
            data-active={pickActive ? "true" : "false"}
            onClick={onTogglePick}
            type="button"
          >
            {pickActive ? "Picking location" : "Pick on globe"}
          </button>
          <button className="primary" onClick={submit} type="button">
            Simulate
          </button>
        </div>
        <div className="scenario-actions__row">
          <button onClick={saveCurrentScenario} type="button" title="Save current scenario for later">
            Save
          </button>
          <button onClick={() => setShowSaved((v) => !v)} type="button" title="Load a saved scenario">
            Load{savedScenarios.length > 0 ? ` (${savedScenarios.length})` : ""}
          </button>
          <button onClick={copyScenario} type="button" title="Copy scenario parameters to clipboard">
            Copy
          </button>
          <button onClick={pasteScenario} type="button" title="Paste scenario parameters from clipboard">
            Paste
          </button>
          {clipMsg && (
            <span
              className="scenario-actions__clip"
              data-tone={clipMsg.tone}
              role={clipMsg.tone === "error" ? "alert" : "status"}
              aria-live={clipMsg.tone === "error" ? "assertive" : "polite"}
            >
              {clipMsg.text}
            </span>
          )}
        </div>
        {showSaved && savedScenarios.length > 0 && (
          <div className="scenario-saved">
            {savedScenarios.map((s, i) => (
              <div key={i} className="scenario-saved__item">
                <button
                  className="scenario-saved__load"
                  onClick={() => loadScenario(s)}
                  type="button"
                >
                  {s.name}
                </button>
                <button
                  className="scenario-saved__del"
                  onClick={() => deleteScenario(i)}
                  type="button"
                  aria-label={`Delete ${s.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {showSaved && savedScenarios.length === 0 && (
          <div className="scenario-saved__empty">No saved scenarios yet.</div>
        )}
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
