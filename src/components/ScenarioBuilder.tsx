import { useCallback, useEffect, useRef, useState } from "react";
import { settings, type SavedScenario, type ScenarioRestorePoint } from "../lib/settings";
import { faultGeometryFromZone, nearestSubductionZone } from "../lib/subduction";
import {
  asyncResultValue,
  rejectAsyncResult,
  resolveAsyncResult,
  startAsyncResult,
  type AsyncResult,
} from "../lib/async-result";
import {
  createScenarioPayload,
  INITIAL_ASTEROID,
  INITIAL_EARTHQUAKE,
  INITIAL_LANDSLIDE,
  INITIAL_METEOTSUNAMI,
  INITIAL_NUCLEAR,
  parseScenarioPayload,
  SCENARIO_BOUNDS as BOUNDS,
  sourceBound,
  sourceEnumValues,
  type ScenarioInput,
} from "../lib/scenario-schema";
import type {
  AsteroidImpactInput,
  EarthquakeInput,
  LandslideInput,
  MeteotsunamiInput,
  NuclearBurstInput,
} from "../types/scenario";
import { UiIcon } from "./UiIcon";
import { GlossaryTip } from "./GlossaryTip";
import { NumericField } from "./NumericField";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";
import { useUnits } from "../hooks/useUnits";
import { formatLength, formatSpeed, quantityText } from "../lib/units";
import { downloadBlob } from "../lib/export";
import { APP_VERSION } from "../lib/model-provenance";
import { api, isTauri } from "../lib/tauri";
import {
  PORTABLE_SCENARIO_EXTENSION,
  PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES,
  createPortableScenarioPackage,
  inspectPortableScenarioPackage,
  type PortableJson,
  type PortableScenarioCitation,
  type PortableScenarioDataReference,
  type PortableScenarioImport,
  type PortableScenarioSolverSettings,
  type PortableScenarioWorkspace,
} from "../lib/portable-scenario-package";

const FEET_PER_METER = 3.28084;
const MILES_PER_METER = 0.000621371;
const MPH_PER_MS = 2.23694;
const LB_FT3_PER_KG_M3 = 0.06242796;
const CUBIC_FT_PER_CUBIC_M = 35.3147;
const CUBIC_MI_PER_CUBIC_M = 2.39913e-10;

type Props = {
  onSimulate: (input: ScenarioInput) => void;
  editRequest?: { id: number; scenario: ScenarioInput; provenanceNote?: string } | null;
  /** Latitude/longitude that was just clicked on the globe — auto-fills the form. */
  pickedLocation: { lat: number; lon: number } | null;
  onTogglePick: () => void;
  pickActive: boolean;
  portableContext?: ScenarioPortableContext;
  onImportPortableContext?: (imported: PortableScenarioImport) => void | Promise<void>;
};

export type ScenarioPortableContext = {
  solverSettings: PortableScenarioSolverSettings;
  workspace: PortableScenarioWorkspace;
  citations: PortableScenarioCitation[];
  provenance: PortableJson;
  results?: PortableJson;
  checkpoints?: PortableJson;
  dataReferences?: PortableScenarioDataReference[];
};

type TabKey = "asteroid" | "nuclear" | "earthquake" | "landslide" | "meteotsunami";
type InlineStatus = {
  text: string;
  tone: "info" | "success" | "error";
  action?: { label: string; run: () => void };
};

const TABS: { key: TabKey; labelKey: MessageKey }[] = [
  { key: "asteroid", labelKey: "builder.tab.asteroid" },
  { key: "nuclear", labelKey: "builder.tab.nuclear" },
  { key: "earthquake", labelKey: "builder.tab.earthquake" },
  { key: "landslide", labelKey: "builder.tab.landslide" },
  { key: "meteotsunami", labelKey: "builder.tab.meteotsunami" },
];

const TAB_DESCRIPTIONS: Record<TabKey, MessageKey> = {
  asteroid: "builder.description.asteroid",
  nuclear: "builder.description.nuclear",
  earthquake: "builder.description.earthquake",
  landslide: "builder.description.landslide",
  meteotsunami: "builder.description.meteotsunami",
};

const PARAM_HELP: Record<string, MessageKey> = {
  diameter_m: "builder.help.diameter",
  density_kg_m3: "builder.help.density",
  velocity_m_s: "builder.help.velocity",
  angle_deg: "builder.help.angle",
  water_depth_m: "builder.help.waterDepth",
  yield_kt: "builder.help.yield",
  burst_depth_m: "builder.help.burstDepth",
  mw: "builder.help.magnitude",
  depth_m: "builder.help.hypocentreDepth",
  strike_deg: "builder.help.strike",
  dip_deg: "builder.help.dip",
  rake_deg: "builder.help.rake",
  slip_m: "builder.help.slip",
  fault_length_m: "builder.help.faultLength",
  fault_width_m: "builder.help.faultWidth",
  volume_m3: "builder.help.volume",
  drop_height_m: "builder.help.dropHeight",
  slope_deg: "builder.help.slope",
  water_body_width_m: "builder.help.waterBodyWidth",
  peak_pressure_pa: "builder.help.peakPressure",
  speed_m_s: "builder.help.speed",
  heading_deg: "builder.help.heading",
  along_track_sigma_m: "builder.help.alongTrack",
  cross_track_sigma_m: "builder.help.crossTrack",
  track_length_m: "builder.help.trackLength",
  lat_deg: "builder.help.latitude",
  lon_deg: "builder.help.longitude",
};

const SOURCE_LABELS: Record<ScenarioInput["kind"], MessageKey> = {
  Asteroid: "builder.tab.asteroid",
  Nuclear: "builder.tab.nuclear",
  Earthquake: "builder.tab.earthquake",
  Landslide: "builder.tab.landslide",
  Meteotsunami: "builder.tab.meteotsunami",
};

