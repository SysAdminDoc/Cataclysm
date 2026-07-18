/**
 * Persistent app settings, stored via tauri-plugin-store under
 * `app_data_dir/settings.json`. In browser-preview mode we fall back to
 * `localStorage` so the same API works in `npm run dev`. Sensitive
 * desktop values such as `cesium_token` are not mirrored into WebView
 * storage.
 */

import { api, isTauri } from "./tauri";
import { DEFAULT_STYLE, type GlobeStyleId } from "./globe-styles";
import { isGlobeStyleId } from "./earth-assets";
import { parseScenarioPayload } from "./scenario-schema";
import type { RendererQualityTier } from "../rendering/quality-profiles";
import { isLocale, type Locale } from "./i18n-core";

export type Theme = "mocha" | "latte";

export type ColormapId = "diverging" | "cividis" | "viridis";
export type LessonCompletions = Record<string, string>;
export type LaunchExperiencePolicy = "first" | "always" | "never";
export type WorkspaceMode = "simple" | "customize" | "advanced";

export type Settings = {
  cesium_token: string;
  theme: Theme;
  locale: Locale;
  globe_style: GlobeStyleId;
  colormap: ColormapId;
  renderer_quality: RendererQualityTier;
  renderer_auto_quality: boolean;
  workspace_mode: WorkspaceMode;
  launch_experience_policy: LaunchExperiencePolicy;
  launch_experience_seen_at: string | null;
  disclaimer_acknowledged_at: string | null;
  tour_completed_at: string | null;
  lessons_completed: LessonCompletions;
  /** First-run dismissible banner suggesting the user paste a Cesium
   *  ion token for satellite imagery. Set when the user clicks
   *  Dismiss; absent / null means the banner should show. */
  token_banner_dismissed_at: string | null;
  /** Classroom profile lock (soft): imported teacher profiles set this to
   *  pin the visual configuration and hide token entry. Deliberately not a
   *  security boundary — Settings shows an explicit Unlock action. */
  classroom_locked: boolean;
};

export const SETTINGS_SCHEMA_VERSION = 5;
const SCHEMA_VERSION_KEY = "_settings_schema_version";

const DEFAULTS: Settings = {
  cesium_token: "",
  theme: "mocha",
  locale: "en",
  globe_style: DEFAULT_STYLE,
  colormap: "diverging",
  renderer_quality: "High",
  renderer_auto_quality: true,
  workspace_mode: "simple",
  launch_experience_policy: "first",
  launch_experience_seen_at: null,
  disclaimer_acknowledged_at: null,
  tour_completed_at: null,
  lessons_completed: {},
  token_banner_dismissed_at: null,
  classroom_locked: false,
};

const SETTINGS_KEY_LIST: readonly (keyof Settings)[] = [
  "cesium_token",
  "theme",
  "locale",
  "globe_style",
  "colormap",
  "renderer_quality",
  "renderer_auto_quality",
  "workspace_mode",
  "launch_experience_policy",
  "launch_experience_seen_at",
  "disclaimer_acknowledged_at",
  "tour_completed_at",
  "lessons_completed",
  "token_banner_dismissed_at",
  "classroom_locked",
];
const SETTINGS_KEYS: ReadonlySet<string> = new Set<keyof Settings>(SETTINGS_KEY_LIST);
const VISUAL_SETTINGS_KEYS: readonly (keyof Settings)[] = [
  "theme",
  "locale",
  "globe_style",
  "colormap",
  "renderer_quality",
  "renderer_auto_quality",
];

const STORE_FILE = "settings.json";
const LS_PREFIX = "tsunamisim.";
const SENSITIVE_KEYS = new Set<keyof Settings>(["cesium_token"]);
type LazyStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
  delete?(key: string): Promise<boolean | void>;
};

export type SettingsRollbackStatus = "complete" | "failed";

export class SettingsTransactionError extends Error {
  readonly rollbackStatus: SettingsRollbackStatus;

  constructor(operation: string, cause: unknown, rollbackErrors: readonly unknown[]) {
    const rollbackStatus: SettingsRollbackStatus = rollbackErrors.length === 0 ? "complete" : "failed";
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    const rollbackMessage = rollbackStatus === "complete"
      ? "All persisted values were restored."
      : `Rollback failed in ${rollbackErrors.length} storage operation${rollbackErrors.length === 1 ? "" : "s"}; restart Cataclysm before retrying.`;
    super(`${operation} failed: ${causeMessage} ${rollbackMessage}`, { cause });
    this.name = "SettingsTransactionError";
    this.rollbackStatus = rollbackStatus;
  }
}

