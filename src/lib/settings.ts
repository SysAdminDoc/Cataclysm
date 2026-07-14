/**
 * Persistent app settings, stored via tauri-plugin-store under
 * `app_data_dir/settings.json`. In browser-preview mode we fall back to
 * `localStorage` so the same API works in `npm run dev`. Sensitive
 * desktop values such as `cesium_token` are not mirrored into WebView
 * storage.
 */

import { isTauri } from "./tauri";
import { DEFAULT_STYLE, type GlobeStyleId } from "./globe-styles";
import { isGlobeStyleId } from "./earth-assets";
import { parseScenarioPayload } from "./scenario-schema";
import type { RendererQualityTier } from "../rendering/quality-profiles";

export type Theme = "mocha" | "latte";

export type ColormapId = "diverging" | "cividis" | "viridis";
export type LessonCompletions = Record<string, string>;
export type LaunchExperiencePolicy = "first" | "always" | "never";
export type WorkspaceMode = "simple" | "customize" | "advanced";

export type Settings = {
  cesium_token: string;
  theme: Theme;
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

export const SETTINGS_SCHEMA_VERSION = 4;
const SCHEMA_VERSION_KEY = "_settings_schema_version";

const DEFAULTS: Settings = {
  cesium_token: "",
  theme: "mocha",
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

const SETTINGS_KEYS: ReadonlySet<string> = new Set<keyof Settings>([
  "cesium_token",
  "theme",
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
]);

const STORE_FILE = "settings.json";
const LS_PREFIX = "tsunamisim.";
const SENSITIVE_KEYS = new Set<keyof Settings>(["cesium_token"]);
type LazyStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
  delete?(key: string): Promise<boolean | void>;
};

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
    localStorage.removeItem(LS_PREFIX + key);
  } catch {
    /* ignore */
  }
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
 *  and blanked. Keychain failures fall back to the store path so a broken
 *  secret service doesn't lock users out of their token. */
async function readTokenFromKeychain(): Promise<string | undefined> {
  try {
    const { api } = await import("./tauri");
    const token = await api.keychainGetToken();
    return token ?? undefined;
  } catch (err) {
    console.warn("[settings] keychain read failed — falling back to store", err);
    return undefined;
  }
}

async function writeTokenToKeychain(token: string): Promise<boolean> {
  try {
    const { api } = await import("./tauri");
    await api.keychainSetToken(token);
    return true;
  } catch (err) {
    console.warn("[settings] keychain write failed — falling back to store", err);
    return false;
  }
}

async function blankStoreToken(): Promise<void> {
  const store = await getStore();
  if (!store) return;
  try {
    await store.set("cesium_token", "");
    await store.save();
  } catch (err) {
    console.warn("[settings] failed to blank legacy store token", err);
  }
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
      try {
        const legacy = await legacyStore.get<string>("cesium_token");
        if (typeof legacy === "string" && legacy !== "") {
          if (await writeTokenToKeychain(legacy)) {
            await blankStoreToken();
          }
          return legacy as Settings[K];
        }
      } catch (err) {
        console.warn("[settings] legacy token migration read failed", err);
      }
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
      // One-time migration for a sensitive value an older build mirrored into
      // localStorage. Sensitive keys must live ONLY in the OS keychain — never
      // the plaintext plugin-store — so route it through the keychain and purge
      // the WebView copy. (cesium_token is the only sensitive key and is
      // normally handled by the early keychain path above; this is a defensive
      // fallback that must not leak the value into the store.)
      if (typeof mirrored === "string" && mirrored !== "") {
        try {
          await writeTokenToKeychain(mirrored);
        } catch (err) {
          console.warn(`[settings] legacy ${String(key)} migration failed`, err);
          removeLocalMirror(key);
          return DEFAULTS[key];
        }
      }
      removeLocalMirror(key);
      return mirrored;
    }
    return mirrored;
  }

  return DEFAULTS[key];
}

async function write<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  migrateLocalStorage();
  if (isTauri() && key === "cesium_token") {
    removeLocalMirror(key);
    if (await writeTokenToKeychain(value as string)) {
      await blankStoreToken();
      return;
    }
    throw new Error("The operating-system keychain is unavailable; the token was not stored.");
    // Keychain unavailable — fall through to the plugin-store path below.
  }
  if (shouldMirrorToLocalStorage(key) && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch {
      // Quota/private-mode — ignore.
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
      const suffix = SENSITIVE_KEYS.has(key)
        ? "value not mirrored to localStorage."
        : "localStorage mirror kept.";
      console.warn(`[settings] store.set/save failed for ${String(key)}; ${suffix}`, err);
      throw new Error(`Could not persist ${String(key)} in the desktop settings store.`, { cause: err });
    }
  } else if (isTauri() && SENSITIVE_KEYS.has(key)) {
    console.warn(`[settings] Tauri store unavailable; ${String(key)} was not persisted.`);
  }
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
  if (store) {
    try {
      const v = await store.get<SavedScenario[]>(SCENARIOS_KEY);
      if (Array.isArray(v)) return sanitizeSavedScenarios(v);
    } catch { /* ignore */ }
  }
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(LS_PREFIX + SCENARIOS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return sanitizeSavedScenarios(parsed);
      }
    } catch { /* ignore */ }
  }
  return [];
}