const SLIDER_FIELDS = new Set([
  "diameter_m", "density_kg_m3", "velocity_m_s", "angle_deg",
  "water_depth_m", "yield_kt", "burst_depth_m", "mw",
  "dip_deg", "slope_deg", "drop_height_m", "slip_m",
  "peak_pressure_pa", "speed_m_s", "heading_deg",
]);

function portableFileName(kind: ScenarioInput["kind"]): string {
  const date = new Date().toISOString().slice(0, 10);
  return `cataclysm-${kind.toLowerCase()}-${date}${PORTABLE_SCENARIO_EXTENSION}`;
}

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
  bounds,
}: {
  field: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  bounds?: { min: number; max: number };
}) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const b = bounds ?? BOUNDS[field];
  const helpKey = PARAM_HELP[field];
  const showSlider = SLIDER_FIELDS.has(field);
  if (!b || b.min === undefined || b.max === undefined) {
    throw new Error(`Missing numeric bounds for ${field}`);
  }
  const min = b.min;
  const max = b.max;
  let factor = 1;
  let unit: string | undefined;
  if (field.endsWith("_m")) {
    if (unitSystem === "imperial") {
      factor = Math.abs(value * MILES_PER_METER) >= 0.1 ? MILES_PER_METER : FEET_PER_METER;
      unit = factor === MILES_PER_METER ? "mi" : "ft";
    } else unit = "m";
  } else if (field.endsWith("_m_s")) {
    factor = unitSystem === "imperial" ? MPH_PER_MS : 1;
    unit = unitSystem === "imperial" ? "mph" : "m/s";
  } else if (field.endsWith("_kg_m3")) {
    factor = unitSystem === "imperial" ? LB_FT3_PER_KG_M3 : 1;
    unit = unitSystem === "imperial" ? "lb/ft³" : "kg/m³";
  } else if (field.endsWith("_m3")) {
    if (unitSystem === "imperial") {
      factor = Math.abs(value * CUBIC_MI_PER_CUBIC_M) >= 0.001
        ? CUBIC_MI_PER_CUBIC_M
        : CUBIC_FT_PER_CUBIC_M;
      unit = factor === CUBIC_MI_PER_CUBIC_M ? "mi³" : "ft³";
    } else unit = "m³";
  }
  const displayLabel = label.replace(/\s*\((?:kg\/m³|m\/s|m³|m)(?:,\s*([^)]*))?\)/gu, (_match, note: string | undefined) => note ? ` (${note})` : "");
  const displayValue = value * factor;
  return (
    <NumericField
      layout="scenario"
      label={displayLabel}
      value={displayValue}
      min={min * factor}
      max={max * factor}
      step={step === undefined ? "any" : step * factor}
      unit={unit}
      help={helpKey
        ? unitSystem === "imperial" && unit
          ? t("builder.imperialInputHelp", { unit })
          : t(helpKey)
        : undefined}
      onCommit={(next) => onChange(next / factor)}
      slider={showSlider ? {
        value,
        min,
        max,
        step: step ?? (max - min) / 200,
        valueText: `${formatNumber(displayValue)}${unit ? ` ${unit}` : ""}`,
        onChange,
      } : undefined}
    />
  );
}