let storePromise: Promise<LazyStore | null> | null = null;
function getStore(): Promise<LazyStore | null> {
  if (!isTauri()) return Promise.resolve(null);
  if (!storePromise) {
    storePromise = import("@tauri-apps/plugin-store")
      .then(async ({ load }) => {
        try {
          const store = (await load(STORE_FILE, { defaults: DEFAULTS, autoSave: false })) as LazyStore;
          await store.get("theme");
          await migrateStore(store);
          return store;
        } catch (err) {
          console.warn("[settings] tauri-plugin-store probe failed; falling back to localStorage.", err);
          return null;
        }
      })
      .catch((err) => {
        console.warn("[settings] tauri-plugin-store import failed; falling back to localStorage.", err);
        return null;
      });
  }
  return storePromise;
}

async function migrateStore(store: LazyStore): Promise<void> {
  try {
    const version = await store.get<number>(SCHEMA_VERSION_KEY);
    if (version === SETTINGS_SCHEMA_VERSION) return;

    if (version === undefined || version === null) {
      console.info(
        `[settings] legacy unversioned store detected; stamping schema version ${SETTINGS_SCHEMA_VERSION}`,
      );
    } else if (typeof version === "number" && version > SETTINGS_SCHEMA_VERSION) {
      console.warn(
        `[settings] store version ${version} is newer than supported ${SETTINGS_SCHEMA_VERSION}; ` +
          "unrecognised keys will be preserved, unknown values fall back to defaults",
      );
      return;
    }

    await store.set(SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
    await store.save();
  } catch (err) {
    console.warn("[settings] schema migration failed", err);
  }
}

function migrateLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const versionRaw = localStorage.getItem(LS_PREFIX + SCHEMA_VERSION_KEY);
    const version = versionRaw !== null ? JSON.parse(versionRaw) : null;
    if (version === SETTINGS_SCHEMA_VERSION) return;

    if (version === null) {
      console.info(
        `[settings] legacy unversioned localStorage detected; stamping schema version ${SETTINGS_SCHEMA_VERSION}`,
      );
    } else if (typeof version === "number" && version > SETTINGS_SCHEMA_VERSION) {
      console.warn(
        `[settings] localStorage version ${version} is newer than supported ${SETTINGS_SCHEMA_VERSION}; ` +
          "unknown values fall back to defaults",
      );
      return;
    }

    localStorage.setItem(
      LS_PREFIX + SCHEMA_VERSION_KEY,
      JSON.stringify(SETTINGS_SCHEMA_VERSION),
    );
  } catch {
    /* quota / private mode */
  }
}

function removeLocalMirror(key: keyof Settings): void {
  if (typeof localStorage === "undefined") return;
  try {
    removeLocalMirrorStrict(key);
  } catch {
    /* ignore */
  }
}

function removeLocalMirrorStrict(key: keyof Settings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LS_PREFIX + key);
}

function shouldMirrorToLocalStorage(key: keyof Settings): boolean {
  // Browser preview has no Tauri store, so localStorage is its only
  // persistence layer. In the desktop app, do not mirror sensitive values
  // into WebView storage where they are easier to inspect or leak.
  return !isTauri() || !SENSITIVE_KEYS.has(key);
}

function normaliseLessonCompletions(value: unknown): LessonCompletions | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result: LessonCompletions = {};
  for (const [lessonId, completedAt] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof lessonId === "string" &&
      lessonId.trim() &&
      typeof completedAt === "string" &&
      completedAt.trim()
    ) {
      result[lessonId] = completedAt;
    }
  }
  return result;
}

