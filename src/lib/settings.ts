/**
 * Persistent app settings, stored via tauri-plugin-store under
 * `app_data_dir/settings.json`. In browser-preview mode we fall back to
 * `localStorage` so the same API works in `npm run dev`. Sensitive
 * desktop values such as `cesium_token` are not mirrored into WebView
 * storage.
 */

import { isTauri } from "./tauri";
import type { GlobeStyleId } from "./globe-styles";
import { parseScenarioPayload } from "./scenario-schema";

export type Theme = "mocha" | "latte";

export type ColormapId = "diverging" | "cividis";

export type Settings = {
  cesium_token: string;
  theme: Theme;
  globe_style: GlobeStyleId;
  colormap: ColormapId;
  disclaimer_acknowledged_at: string | null;
  tour_completed_at: string | null;
  /** First-run dismissible banner suggesting the user paste a Cesium
   *  ion token for satellite imagery. Set when the user clicks
   *  Dismiss; absent / null means the banner should show. */
  token_banner_dismissed_at: string | null;
};

const DEFAULTS: Settings = {
  cesium_token: "",
  theme: "mocha",
  globe_style: "osm",
  colormap: "diverging",
  disclaimer_acknowledged_at: null,
  tour_completed_at: null,
  token_banner_dismissed_at: null,
};

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
          // Read-only smoke test: confirm the store opened and is readable. A
          // read can't pollute the user's settings.json (the old write+delete
          // probe left an `__init_probe` key behind whenever delete was
          // unsupported or failed). If this throws, non-sensitive settings
          // fall through to localStorage so the UI still works.
          await store.get("theme");
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

function normaliseSetting<K extends keyof Settings>(key: K, value: unknown): Settings[K] | undefined {
  switch (key) {
    case "cesium_token":
      return (typeof value === "string" ? value : undefined) as Settings[K] | undefined;
    case "theme":
      return (value === "mocha" || value === "latte" ? value : undefined) as Settings[K] | undefined;
    case "globe_style":
      return (typeof value === "string" && GLOBE_STYLE_IDS.includes(value as GlobeStyleId)
        ? value
        : undefined) as Settings[K] | undefined;
    case "colormap":
      return (value === "diverging" || value === "cividis" ? value : undefined) as Settings[K] | undefined;
    case "disclaimer_acknowledged_at":
    case "tour_completed_at":
    case "token_banner_dismissed_at":
      return (typeof value === "string" || value === null ? value : undefined) as Settings[K] | undefined;
    default:
      return undefined;
  }
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
      token_banner_dismissed_at: await read("token_banner_dismissed_at"),
    };
  },
  /** Clear every persisted key from both the Tauri store and any browser /
   * legacy localStorage copies. Used by Settings → "Reset to defaults". */
  async resetAll(): Promise<void> {
    const keys: (keyof Settings)[] = [
      "cesium_token",
      "theme",
      "globe_style",
      "colormap",
      "disclaimer_acknowledged_at",
      "tour_completed_at",
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
};