async function writeScenarios(list: SavedScenario[]): Promise<void> {
  const capped = list.slice(0, MAX_SAVED_SCENARIOS);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(LS_PREFIX + SCENARIOS_KEY, JSON.stringify(capped));
    } catch { /* quota */ }
  }
  const store = await getStore();
  if (store) {
    try {
      await store.set(SCENARIOS_KEY, capped);
      await store.save();
    } catch (err) {
      console.warn("[settings] failed to save scenarios", err);
    }
  }
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
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(LS_PREFIX + "tour_completed_at");
      } catch {
        /* ignore */
      }
    }
    const store = await getStore();
    if (store && typeof store.delete === "function") {
      try {
        await store.delete("tour_completed_at");
        await store.save();
      } catch {
        /* best-effort */
      }
    }
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
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(LS_PREFIX + "token_banner_dismissed_at");
      } catch {
        /* ignore */
      }
    }
    const store = await getStore();
    if (store && typeof store.delete === "function") {
      try {
        await store.delete("token_banner_dismissed_at");
        await store.save();
      } catch {
        /* best-effort */
      }
    }
  },
  async loadAll(): Promise<Settings> {
    return {
      cesium_token: await read("cesium_token"),
      theme: await read("theme"),
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
  /** Clear every persisted key from both the Tauri store and any browser /
   * legacy localStorage copies. Used by Settings → "Reset to defaults".
   * Preserves the schema version stamp. */
  async resetAll(): Promise<void> {
    const keys: (keyof Settings)[] = [
      "cesium_token",
      "theme",
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
    if (isTauri()) {
      const { api } = await import("./tauri");
      await api.keychainSetToken("");
    }
    if (typeof localStorage !== "undefined") {
      for (const k of keys) {
        try {
          localStorage.removeItem(LS_PREFIX + k);
        } catch {
          /* ignore */
        }
      }
      try {
        localStorage.setItem(
          LS_PREFIX + SCHEMA_VERSION_KEY,
          JSON.stringify(SETTINGS_SCHEMA_VERSION),
        );
      } catch {
        /* ignore */
      }
    }
    const store = await getStore();
    if (store && typeof store.delete === "function") {
      for (const k of keys) {
        try {
          await store.delete(k);
        } catch (err) {
          throw new Error(`Could not delete ${String(k)} from the desktop settings store.`, { cause: err });
        }
      }
      try {
        await store.set(SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
        await store.save();
      } catch (err) {
        throw new Error("Could not save the reset desktop settings store.", { cause: err });
      }
    }
  },
  async getSavedScenarios(): Promise<SavedScenario[]> {
    return readScenarios();
  },
  async saveScenario(name: string, data: unknown): Promise<void> {
    const parsed = parseScenarioPayload(data);
    if (!parsed.ok) throw new Error(parsed.reason);
    const list = await readScenarios();
    list.unshift({ id: makeScenarioId(), name, savedAt: new Date().toISOString(), data: parsed.payload });
    return writeScenarios(list);
  },
  /** Delete a saved scenario by its stable id. Deleting by id (not array
   *  position) prevents removing the wrong record if the list was reordered by
   *  a concurrent read between render and click. */
  async deleteScenario(id: string): Promise<void> {
    const list = await readScenarios();
    const next = list.filter((scenario) => scenario.id !== id);
    if (next.length !== list.length) {
      return writeScenarios(next);
    }
  },
  /** Clear only the disclaimer-ack timestamp so the first-run modal
   * re-appears on next launch. */
  async clearDisclaimerAck(): Promise<void> {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(LS_PREFIX + "disclaimer_acknowledged_at");
      } catch {
        /* ignore */
      }
    }
    const store = await getStore();
    if (store && typeof store.delete === "function") {
      try {
        await store.delete("disclaimer_acknowledged_at");
        await store.save();
      } catch {
        /* best-effort */
      }
    }
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
    // Apply atomically: snapshot the prior value of every key we are about to
    // change so a write failure partway through can be rolled back, rather than
    // leaving settings in a half-imported state.
    const prior = new Map<keyof Settings, Settings[keyof Settings]>();
    for (const [key] of pending) prior.set(key, await read(key));
    const applied: Array<keyof Settings> = [];
    try {
      for (const [key, value] of pending) {
        await write(key, value);
        applied.push(key);
      }
    } catch (err) {
      for (const key of applied.reverse()) {
        try {
          await write(key, prior.get(key) as Settings[keyof Settings]);
        } catch {
          // Best-effort rollback; a failing store is already the root problem.
        }
      }
      throw new Error(`Settings import failed and was rolled back: ${String(err)}`);
    }
    return { applied: pending.length, skipped };
  },
};