function normaliseSetting<K extends keyof Settings>(key: K, value: unknown): Settings[K] | undefined {
  if (!SETTINGS_KEYS.has(key)) {
    console.warn(`[settings] unknown key "${String(key)}" — ignoring, falling back to default`);
    return undefined;
  }
  let result: Settings[K] | undefined;
  switch (key) {
    case "cesium_token":
      result = (typeof value === "string" ? value : undefined) as Settings[K] | undefined;
      break;
    case "theme":
      result = (value === "mocha" || value === "latte" ? value : undefined) as Settings[K] | undefined;
      break;
    case "locale":
      result = (isLocale(value) ? value : undefined) as Settings[K] | undefined;
      break;
    case "globe_style":
      result = (isGlobeStyleId(value)
        ? value
        : undefined) as Settings[K] | undefined;
      break;
    case "colormap":
      result = (value === "diverging" || value === "cividis" || value === "viridis" ? value : undefined) as Settings[K] | undefined;
      break;
    case "renderer_quality":
      result = (
        value === "Low" || value === "Medium" || value === "High" || value === "Cinematic"
          ? value
          : undefined
      ) as Settings[K] | undefined;
      break;
    case "workspace_mode":
      result = (value === "simple" || value === "customize" || value === "advanced"
        ? value
        : undefined) as Settings[K] | undefined;
      break;
    case "launch_experience_policy":
      result = (value === "first" || value === "always" || value === "never"
        ? value
        : undefined) as Settings[K] | undefined;
      break;
    case "launch_experience_seen_at":
    case "disclaimer_acknowledged_at":
    case "tour_completed_at":
    case "token_banner_dismissed_at":
      result = (typeof value === "string" || value === null ? value : undefined) as Settings[K] | undefined;
      break;
    case "lessons_completed":
      result = normaliseLessonCompletions(value) as Settings[K] | undefined;
      break;
    case "classroom_locked":
    case "renderer_auto_quality":
      result = (typeof value === "boolean" ? value : undefined) as Settings[K] | undefined;
      break;
    default:
      result = undefined;
  }
  if (result === undefined && value !== undefined && value !== null) {
    console.warn(
      `[settings] "${String(key)}" has unrecognised value ${JSON.stringify(value)} — falling back to default`,
    );
  }
  return result;
}

function readLocalMirror<K extends keyof Settings>(key: K): Settings[K] | undefined {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_PREFIX + key) : null;
  if (raw === null) return undefined;
  try {
    const normalised = normaliseSetting(key, JSON.parse(raw));
    if (normalised === undefined) removeLocalMirror(key);
    return normalised;
  } catch {
    removeLocalMirror(key);
    return undefined;
  }
}

/** Desktop-only: the ion token lives in the OS keychain (Windows
 *  Credential Manager / macOS Keychain / Linux Secret Service), never in
 *  settings.json. Legacy plugin-store copies are migrated in on first read
 *  and blanked. Keychain failures fail closed so a plaintext legacy token is
 *  never treated as successfully migrated. */
async function readTokenFromKeychain(): Promise<string | undefined> {
  try {
    const token = await api.keychainGetToken();
    return token ?? undefined;
  } catch (err) {
    throw new Error("The operating-system keychain could not be read; the token was not loaded.", { cause: err });
  }
}

async function writeTokenToKeychain(token: string): Promise<void> {
  try {
    await api.keychainSetToken(token);
  } catch (err) {
    throw new Error("The operating-system keychain is unavailable; the token was not stored.", { cause: err });
  }
}

async function blankStoreToken(existingStore?: LazyStore | null): Promise<void> {
  const store = existingStore === undefined ? await getStore() : existingStore;
  if (!store) return;
  await store.set("cesium_token", "");
  await store.save();
}

type PersistenceSnapshot = {
  keys: readonly string[];
  localValues: Map<string, string | null> | null;
  store: LazyStore | null;
  storeValues: Map<string, unknown>;
  keychainIncluded: boolean;
  keychainToken?: string;
};

async function snapshotPersistence(
  keys: readonly (keyof Settings)[],
  includeSchemaVersion = false,
): Promise<PersistenceSnapshot> {
  migrateLocalStorage();
  const persistedKeys = Array.from(new Set<string>([
    ...keys,
    ...(includeSchemaVersion ? [SCHEMA_VERSION_KEY] : []),
  ]));
  const localValues = typeof localStorage === "undefined"
    ? null
    : new Map(persistedKeys.map((key) => [key, localStorage.getItem(LS_PREFIX + key)]));
  const store = await getStore();
  const storeValues = new Map<string, unknown>();
  if (store) {
    for (const key of persistedKeys) storeValues.set(key, await store.get(key));
  }
  const keychainIncluded = isTauri() && keys.includes("cesium_token");
  const keychainToken = keychainIncluded
    ? await readTokenFromKeychain()
    : undefined;
  return { keys: persistedKeys, localValues, store, storeValues, keychainIncluded, keychainToken };
}