export function ScenarioBuilder({ onSimulate, editRequest, pickedLocation, onTogglePick, pickActive, portableContext, onImportPortableContext }: Props) {
  const { t, formatNumber, languageTag } = useI18n();
  const unitSystem = useUnits();
  const [tab, setTab] = useState<TabKey>("asteroid");
  const [asteroid, setAsteroid] = useState(INITIAL_ASTEROID);
  const [nuclear, setNuclear] = useState(INITIAL_NUCLEAR);
  const [earthquake, setEarthquake] = useState(INITIAL_EARTHQUAKE);
  const [landslide, setLandslide] = useState(INITIAL_LANDSLIDE);
  const [meteotsunami, setMeteotsunami] = useState(INITIAL_METEOTSUNAMI);
  const [subductionNote, setSubductionNote] = useState<InlineStatus | null>(null);
  const [importProvenance, setImportProvenance] = useState<string | null>(null);
  const burstModes = sourceEnumValues("Nuclear", "burst_mode", true);
  const landslideKinds = sourceEnumValues("Landslide", "kind", true);

  useEffect(() => {
    if (!editRequest) return;
    applyScenario(editRequest.scenario);
    setImportProvenance(editRequest.provenanceNote ?? null);
  }, [editRequest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the globe pick reports a location, push it into whichever tab is active.
  useEffect(() => {
    if (!pickedLocation) return;
    const { lat, lon } = pickedLocation;
    const loc = { lat_deg: clamp("lat_deg", lat), lon_deg: clamp("lon_deg", lon) };
    if (tab === "asteroid") setAsteroid((s) => ({ ...s, location: { ...s.location, ...loc } }));
    else if (tab === "nuclear") setNuclear((s) => ({ ...s, location: { ...s.location, ...loc } }));
    else if (tab === "earthquake") setEarthquake((s) => ({ ...s, location: { ...s.location, ...loc } }));
    else if (tab === "landslide") setLandslide((s) => ({ ...s, location: { ...s.location, ...loc } }));
    else setMeteotsunami((s) => ({ ...s, location: { ...s.location, ...loc } }));
  }, [pickedLocation, tab]);

  // Auto-fill Okada fault orientation from the nearest mapped subduction zone
  // (Slab2-derived representative geometry). Only prepares solver inputs — the
  // Okada physics still runs in Rust. Fault length/width stay 0 (auto-sized).
  const autoFillFaultFromZone = () => {
    const match = nearestSubductionZone(earthquake.location.lat_deg, earthquake.location.lon_deg);
    if (!match) {
      setSubductionNote({ text: t("builder.autoFillInvalid"), tone: "error" });
      return;
    }
    if (!match.onMappedZone) {
      setSubductionNote({
        text: t("builder.autoFillNoZone", {
          zone: match.zone.name,
          distance: quantityText(formatLength(match.distanceKm * 1000, formatNumber, unitSystem)),
        }),
        tone: "error",
      });
      return;
    }
    const g = faultGeometryFromZone(match.zone);
    setEarthquake((s) => ({ ...s, ...g }));
    setSubductionNote({
      text: t("builder.autoFillSuccess", {
        zone: match.zone.name,
        distance: quantityText(formatLength(match.distanceKm * 1000, formatNumber, unitSystem)),
        strike: formatNumber(g.strike_deg),
        dip: formatNumber(g.dip_deg),
        rake: formatNumber(g.rake_deg),
        depth: quantityText(formatLength(g.depth_m, formatNumber, unitSystem)),
        reference: match.zone.reference_event,
      }),
      tone: "success",
    });
  };

  const [clipMsg, setClipMsg] = useState<InlineStatus | null>(null);
  const [savedScenariosResult, setSavedScenariosResult] = useState<AsyncResult<SavedScenario[]>>({ status: "loading" });
  const savedScenarios = asyncResultValue(savedScenariosResult) ?? [];
  const [showSaved, setShowSaved] = useState(false);
  const [portableBusy, setPortableBusy] = useState(false);
  const [portablePreview, setPortablePreview] = useState<PortableScenarioImport | null>(null);
  const [includePortableResults, setIncludePortableResults] = useState(false);
  const portableInputRef = useRef<HTMLInputElement | null>(null);
  const clipTimer = useRef<number | undefined>(undefined);
  const scenarioActionVersion = useRef(0);

  const setSavedScenarios = useCallback((update: SavedScenario[] | ((current: SavedScenario[]) => SavedScenario[])) => {
    setSavedScenariosResult((current) => {
      const previous = asyncResultValue(current) ?? [];
      const next = typeof update === "function" ? update(previous) : update;
      return resolveAsyncResult(next, (items) => items.length === 0);
    });
  }, []);

  const loadSavedScenarios = useCallback(() => {
    setSavedScenariosResult((current) => startAsyncResult(current));
    settings
      .getSavedScenarios()
      .then((items) => setSavedScenariosResult(resolveAsyncResult(items, (list) => list.length === 0)))
      .catch((err) => {
        console.warn("[settings] failed to load saved scenarios", err);
        setSavedScenariosResult((current) => rejectAsyncResult(current, err));
      });
  }, []);

  useEffect(() => {
    loadSavedScenarios();
  }, [loadSavedScenarios]);
  useEffect(() => () => window.clearTimeout(clipTimer.current), []);

  function showStatus(
    text: string,
    tone: InlineStatus["tone"] = "info",
    action?: InlineStatus["action"],
  ) {
    setClipMsg({ text, tone, action });
    window.clearTimeout(clipTimer.current);
    clipTimer.current = window.setTimeout(
      () => setClipMsg(null),
      action ? 8_000 : tone === "error" ? 5_000 : 2_200,
    );
  }

  function currentScenarioData(): ScenarioInput {
    return tab === "asteroid" ? { kind: "Asteroid", source: asteroid }
      : tab === "nuclear" ? { kind: "Nuclear", source: nuclear }
      : tab === "earthquake" ? { kind: "Earthquake", source: earthquake }
      : tab === "landslide" ? { kind: "Landslide", source: landslide }
      : { kind: "Meteotsunami", source: meteotsunami };
  }

  function applyScenario(data: ScenarioInput) {
    setImportProvenance(null);
    if (data.kind === "Asteroid") {
      setTab("asteroid");
      setAsteroid(data.source);
    } else if (data.kind === "Nuclear") {
      setTab("nuclear");
      setNuclear(data.source);
    } else if (data.kind === "Earthquake") {
      setTab("earthquake");
      setEarthquake(data.source);
    } else if (data.kind === "Landslide") {
      setTab("landslide");
      setLandslide(data.source);
    } else {
      setTab("meteotsunami");
      setMeteotsunami(data.source);
    }
  }

  function saveCurrentScenario() {
    const data = currentScenarioData();
    const payload = createScenarioPayload(data);
    if (!payload.ok) {
      showStatus(t("builder.saveBlocked", { reason: payload.reason }), "error");
      return;
    }
    const name = t("builder.savedName", {
      kind: t(SOURCE_LABELS[data.kind]),
      date: new Date().toLocaleString(languageTag),
    });
    settings.saveScenario(name, payload.payload).then(() => {
      loadSavedScenarios();
      showStatus(t("builder.saved"), "success");
    }).catch((err) => {
      showStatus(t("builder.saveFailed", { error: err instanceof Error ? err.message : String(err) }), "error");
    });
  }

  function loadScenario(s: SavedScenario) {
    const parsed = parseScenarioPayload(s.data);
    if (!parsed.ok) {
      showStatus(t("builder.savedRejected", { reason: parsed.reason }), "error");
      return;
    }
    applyScenario(parsed.scenario);
    setShowSaved(false);
    showStatus(
      parsed.migrations.length > 0
        ? t("builder.loadedMigration", { count: formatNumber(parsed.migrations.length) })
        : t("builder.loaded"),
      "success",
    );
  }

  function deleteScenario(id: string) {
    const index = savedScenarios.findIndex((scenario) => scenario.id === id);
    if (index < 0) return;
    const scenario = savedScenarios[index];
    const restorePoint: ScenarioRestorePoint = {
      index,
      beforeId: savedScenarios[index - 1]?.id,
      afterId: savedScenarios[index + 1]?.id,
    };
    const version = ++scenarioActionVersion.current;
    let undoRequested = false;
    const insertIfMissing = (list: SavedScenario[]) => {
      if (list.some((entry) => entry.id === scenario.id)) return list;
      const next = [...list];
      next.splice(Math.min(index, next.length), 0, scenario);
      return next;
    };
    const undo = () => {
      if (undoRequested) return;
      undoRequested = true;
      setSavedScenarios(insertIfMissing);
      showStatus(t("builder.restoring", { name: scenario.name }));
      void settings.restoreScenario(scenario, restorePoint).then(async () => {
        setSavedScenarios(await settings.getSavedScenarios());
        if (scenarioActionVersion.current === version) {
          showStatus(t("builder.restored", { name: scenario.name }), "success");
        }
      }).catch(async (error) => {
        setSavedScenarios(await settings.getSavedScenarios());
        if (scenarioActionVersion.current === version) {
          showStatus(t("builder.undoFailed", { error: error instanceof Error ? error.message : String(error) }), "error");
        }
      });
    };

    setSavedScenarios((list) => list.filter((entry) => entry.id !== id));
    showStatus(t("builder.deleted", { name: scenario.name }), "success", { label: t("builder.undo"), run: undo });
    void settings.deleteScenario(id).catch(async (error) => {
      if (undoRequested) return;
      setSavedScenarios(await settings.getSavedScenarios());
      if (scenarioActionVersion.current === version) {
        showStatus(t("builder.deleteFailed", { error: error instanceof Error ? error.message : String(error) }), "error");
      }
    });
  }

  function submit() {
    if (tab === "asteroid") onSimulate({ kind: "Asteroid", source: asteroid });
    else if (tab === "nuclear") onSimulate({ kind: "Nuclear", source: nuclear });
    else if (tab === "earthquake") onSimulate({ kind: "Earthquake", source: earthquake });
    else if (tab === "landslide") onSimulate({ kind: "Landslide", source: landslide });
    else onSimulate({ kind: "Meteotsunami", source: meteotsunami });
  }

  function copyScenario() {
    const payload = createScenarioPayload(currentScenarioData());
    if (!payload.ok) {
      showStatus(t("builder.copyBlocked", { reason: payload.reason }), "error");
      return;
    }
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) {
      showStatus(t("builder.copyUnavailable"), "error");
      return;
    }
    writeText.call(navigator.clipboard, JSON.stringify(payload.payload)).then(
      () => showStatus(t("builder.copied"), "success"),
      () => showStatus(t("builder.copyFailed"), "error"),
    );
  }

  function pasteScenario() {
    const readText = navigator.clipboard?.readText;
    if (!readText) {
      showStatus(t("builder.pasteUnavailable"), "error");
      return;
    }
    readText.call(navigator.clipboard).then((text) => {
      try {
        const parsed = parseScenarioPayload(JSON.parse(text));
        if (!parsed.ok) {
          showStatus(t("builder.pasteRejected", { reason: parsed.reason }), "error");
          return;
        }
        applyScenario(parsed.scenario);
        showStatus(
          parsed.migrations.length > 0
            ? t("builder.pastedMigration", { count: formatNumber(parsed.migrations.length) })
            : t("builder.pasted"),
          "success",
        );
      } catch {
        showStatus(t("builder.pasteInvalid"), "error");
      }
    }).catch(() => showStatus(t("builder.pasteFailed"), "error"));
  }

  async function exportPortableScenario() {
    const data = currentScenarioData();
    const payload = createScenarioPayload(data);
    if (!payload.ok) {
      showStatus(t("builder.packageExportBlocked", { reason: payload.reason }), "error");
      return;
    }
    setPortableBusy(true);
    try {
      const exportedSettings = JSON.parse(await settings.exportSettings()) as PortableJson;
      const fallbackSolver: PortableScenarioSolverSettings = {
        schema_version: 1,
        use_spatial_bathymetry: true,
        bathymetry_asset_id: null,
        cells_per_degree: 8,
        resolution_mode: "advanced",
        duration_s: 3600,
        frame_count: 60,
        include_lamb_wave: false,
        boundary_mode: "sponge",
        checkpoint_interval_s: 60,
      };
      const solverSettings = portableContext?.solverSettings ?? fallbackSolver;
      const source = data.source.location;
      const workspace = portableContext?.workspace ?? {
        layers: [],
        camera: {
          lat: source.lat_deg,
          lon: source.lon_deg,
          altitude_m: 2_000_000,
          heading_deg: 0,
          pitch_deg: -55,
        },
      };
      const checkpoints = portableContext?.checkpoints ?? (isTauri()
        ? await api.listSolverCheckpoints().catch(() => undefined)
        : undefined);
      const bytes = await createPortableScenarioPackage({
        scenario: payload.payload,
        settings: exportedSettings,
        solverSettings,
        workspace,
        citations: portableContext?.citations ?? [],
        provenance: portableContext?.provenance ?? {
          app_version: APP_VERSION,
          exported_from: "scenario_builder",
          note: "No completed run was attached to this scenario input.",
        },
        results: includePortableResults ? portableContext?.results : undefined,
        checkpoints,
        dataReferences: portableContext?.dataReferences ?? [],
      });
      const result = downloadBlob(new Blob([Uint8Array.from(bytes)], { type: "application/zip" }), portableFileName(data.kind));
      if (!result.ok) throw new Error(result.message);
      showStatus(t("builder.packageExported"), "success");
    } catch (error) {
      showStatus(t("builder.packageExportFailed", { error: error instanceof Error ? error.message : String(error) }), "error");
    } finally {
      setPortableBusy(false);
    }
  }

  async function previewPortableScenario(file: File | undefined) {
    if (!file) return;
    setPortableBusy(true);
    setPortablePreview(null);
    try {
      if (file.size <= 0 || file.size > PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES) {
        throw new Error(t("builder.packageSize", { size: formatNumber(PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES / (1024 * 1024)) }));
      }
      setPortablePreview(await inspectPortableScenarioPackage(await file.arrayBuffer()));
    } catch (error) {
      showStatus(t("builder.packageRejected", { error: error instanceof Error ? error.message : String(error) }), "error");
    } finally {
      setPortableBusy(false);
      if (portableInputRef.current) portableInputRef.current.value = "";
    }
  }

  async function importPortableScenario() {
    if (!portablePreview) return;
    setPortableBusy(true);
    try {
      await settings.importSettings(JSON.stringify(portablePreview.settings));
      await onImportPortableContext?.(portablePreview);
      applyScenario(portablePreview.scenario);
      onSimulate(portablePreview.scenario);
      const copyName = t("builder.packageImportedName", {
        kind: t(SOURCE_LABELS[portablePreview.scenario.kind]),
        date: new Date().toLocaleString(languageTag),
      });
      await settings.saveScenario(copyName, portablePreview.scenarioPayload);
      loadSavedScenarios();
      setPortablePreview(null);
      showStatus(t("builder.packageImported", {
        migrations: formatNumber(portablePreview.packageMigrations.length + portablePreview.scenarioMigrations.length),
      }), "success");
    } catch (error) {
      showStatus(t("builder.packageImportFailed", { error: error instanceof Error ? error.message : String(error) }), "error");
    } finally {
      setPortableBusy(false);
    }
  }

  return (
    <div className="section scenario-builder">
      <div className="section__title">{t("builder.title")}</div>
      <div className="scenario-tabs" role="tablist" aria-label={t("builder.sourceType")}>
        {TABS.map((tabOption) => (
          <button
            id={`scenario-tab-${tabOption.key}`}
            key={tabOption.key}
            className="scenario-tab"
            role="tab"
            type="button"
            aria-selected={tab === tabOption.key}
            aria-controls="scenario-panel"
            tabIndex={tab === tabOption.key ? 0 : -1}
            data-active={tab === tabOption.key ? "true" : "false"}
            data-tab={tabOption.key}
            onClick={() => setTab(tabOption.key)}
            onKeyDown={(event) => {
              const currentIndex = TABS.findIndex((item) => item.key === tabOption.key);
              let nextIndex: number | null = null;
              if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
              if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
              if (event.key === "Home") nextIndex = 0;
              if (event.key === "End") nextIndex = TABS.length - 1;
              if (nextIndex === null) return;
              event.preventDefault();
              const next = TABS[nextIndex].key;
              setTab(next);
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
                ?.focus();
            }}
          >
            {t(tabOption.labelKey)}
          </button>
        ))}
      </div>
      <div id="scenario-panel" role="tabpanel" aria-labelledby={`scenario-tab-${tab}`}>
      <p className="scenario-summary">
        {tab === "earthquake" ? (
          <>{t("builder.description.earthquakePrefix")} <GlossaryTip term="okada">Okada</GlossaryTip>{t("builder.description.earthquakeSuffix")}</>
        ) : (
          t(TAB_DESCRIPTIONS[tab])
        )}
      </p>

      <form
        className="scenario-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {tab === "asteroid" && (
          <>
            <NumField field="diameter_m" label={t("builder.field.diameter")} value={asteroid.diameter_m}
              onChange={(v) => setAsteroid({ ...asteroid, diameter_m: v })} />
            <NumField field="density_kg_m3" label={t("builder.field.density")} value={asteroid.density_kg_m3}
              onChange={(v) => setAsteroid({ ...asteroid, density_kg_m3: v })} />
            <NumField field="velocity_m_s" label={t("builder.field.velocity")} value={asteroid.velocity_m_s}
              onChange={(v) => setAsteroid({ ...asteroid, velocity_m_s: v })} />
            <NumField field="angle_deg" label={t("builder.field.angle")} value={asteroid.angle_deg}
              onChange={(v) => setAsteroid({ ...asteroid, angle_deg: v })} />
          </>
        )}
        {tab === "nuclear" && (
          <>
            <NumField field="yield_kt" label={t("builder.field.yield")} value={nuclear.yield_kt}
              onChange={(v) => setNuclear({ ...nuclear, yield_kt: v })} />
            <label>
              <span>{t("builder.burstGeometry")}</span>
              <select
                value={nuclear.burst_mode}
                onChange={(e) =>
                  setNuclear({ ...nuclear, burst_mode: e.target.value as NuclearBurstInput["burst_mode"] })
                }
              >
                {burstModes.map((value) => (
                  <option key={value} value={value}>{t(value === "Shallow" ? "builder.burst.shallow" : value === "DeepOptimal" ? "builder.burst.deep" : value === "Abyssal" ? "builder.burst.abyssal" : "builder.burst.surface")}</option>
                ))}
              </select>
            </label>
            <NumField field="burst_depth_m" label={t("builder.field.burstDepth")} value={nuclear.burst_depth_m}
              onChange={(v) => setNuclear({ ...nuclear, burst_depth_m: v })} />
          </>
        )}
        {tab === "earthquake" && (
          <>
            {importProvenance && (
              <div className="scenario-form__import-provenance" role="status">
                <strong>{t("builder.historicalImport")}</strong>
                <p>{importProvenance}</p>
              </div>
            )}
            <NumField field="mw" label={t("builder.field.magnitude")} value={earthquake.mw} step={0.1}
              onChange={(v) => setEarthquake({ ...earthquake, mw: v })} />
            <NumField field="depth_m" label={t("builder.field.hypocentreDepth")} value={earthquake.depth_m}
              onChange={(v) => setEarthquake({ ...earthquake, depth_m: v })} />
            <NumField field="strike_deg" label={t("builder.field.strike")} value={earthquake.strike_deg}
              onChange={(v) => setEarthquake({ ...earthquake, strike_deg: v })} />
            <NumField field="dip_deg" label={t("builder.field.dip")} value={earthquake.dip_deg}
              onChange={(v) => setEarthquake({ ...earthquake, dip_deg: v })} />
            <NumField field="rake_deg" label={t("builder.field.rake")} value={earthquake.rake_deg}
              onChange={(v) => setEarthquake({ ...earthquake, rake_deg: v })} />
            <NumField field="slip_m" label={t("builder.field.slip")} value={earthquake.slip_m}
              onChange={(v) => setEarthquake({ ...earthquake, slip_m: v })} />
            <NumField field="fault_length_m" label={t("builder.field.faultLength")} value={earthquake.fault_length_m ?? 0}
              onChange={(v) => setEarthquake({ ...earthquake, fault_length_m: v })} />
            <NumField field="fault_width_m" label={t("builder.field.faultWidth")} value={earthquake.fault_width_m ?? 0}
              onChange={(v) => setEarthquake({ ...earthquake, fault_width_m: v })} />
            <div className="scenario-form__autofault">
              <button type="button" onClick={autoFillFaultFromZone} title={t("builder.autoFillTitle")}>
                <UiIcon name="mapPin" size={14} />
                {t("builder.autoFill")}
              </button>
              {subductionNote && (
                <p
                  className="scenario-form__autofault-note"
                  data-tone={subductionNote.tone}
                  role={subductionNote.tone === "error" ? "alert" : "status"}
                  aria-live={subductionNote.tone === "error" ? "assertive" : "polite"}
                >
                  {subductionNote.text}
                </p>
              )}
            </div>
          </>
        )}
        {tab === "landslide" && (
          <>
            <label>
              <span>{t("builder.type")}</span>
              <select
                value={landslide.kind}
                onChange={(e) =>
                  setLandslide({ ...landslide, kind: e.target.value as LandslideInput["kind"] })
                }
              >
                {landslideKinds.map((value) => (
                  <option key={value} value={value}>{t(value === "Subaerial" ? "builder.landslide.subaerial" : "builder.landslide.submarine")}</option>
                ))}
              </select>
            </label>
            <NumField field="volume_m3" label={t("builder.field.volume")} value={landslide.volume_m3}
              onChange={(v) => setLandslide({ ...landslide, volume_m3: v })} />
            <NumField field="density_kg_m3" label={t("builder.field.density")} value={landslide.density_kg_m3}
              onChange={(v) => setLandslide({ ...landslide, density_kg_m3: v })} />
            <NumField field="drop_height_m" label={t("builder.field.dropHeight")} value={landslide.drop_height_m}
              onChange={(v) => setLandslide({ ...landslide, drop_height_m: v })} />
            <NumField field="slope_deg" label={t("builder.field.slope")} value={landslide.slope_deg}
              onChange={(v) => setLandslide({ ...landslide, slope_deg: v })} />
            <NumField field="water_body_width_m" label={t("builder.field.waterBodyWidth")} value={landslide.water_body_width_m}
              onChange={(v) => setLandslide({ ...landslide, water_body_width_m: v })} />
          </>
        )}
        {tab === "meteotsunami" && (
          <>
            <div className="scenario-form__import-provenance" role="note">
              <strong>{t("builder.timeDependent")}</strong>
              <p>{t("builder.timeDependentBody")}</p>
            </div>
            <NumField field="peak_pressure_pa" label={t("builder.field.peakPressure")} value={meteotsunami.peak_pressure_pa}
              onChange={(v) => setMeteotsunami({ ...meteotsunami, peak_pressure_pa: v })} />
            <NumField field="speed_m_s" label={t("builder.field.speed")} value={meteotsunami.speed_m_s} step={0.1}
              onChange={(v) => setMeteotsunami({ ...meteotsunami, speed_m_s: v })} />
            <NumField field="heading_deg" label={t("builder.field.heading")} value={meteotsunami.heading_deg} step={1}
              onChange={(v) => setMeteotsunami({ ...meteotsunami, heading_deg: v })} />
            <NumField field="along_track_sigma_m" label={t("builder.field.alongTrack")} value={meteotsunami.along_track_sigma_m}
              onChange={(v) => setMeteotsunami({ ...meteotsunami, along_track_sigma_m: v })} />
            <NumField field="cross_track_sigma_m" label={t("builder.field.crossTrack")} value={meteotsunami.cross_track_sigma_m}
              onChange={(v) => setMeteotsunami({ ...meteotsunami, cross_track_sigma_m: v })} />
            <NumField field="track_length_m" label={t("builder.field.trackLength")} value={meteotsunami.track_length_m}
              onChange={(v) => setMeteotsunami({ ...meteotsunami, track_length_m: v })} />
            <ProudmanResonanceIndicator speed={meteotsunami.speed_m_s} depth={meteotsunami.water_depth_m} />
          </>
        )}

        <NumField field="lat_deg" label={t("builder.field.latitude")}
          value={currentLat({ tab, asteroid, nuclear, earthquake, landslide, meteotsunami })}
          onChange={(v) =>
            applyLocation(v, "lat", { tab, asteroid, setAsteroid, nuclear, setNuclear, earthquake, setEarthquake, landslide, setLandslide, meteotsunami, setMeteotsunami })
          } />
        <NumField field="lon_deg" label={t("builder.field.longitude")}
          value={currentLon({ tab, asteroid, nuclear, earthquake, landslide, meteotsunami })}
          onChange={(v) =>
            applyLocation(v, "lon", { tab, asteroid, setAsteroid, nuclear, setNuclear, earthquake, setEarthquake, landslide, setLandslide, meteotsunami, setMeteotsunami })
          } />
        <NumField field="water_depth_m" label={t("builder.field.waterDepth")}
          bounds={sourceBound(tab === "asteroid" ? "Asteroid" : tab === "nuclear" ? "Nuclear" : tab === "earthquake" ? "Earthquake" : tab === "landslide" ? "Landslide" : "Meteotsunami", "water_depth_m")}
          value={currentDepth({ tab, asteroid, nuclear, earthquake, landslide, meteotsunami })}
          onChange={(v) =>
            applyDepth(v, { tab, asteroid, setAsteroid, nuclear, setNuclear, earthquake, setEarthquake, landslide, setLandslide, meteotsunami, setMeteotsunami })
          } />

        <div className="scenario-form__actions">
          <button
            className="scenario-pick"
            data-active={pickActive ? "true" : "false"}
            aria-pressed={pickActive}
            onClick={onTogglePick}
            type="button"
          >
            <UiIcon name="mapPin" size={14} />
            {pickActive ? t("builder.picking") : t("builder.pickOnGlobe")}
          </button>
          <button className="primary" type="submit">
            {t("builder.simulate")}
          </button>
        </div>
        <div className="scenario-actions__row">
          <button onClick={saveCurrentScenario} type="button" title={t("builder.saveTitle")}>
            <UiIcon name="save" size={14} />
            {t("builder.save")}
          </button>
          <button onClick={() => setShowSaved((v) => !v)} type="button" title={t("builder.loadTitle")}>
            <UiIcon name="folder" size={14} />
            {t("builder.load")}{savedScenarios.length > 0 ? ` (${formatNumber(savedScenarios.length)})` : ""}
          </button>
          <button onClick={copyScenario} type="button" title={t("builder.copyTitle")}>
            <UiIcon name="copy" size={14} />
            {t("builder.copy")}
          </button>
          <button onClick={pasteScenario} type="button" title={t("builder.pasteTitle")}>
            <UiIcon name="clipboard" size={14} />
            {t("builder.paste")}
          </button>
          <button onClick={() => void exportPortableScenario()} type="button" disabled={portableBusy} title={t("builder.packageExportTitle")}>
            <UiIcon name="download" size={14} />
            {t("builder.packageExport")}
          </button>
          <button onClick={() => portableInputRef.current?.click()} type="button" disabled={portableBusy} title={t("builder.packageImportTitle")}>
            <UiIcon name="folder" size={14} />
            {t("builder.packageImport")}
          </button>
          <input
            ref={portableInputRef}
            className="scenario-actions__file"
            type="file"
            accept={`${PORTABLE_SCENARIO_EXTENSION},application/zip`}
            aria-label={t("builder.packageFile")}
            onChange={(event) => void previewPortableScenario(event.target.files?.[0])}
          />
          {clipMsg && (
            <span
              className="scenario-actions__clip"
              data-tone={clipMsg.tone}
              role={clipMsg.tone === "error" ? "alert" : "status"}
              aria-live={clipMsg.tone === "error" ? "assertive" : "polite"}
            >
              {clipMsg.text}
              {clipMsg.action && (
                <button
                  className="scenario-actions__status-action"
                  onClick={clipMsg.action.run}
                  type="button"
                >
                  {clipMsg.action.label}
                </button>
              )}
            </span>
          )}
        </div>
        {portableContext?.results !== undefined && (
          <label className="scenario-package__results">
            <input
              type="checkbox"
              checked={includePortableResults}
              disabled={portableBusy}
              onChange={(event) => setIncludePortableResults(event.target.checked)}
            />
            <span>{t("builder.packageIncludeResults")}</span>
          </label>
        )}
        {portablePreview && (
          <section className="scenario-package__preview" aria-label={t("builder.packagePreview")}>
            <div>
              <strong>{t("builder.packageReady", { kind: t(SOURCE_LABELS[portablePreview.scenario.kind]) })}</strong>
              <span>{t("builder.packageSummary", {
                version: formatNumber(portablePreview.manifest.schema_version),
                entries: formatNumber(portablePreview.manifest.entries.length),
                data: formatNumber(portablePreview.dataReferences.length),
              })}</span>
            </div>
            <p>{t("builder.packageSafety")}</p>
            {(portablePreview.packageMigrations.length > 0 || portablePreview.scenarioMigrations.length > 0) && (
              <p>{t("builder.packageMigrations", {
                count: formatNumber(portablePreview.packageMigrations.length + portablePreview.scenarioMigrations.length),
              })}</p>
            )}
            {portablePreview.warnings.length > 0 && (
              <ul>{portablePreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            )}
            <div className="scenario-package__preview-actions">
              <button type="button" className="primary" disabled={portableBusy} onClick={() => void importPortableScenario()}>
                {t("builder.packageImportCopy")}
              </button>
              <button type="button" disabled={portableBusy} onClick={() => setPortablePreview(null)}>
                {t("builder.packageCancel")}
              </button>
            </div>
          </section>
        )}
        {showSaved && savedScenariosResult.status === "loading" && !savedScenariosResult.previous && (
          <div className="empty-state empty-state--compact scenario-saved__empty" role="status">
            <span className="empty-state__icon" aria-hidden />
             <div><strong>{t("builder.loadingSaved")}</strong><p>{t("builder.readingLibrary")}</p></div>
          </div>
        )}
        {showSaved && (savedScenariosResult.status === "error" || savedScenariosResult.status === "stale") && (
          <div className="panel-error" role="alert">
            <span>{t(savedScenariosResult.status === "stale" ? "builder.savedListStale" : "builder.savedLoadFailed", { error: savedScenariosResult.error })}</span>
            <button type="button" onClick={loadSavedScenarios}>{t("builder.retrySaved")}</button>
          </div>
        )}
        {showSaved && savedScenarios.length > 0 && (
          <div className="scenario-saved">
            {savedScenarios.map((s) => (
              <div key={s.id} className="scenario-saved__item">
                <button
                  className="scenario-saved__load"
                  onClick={() => loadScenario(s)}
                  type="button"
                >
                  {s.name}
                </button>
                <button
                  className="scenario-saved__del"
                  onClick={() => deleteScenario(s.id)}
                  type="button"
                  aria-label={t("builder.delete", { name: s.name })}
                >
                  <UiIcon name="trash" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        {showSaved && savedScenariosResult.status === "empty" && (
          <div className="empty-state empty-state--compact scenario-saved__empty">
            <span className="empty-state__icon" aria-hidden />
            <div>
              <strong>{t("builder.noSaved")}</strong>
              <p>{t("builder.noSavedBody")}</p>
            </div>
          </div>
        )}
      </form>
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
  meteotsunami: MeteotsunamiInput;
};
type SetBundle = Bundle & {
  setAsteroid: (s: AsteroidImpactInput) => void;
  setNuclear: (s: NuclearBurstInput) => void;
  setEarthquake: (s: EarthquakeInput) => void;
  setLandslide: (s: LandslideInput) => void;
  setMeteotsunami: (s: MeteotsunamiInput) => void;
};

const GRAVITY_MS2 = 9.81;

function ProudmanResonanceIndicator({ speed, depth }: { speed: number; depth: number }) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  if (!Number.isFinite(speed) || !Number.isFinite(depth) || depth <= 0 || speed <= 0) return null;
  const shallowWaveSpeed = Math.sqrt(GRAVITY_MS2 * depth);
  const ratio = speed / shallowWaveSpeed;
  const tone = Math.abs(ratio - 1) < 0.15 ? "success" : ratio < 0.7 ? "muted" : "warning";
  const label = ratio < 0.85
    ? t("builder.resonance.sub")
    : ratio <= 1.15
      ? t("builder.resonance.resonant")
      : t("builder.resonance.super");
  return (
    <div className="scenario-form__resonance" role="status" aria-live="polite" aria-atomic="true">
      <span className="resonance__label">{t("builder.resonance.heading")}</span>
      <span className="resonance__value" data-tone={tone}>
        U/√(gh) = {formatNumber(ratio, { maximumFractionDigits: 2 })} — {label}
      </span>
      <span className="resonance__hint">{t("builder.resonance.hint", { waveSpeed: quantityText(formatSpeed(shallowWaveSpeed, formatNumber, unitSystem)) })}</span>
    </div>
  );
}

function currentLat(b: Bundle): number {
  return b.tab === "asteroid" ? b.asteroid.location.lat_deg
       : b.tab === "nuclear" ? b.nuclear.location.lat_deg
       : b.tab === "earthquake" ? b.earthquake.location.lat_deg
       : b.tab === "landslide" ? b.landslide.location.lat_deg
       : b.meteotsunami.location.lat_deg;
}
function currentLon(b: Bundle): number {
  return b.tab === "asteroid" ? b.asteroid.location.lon_deg
       : b.tab === "nuclear" ? b.nuclear.location.lon_deg
       : b.tab === "earthquake" ? b.earthquake.location.lon_deg
       : b.tab === "landslide" ? b.landslide.location.lon_deg
       : b.meteotsunami.location.lon_deg;
}
function currentDepth(b: Bundle): number {
  return b.tab === "asteroid" ? b.asteroid.water_depth_m
       : b.tab === "nuclear" ? b.nuclear.water_depth_m
       : b.tab === "earthquake" ? b.earthquake.water_depth_m
       : b.tab === "landslide" ? b.landslide.water_depth_m
       : b.meteotsunami.water_depth_m;
}
function applyLocation(v: number, axis: "lat" | "lon", b: SetBundle) {
  const key = axis === "lat" ? "lat_deg" : "lon_deg";
  if (b.tab === "asteroid") b.setAsteroid({ ...b.asteroid, location: { ...b.asteroid.location, [key]: v } });
  else if (b.tab === "nuclear") b.setNuclear({ ...b.nuclear, location: { ...b.nuclear.location, [key]: v } });
  else if (b.tab === "earthquake") b.setEarthquake({ ...b.earthquake, location: { ...b.earthquake.location, [key]: v } });
  else if (b.tab === "landslide") b.setLandslide({ ...b.landslide, location: { ...b.landslide.location, [key]: v } });
  else b.setMeteotsunami({ ...b.meteotsunami, location: { ...b.meteotsunami.location, [key]: v } });
}
function applyDepth(v: number, b: SetBundle) {
  if (b.tab === "asteroid") b.setAsteroid({ ...b.asteroid, water_depth_m: v, location: { ...b.asteroid.location, depth_m: v } });
  else if (b.tab === "nuclear") b.setNuclear({ ...b.nuclear, water_depth_m: v, location: { ...b.nuclear.location, depth_m: v } });
  else if (b.tab === "earthquake") b.setEarthquake({ ...b.earthquake, water_depth_m: v, location: { ...b.earthquake.location, depth_m: v } });
  else if (b.tab === "landslide") b.setLandslide({ ...b.landslide, water_depth_m: v, location: { ...b.landslide.location, depth_m: v } });
  else b.setMeteotsunami({ ...b.meteotsunami, water_depth_m: v, location: { ...b.meteotsunami.location, depth_m: v } });
}
