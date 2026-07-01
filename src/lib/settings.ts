/**
 * Persistent app settings, stored via tauri-plugin-store under
 * `app_data_dir/settings.json`. In browser-preview mode we fall back to
 * `localStorage` so the same API works in `npm run dev`. Sensitive
 * desktop values such as `cesium_token` are not mirrored into WebView
 * storage.
 */

import { isTauri } from "./tauri";
import { DEFAULT_STYLE, type GlobeStyleId } from "./globe-styles";
import { parseScenarioPayload } from "./scenario-schema";

export type Theme = "mocha" | "latte";

export type ColormapId = "diverging" | "cividis" | "viridis";
export type LessonCompletions = Record<string, string>;

export type Settings = {
  cesium_token: string;
  theme: Theme;
  globe_style: GlobeStyleId;
  colormap: ColormapId;
  disclaimer_acknowledged_at: string | null;
  tour_completed_at: string | null;
  lessons_completed: LessonCompletions;
  /** First-run dismissible banner suggesting the user paste a Cesium
   *  ion token for satellite imagery. Set when the user clicks
   *  Dismiss; absent / null means the banner should show. */
  token_banner_dismissed_at: string | null;
};

export const SETTINGS_SCHEMA_VERSION = 1;
const SCHEMA_VERSION_KEY = "_settings_schema_version";

const DEFAULTS: Settings = {
  cesium_token: "",
  theme: "mocha",
  globe_style: DEFAULT_STYLE,
  colormap: "diverging",
  disclaimer_acknowledged_at: null,
  tour_completed_at: null,
  lessons_completed: {},
  token_banner_dismissed_at: null,
};

const SETTINGS_KEYS: ReadonlySet<string> = new Set<keyof Settings>([
  "cesium_token",
  "theme",
  "globe_style",
  "colormap",
  "disclaimer_acknowledged_at",
  "tour_completed_at",
  "lessons_completed",
  "token_banner_dismissed_at",
]);

const STORE_FILE = "settings.json";
const LS_PREFIX = "tsunamisim.";
const SENSITIVE_KEYS = new Set<keyof Settings>(["cesium_token"]);
const GLOBE_STYLE_IDS: readonly GlobeStyleId[] = [
  "osm",
  "natural-earth-2",
  "esri-world-imagery",
  "cesium-bathymetry",
  "cesium-world-imagery",
];

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
      result = (typeof value === "string" && GLOBE_STYLE_IDS.includes(value as GlobeStyleId)
        ? value
        : undefined) as Settings[K] | undefined;
      break;
    case "colormap":
      result = (value === "diverging" || value === "cividis" || value === "viridis" ? value : undefined) as Settings[K] | undefined;
      break;
    case "disclaimer_acknowledged_at":
    case "tour_completed_at":
    case "token_banner_dismissed_at":
      result = (typeof value === "string" || value === null ? value : undefined) as Settings[K] | undefined;
      break;
    case "lessons_completed":
      result = normaliseLessonCompletions(value) as Settings[K] | undefined;
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

async function read<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  migrateLocalStorage();
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
      // One-time migration for tokens written by older builds that mirrored
      // `cesium_token` into localStorage. Move it into plugin-store when
      // available, then purge the WebView copy either way.
      if (store) {
        try {
          await store.set(key, mirrored);
          await store.save();
        } catch (err) {
          console.warn(`[settings] legacy ${String(key)} migration failed`, err);
          removeLocalMirror(key);
          return DEFAULTS[key];
        }
      }
      removeLocalMirror(key);
      return store ? mirrored : DEFAULTS[key];
    }
    return mirrored;
  }

  return DEFAULTS[key];
}

async function write<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  migrateLocalStorage();
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
    }
  } else if (isTauri() && SENSITIVE_KEYS.has(key)) {
    console.warn(`[settings] Tauri store unavailable; ${String(key)} was not persisted.`);
  }
}

const SCENARIOS_KEY = "saved_scenarios";
const MAX_SAVED_SCENARIOS = 20;

export type SavedScenario = {
  name: string;
  savedAt: string;
  data: unknown;
};

async function readScenarios(): Promise<SavedScenario[]> {
  const store = await getStore();
  if (store) {
    try {
      const v = await store.get<SavedScenario[]>(SCENARIOS_KEY);
      if (Array.isArray(v)) return v;
    } catch { /* ignore */ }
  }
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(LS_PREFIX + SCENARIOS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
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
      disclaimer_acknowledged_at: await read("disclaimer_acknowledged_at"),
      tour_completed_at: await read("tour_completed_at"),
      lessons_completed: await read("lessons_completed"),
      token_banner_dismissed_at: await read("token_banner_dismissed_at"),
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
      "disclaimer_acknowledged_at",
      "tour_completed_at",
      "lessons_completed",
      "token_banner_dismissed_at",
    ];
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
        } catch {
          /* best-effort */
        }
      }
      try {
        await store.set(SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
        await store.save();
      } catch {
        /* ignore */
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
    list.unshift({ name, savedAt: new Date().toISOString(), data: parsed.payload });
    return writeScenarios(list);
  },
  async deleteScenario(index: number): Promise<void> {
    const list = await readScenarios();
    if (index >= 0 && index < list.length) {
      list.splice(index, 1);
      return writeScenarios(list);
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
    const raw = JSON.parse(json) as Record<string, unknown>;
    const skipped: string[] = [];
    let applied = 0;
    for (const [key, value] of Object.entries(raw)) {
      if (key === "_schema_version" || key === "cesium_token") continue;
      if (!SETTINGS_KEYS.has(key)) {
        console.warn(`[settings] import: unknown key "${key}" — skipping`);
        skipped.push(key);
        continue;
      }
      const normalised = normaliseSetting(key as keyof Settings, value);
      if (normalised !== undefined) {
        await write(key as keyof Settings, normalised);
        applied++;
      } else {
        skipped.push(key);
      }
    }
    return { applied, skipped };
  },
};