async function restorePersistence(snapshot: PersistenceSnapshot): Promise<unknown[]> {
  const errors: unknown[] = [];

  if (snapshot.localValues && typeof localStorage !== "undefined") {
    for (const [key, value] of snapshot.localValues) {
      try {
        if (value === null) localStorage.removeItem(LS_PREFIX + key);
        else localStorage.setItem(LS_PREFIX + key, value);
      } catch (err) {
        errors.push(err);
      }
    }
  }

  if (snapshot.store) {
    for (const [key, value] of snapshot.storeValues) {
      try {
        if (value === undefined) {
          if (typeof snapshot.store.delete !== "function") {
            throw new Error(`Desktop settings store cannot restore absent key ${key}.`);
          }
          await snapshot.store.delete(key);
        } else {
          await snapshot.store.set(key, value);
        }
      } catch (err) {
        errors.push(err);
      }
    }
    try {
      await snapshot.store.save();
    } catch (err) {
      errors.push(err);
    }
  }

  if (snapshot.keychainIncluded) {
    try {
      await writeTokenToKeychain(snapshot.keychainToken ?? "");
    } catch (err) {
      errors.push(err);
    }
  }
  return errors;
}

async function runSettingsTransaction(
  operation: string,
  keys: readonly (keyof Settings)[],
  mutation: (snapshot: PersistenceSnapshot) => Promise<void>,
  includeSchemaVersion = false,
): Promise<void> {
  if (keys.length === 0) return;
  const snapshot = await snapshotPersistence(keys, includeSchemaVersion);
  try {
    await mutation(snapshot);
  } catch (err) {
    const rollbackErrors = await restorePersistence(snapshot);
    throw new SettingsTransactionError(operation, err, rollbackErrors);
  }
}

async function clearSettingAtomically<K extends keyof Settings>(
  operation: string,
  key: K,
): Promise<void> {
  await runSettingsTransaction(operation, [key], async (snapshot) => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(LS_PREFIX + key);
    }
    if (snapshot.store) {
      if (typeof snapshot.store.delete === "function") await snapshot.store.delete(key);
      else await snapshot.store.set(key, DEFAULTS[key]);
      await snapshot.store.save();
    }
  });
}

async function read<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  migrateLocalStorage();
  if (isTauri() && key === "cesium_token") {
    const fromKeychain = await readTokenFromKeychain();
    if (fromKeychain !== undefined && fromKeychain !== "") {
      return fromKeychain as Settings[K];
    }
    // One-time migration: older builds kept the token in plugin-store.
    const legacyStore = await getStore();
    if (legacyStore) {
      const legacy = await legacyStore.get<string>("cesium_token");
      if (typeof legacy === "string" && legacy !== "") {
        await runSettingsTransaction(
          "Legacy token migration",
          ["cesium_token"],
          async () => {
            await writeTokenToKeychain(legacy);
            await blankStoreToken(legacyStore);
            removeLocalMirrorStrict("cesium_token");
          },
        );
        return legacy as Settings[K];
      }
    }
    const legacyMirror = readLocalMirror("cesium_token");
    if (typeof legacyMirror === "string" && legacyMirror !== "") {
      await runSettingsTransaction(
        "Legacy token migration",
        ["cesium_token"],
        async () => {
          await writeTokenToKeychain(legacyMirror);
          await blankStoreToken(legacyStore);
          removeLocalMirrorStrict("cesium_token");
        },
      );
      return legacyMirror as Settings[K];
    }
    return DEFAULTS[key];
  }
  const store = await getStore();
  if (store) {
    try {
      const v = await store.get<Settings[K]>(key);
      const normalised = normaliseSetting(key, v);
      if (normalised !== undefined) {
        if (isTauri() && SENSITIVE_KEYS.has(key)) removeLocalMirror(key);
        return normalised;
      }
    } catch (err) {
      console.warn(`[settings] store.get(${String(key)}) failed`, err);
    }
  }

  const mirrored = readLocalMirror(key);
  if (mirrored !== undefined) {
    if (isTauri() && SENSITIVE_KEYS.has(key)) {
      // Sensitive values have a dedicated fail-closed migration path above.
      // Never surface a plaintext mirror from this generic fallback.
      removeLocalMirror(key);
      return DEFAULTS[key];
    }
    return mirrored;
  }

  return DEFAULTS[key];
}

async function writeUntransactional<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  migrateLocalStorage();
  if (isTauri() && key === "cesium_token") {
    removeLocalMirrorStrict(key);
    await writeTokenToKeychain(value as string);
    await blankStoreToken();
    return;
  }
  if (shouldMirrorToLocalStorage(key) && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch (err) {
      throw new Error(`Could not persist ${String(key)} in WebView storage.`, { cause: err });
    }
  } else if (isTauri() && SENSITIVE_KEYS.has(key)) {
    removeLocalMirror(key);
  }
  const store = await getStore();
  if (store) {
    try {
      await store.set(key, value);
      await store.save();
    } catch (err) {
      console.warn(`[settings] store.set/save failed for ${String(key)}`, err);
      throw new Error(`Could not persist ${String(key)} in the desktop settings store.`, { cause: err });
    }
  } else if (isTauri() && SENSITIVE_KEYS.has(key)) {
    console.warn(`[settings] Tauri store unavailable; ${String(key)} was not persisted.`);
  }
}

async function write<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  return runSettingsTransaction(
    `Saving ${String(key)}`,
    [key],
    async () => writeUntransactional(key, value),
  );
}

type SettingsEntry = [keyof Settings, Settings[keyof Settings]];

async function applyEntriesAtomically(operation: string, entries: readonly SettingsEntry[]): Promise<void> {
  await runSettingsTransaction(
    operation,
    entries.map(([key]) => key),
    async () => {
      for (const [key, value] of entries) await writeUntransactional(key, value);
    },
  );
}

const SCENARIOS_KEY = "saved_scenarios";
const MAX_SAVED_SCENARIOS = 20;

export type SavedScenario = {
  /** Stable identity for React keys and deletion. Generated on save; legacy
   *  records without one get a deterministic fallback derived from their
   *  timestamp+name so the id is stable across reads. */
  id: string;
  name: string;
  savedAt: string;
  data: unknown;
};

export type ScenarioRestorePoint = {
  index: number;
  beforeId?: string;
  afterId?: string;
};

function makeScenarioId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `scenario-${crypto.randomUUID()}`;
  }
  return `scenario-${new Date().toISOString()}-${SETTINGS_SCHEMA_VERSION}`;
}

/**
 * Re-validate persisted scenario records on read, mirroring the write-path
 * trust boundary in {@link saveScenario}. A tampered or corrupted record, or one
 * whose payload no longer parses, is dropped here rather than flowing
 * unvalidated into the UI. Valid records keep their original `data` so that
 * downstream schema-migration detection (legacy vs current) still works.
 */
function sanitizeSavedScenarios(raw: unknown): SavedScenario[] {
  if (!Array.isArray(raw)) return [];
  const clean: SavedScenario[] = [];
  let dropped = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") { dropped++; continue; }
    const rec = entry as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "";
    const savedAt = typeof rec.savedAt === "string" ? rec.savedAt : "";
    if (!name || !savedAt) { dropped++; continue; }
    const parsed = parseScenarioPayload(rec.data);
    if (!parsed.ok) { dropped++; continue; }
    const id = typeof rec.id === "string" && rec.id ? rec.id : `${savedAt}::${name}`;
    clean.push({ id, name, savedAt, data: rec.data });
  }
  if (dropped > 0) {
    console.warn(`[settings] dropped ${dropped} invalid saved scenario(s) on read`);
  }
  return clean.slice(0, MAX_SAVED_SCENARIOS);
}

async function readScenarios(): Promise<SavedScenario[]> {
  const store = await getStore();
  const failures: unknown[] = [];
  let completedRead = false;
  if (store) {
    try {
      const v = await store.get<SavedScenario[]>(SCENARIOS_KEY);
      completedRead = true;
      if (Array.isArray(v)) return sanitizeSavedScenarios(v);
      if (v != null) failures.push(new Error("Desktop scenario storage returned an invalid record."));
    } catch (error) {
      failures.push(error);
    }
  }
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(LS_PREFIX + SCENARIOS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return sanitizeSavedScenarios(parsed);
        throw new Error("Local scenario storage does not contain a list.");
      }
      completedRead = true;
    } catch (error) {
      failures.push(error);
    }
  }
  if (!completedRead && failures.length > 0) {
    const detail = failures
      .map((error) => error instanceof Error ? error.message : String(error))
      .join("; ");
    throw new Error(`Saved scenario storage is unavailable: ${detail}`);
  }
  return [];
}

let scenarioMutationTail: Promise<void> = Promise.resolve();

async function writeScenarios(operation: string, list: SavedScenario[]): Promise<void> {
  const capped = list.slice(0, MAX_SAVED_SCENARIOS);
  const localKey = LS_PREFIX + SCENARIOS_KEY;
  const localAvailable = typeof localStorage !== "undefined";
  let previousLocal: string | null = null;
  const store = await getStore();
  let previousStore: SavedScenario[] | undefined;
  try {
    if (localAvailable) previousLocal = localStorage.getItem(localKey);
    if (store) previousStore = await store.get<SavedScenario[]>(SCENARIOS_KEY);
  } catch (error) {
    throw new SettingsTransactionError(operation, error, []);
  }

  try {
    if (localAvailable) localStorage.setItem(localKey, JSON.stringify(capped));
    if (store) {
      await store.set(SCENARIOS_KEY, capped);
      await store.save();
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (localAvailable) {
      try {
        if (previousLocal === null) localStorage.removeItem(localKey);
        else localStorage.setItem(localKey, previousLocal);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (store) {
      try {
        if (previousStore === undefined) {
          if (!store.delete) throw new Error("Desktop settings store cannot restore an absent scenario list.");
          await store.delete(SCENARIOS_KEY);
        } else {
          await store.set(SCENARIOS_KEY, previousStore);
        }
        await store.save();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    throw new SettingsTransactionError(operation, error, rollbackErrors);
  }
}

function mutateScenarios(
  operation: string,
  mutation: (list: SavedScenario[]) => SavedScenario[] | null,
): Promise<void> {
  const pending = scenarioMutationTail.then(async () => {
    const list = await readScenarios();
    const next = mutation(list);
    if (next) await writeScenarios(operation, next);
  });
  scenarioMutationTail = pending.catch(() => {});
  return pending;
}

function validateRestoredScenario(scenario: SavedScenario): SavedScenario {
  const [clean] = sanitizeSavedScenarios([scenario]);
  if (!clean || clean.id !== scenario.id) {
    throw new Error("Saved scenario is invalid and cannot be restored.");
  }
  return clean;
}

async function restoreScenarioAt(scenario: SavedScenario, point: ScenarioRestorePoint): Promise<void> {
  const clean = validateRestoredScenario(scenario);
  const targetIndex = Number.isInteger(point.index) && point.index >= 0 ? point.index : 0;
  return mutateScenarios("Restoring saved scenario", (list) => {
    if (list.some((entry) => entry.id === clean.id)) return null;
    const next = [...list];
    const beforeIndex = point.beforeId
      ? next.findIndex((entry) => entry.id === point.beforeId)
      : -1;
    const afterIndex = point.afterId
      ? next.findIndex((entry) => entry.id === point.afterId)
      : -1;
    const chronologicalIndex = next.findIndex((entry) => entry.savedAt <= clean.savedAt);
    const insertAt = beforeIndex >= 0
      ? beforeIndex + 1
      : afterIndex >= 0
        ? afterIndex
        : chronologicalIndex >= 0
          ? chronologicalIndex
          : Math.min(targetIndex, next.length);
    next.splice(insertAt, 0, clean);
    return next;
  });
}

async function removeScenarioById(id: string): Promise<void> {
  return mutateScenarios("Deleting saved scenario", (list) => {
    const next = list.filter((scenario) => scenario.id !== id);
    return next.length === list.length ? null : next;
  });
}

async function addScenario(name: string, data: unknown): Promise<void> {
  const parsed = parseScenarioPayload(data);
  if (!parsed.ok) throw new Error(parsed.reason);
  const scenario = {
    id: makeScenarioId(),
    name,
    savedAt: new Date().toISOString(),
    data: parsed.payload,
  };
  return mutateScenarios("Saving scenario", (list) => [scenario, ...list]);
}

export const settings = {
  async getCesiumToken(): Promise<string> {
    return read("cesium_token");
  },
  async setCesiumToken(token: string): Promise<void> {
    return write("cesium_token", token);
  },
  async getTheme(): Promise<Theme> {
    return read("theme");
  },
  async setTheme(t: Theme): Promise<void> {
    return write("theme", t);
  },
  async getLocale(): Promise<Locale> {
    return read("locale");
  },
  async setLocale(locale: Locale): Promise<void> {
    return write("locale", locale);
  },
  async getGlobeStyle(): Promise<GlobeStyleId> {
    return read("globe_style");
  },
  async setGlobeStyle(s: GlobeStyleId): Promise<void> {
    return write("globe_style", s);
  },
  async getColormap(): Promise<ColormapId> {
    return read("colormap");
  },
  async setColormap(c: ColormapId): Promise<void> {
    return write("colormap", c);
  },
  async getRendererQuality(): Promise<RendererQualityTier> {
    return read("renderer_quality");
  },
  async setRendererQuality(tier: RendererQualityTier): Promise<void> {
    return write("renderer_quality", tier);
  },
  async getRendererAutoQuality(): Promise<boolean> {
    return read("renderer_auto_quality");
  },
  async setRendererAutoQuality(enabled: boolean): Promise<void> {
    return write("renderer_auto_quality", enabled);
  },
  async getWorkspaceMode(): Promise<WorkspaceMode> {
    return read("workspace_mode");
  },
  async setWorkspaceMode(mode: WorkspaceMode): Promise<void> {
    return write("workspace_mode", mode);
  },
  async getLaunchExperiencePolicy(): Promise<LaunchExperiencePolicy> {
    return read("launch_experience_policy");
  },
  async setLaunchExperiencePolicy(policy: LaunchExperiencePolicy): Promise<void> {
    return write("launch_experience_policy", policy);
  },
  async getLaunchExperienceSeen(): Promise<string | null> {
    return read("launch_experience_seen_at");
  },
  async markLaunchExperienceSeen(): Promise<void> {
    return write("launch_experience_seen_at", new Date().toISOString());
  },
  async getDisclaimerAcknowledged(): Promise<string | null> {
    return read("disclaimer_acknowledged_at");
  },
  async acknowledgeDisclaimer(): Promise<void> {
    return write("disclaimer_acknowledged_at", new Date().toISOString());
  },
  async getTourCompleted(): Promise<string | null> {
    return read("tour_completed_at");
  },
  async markTourCompleted(): Promise<void> {
    return write("tour_completed_at", new Date().toISOString());
  },
  async clearTourCompleted(): Promise<void> {
    return clearSettingAtomically("Clearing tour completion", "tour_completed_at");
  },
  async getLessonCompletions(): Promise<LessonCompletions> {
    return read("lessons_completed");
  },
  async markLessonCompleted(lessonId: string, completedAt = new Date().toISOString()): Promise<void> {
    const key = lessonId.trim();
    if (!key) throw new Error("Lesson ID is required");
    const completions = await read("lessons_completed");
    return write("lessons_completed", { ...completions, [key]: completedAt });
  },
  async getTokenBannerDismissed(): Promise<string | null> {
    return read("token_banner_dismissed_at");
  },
  async getClassroomLocked(): Promise<boolean> {
    return read("classroom_locked");
  },
  async setClassroomLocked(locked: boolean): Promise<void> {
    return write("classroom_locked", locked);
  },
  async dismissTokenBanner(): Promise<void> {
    return write("token_banner_dismissed_at", new Date().toISOString());
  },
  /** Clear the token-banner dismissal so it re-appears on next eval.
   *  Used by Settings → Advanced → Show token banner again. */
  async clearTokenBannerDismissed(): Promise<void> {
    return clearSettingAtomically("Clearing online-map notice dismissal", "token_banner_dismissed_at");
  },
  async loadAll(): Promise<Settings> {
    return {
      cesium_token: await read("cesium_token"),
      theme: await read("theme"),
      locale: await read("locale"),
      globe_style: await read("globe_style"),
      colormap: await read("colormap"),
      renderer_quality: await read("renderer_quality"),
      renderer_auto_quality: await read("renderer_auto_quality"),
      workspace_mode: await read("workspace_mode"),
      launch_experience_policy: await read("launch_experience_policy"),
      launch_experience_seen_at: await read("launch_experience_seen_at"),
      disclaimer_acknowledged_at: await read("disclaimer_acknowledged_at"),
      tour_completed_at: await read("tour_completed_at"),
      lessons_completed: await read("lessons_completed"),
      token_banner_dismissed_at: await read("token_banner_dismissed_at"),
      classroom_locked: await read("classroom_locked"),
    };
  },
  /** Persist a coherent settings patch. Every affected backend is snapshotted
   * before the first write; any failure restores keychain, plugin-store, and
   * localStorage values before an explicit rollback status is returned. */
  async apply(patch: Partial<Settings>): Promise<void> {
    const entries: SettingsEntry[] = [];
    for (const [rawKey, rawValue] of Object.entries(patch)) {
      if (!SETTINGS_KEYS.has(rawKey)) throw new Error(`Unknown setting ${rawKey}.`);
      const key = rawKey as keyof Settings;
      const value = normaliseSetting(key, rawValue);
      if (value === undefined) throw new Error(`Invalid value for setting ${rawKey}.`);
      entries.push([key, value]);
    }
    await applyEntriesAtomically("Applying settings", entries);
  },
  /** Clear every persisted key from both the Tauri store and any browser /
   * legacy localStorage copies. Used by Settings → "Reset to defaults".
   * Preserves the schema version stamp and rolls every backend back if any
   * mutation fails. */
  async resetAll(): Promise<void> {
    await runSettingsTransaction(
      "Resetting settings",
      SETTINGS_KEY_LIST,
      async (snapshot) => {
        if (isTauri()) await writeTokenToKeychain("");
        if (typeof localStorage !== "undefined") {
          for (const key of SETTINGS_KEY_LIST) localStorage.removeItem(LS_PREFIX + key);
          localStorage.setItem(
            LS_PREFIX + SCHEMA_VERSION_KEY,
            JSON.stringify(SETTINGS_SCHEMA_VERSION),
          );
        }
        if (snapshot.store) {
          for (const key of SETTINGS_KEY_LIST) {
            if (typeof snapshot.store.delete === "function") await snapshot.store.delete(key);
            else await snapshot.store.set(key, DEFAULTS[key]);
          }
          await snapshot.store.set(SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
          await snapshot.store.save();
        }
      },
      true,
    );
  },
  /** Clear only presentation settings while preserving scientific work,
   * onboarding state, classroom state, and credentials. Unlike removing the
   * WebView mirrors alone, this also clears the authoritative desktop store so
   * an ErrorBoundary recovery reload cannot immediately restore the fault. */
  async resetVisualSettings(): Promise<void> {
    await runSettingsTransaction(
      "Resetting visual settings",
      VISUAL_SETTINGS_KEYS,
      async (snapshot) => {
        if (typeof localStorage !== "undefined") {
          for (const key of VISUAL_SETTINGS_KEYS) localStorage.removeItem(LS_PREFIX + key);
        }
        if (snapshot.store) {
          for (const key of VISUAL_SETTINGS_KEYS) {
            if (typeof snapshot.store.delete === "function") await snapshot.store.delete(key);
            else await snapshot.store.set(key, DEFAULTS[key]);
          }
          await snapshot.store.save();
        }
      },
    );
  },
  async getSavedScenarios(): Promise<SavedScenario[]> {
    return readScenarios();
  },
  async saveScenario(name: string, data: unknown): Promise<void> {
    return addScenario(name, data);
  },
  /** Delete a saved scenario by its stable id. Deleting by id (not array
   *  position) prevents removing the wrong record if the list was reordered by
   *  a concurrent read between render and click. */
  async deleteScenario(id: string): Promise<void> {
    return removeScenarioById(id);
  },
  /** Reinsert an optimistically deleted scenario around its surviving stable-ID
   * neighbours. Serialized mutations keep saves made during the Undo window. */
  async restoreScenario(scenario: SavedScenario, point: ScenarioRestorePoint): Promise<void> {
    return restoreScenarioAt(scenario, point);
  },
  /** Clear only the disclaimer-ack timestamp so the first-run modal
   * re-appears on next launch. */
  async clearDisclaimerAck(): Promise<void> {
    return clearSettingAtomically("Clearing disclaimer acknowledgement", "disclaimer_acknowledged_at");
  },
  async exportSettings(): Promise<string> {
    const all = await this.loadAll();
    const exportable: Partial<Settings> = { ...all };
    delete (exportable as Record<string, unknown>).cesium_token;
    return JSON.stringify(
      { _schema_version: SETTINGS_SCHEMA_VERSION, ...exportable },
      null,
      2,
    );
  },
  async importSettings(json: string): Promise<{ applied: number; skipped: string[] }> {
    if (new TextEncoder().encode(json).byteLength > 256 * 1024) {
      throw new Error("Settings file exceeds the 256 KB import limit.");
    }
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Settings file must contain a JSON object.");
    }
    const skipped: string[] = [];
    const pending: Array<[keyof Settings, Settings[keyof Settings]]> = [];
    const importedVersion = raw._schema_version;
    if (typeof importedVersion === "number" && importedVersion > SETTINGS_SCHEMA_VERSION) {
      throw new Error(`Settings schema ${importedVersion} is newer than supported schema ${SETTINGS_SCHEMA_VERSION}.`);
    }
    for (const key of Object.keys(raw)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      if (key === "_schema_version" || key === "cesium_token") continue;
      if (!SETTINGS_KEYS.has(key)) {
        console.warn(`[settings] import: unknown key "${key}" — skipping`);
        skipped.push(key);
        continue;
      }
      const value = raw[key];
      const normalised = normaliseSetting(key as keyof Settings, value);
      if (normalised !== undefined) {
        pending.push([key as keyof Settings, normalised]);
      } else {
        skipped.push(key);
      }
    }
    await applyEntriesAtomically("Importing settings", pending);
    return { applied: pending.length, skipped };
  },
};
