/**
 * Persistent app settings, stored via tauri-plugin-store under
 * `app_data_dir/settings.json`. In browser-preview mode we fall back to
 * `localStorage` so the same API works in `npm run dev`.
 */

import { isTauri } from "./tauri";
import type { GlobeStyleId } from "./globe-styles";

export type Theme = "mocha" | "latte";

export type Settings = {
  cesium_token: string;
  theme: Theme;
  globe_style: GlobeStyleId;
  disclaimer_acknowledged_at: string | null;
};

const DEFAULTS: Settings = {
  cesium_token: "",
  theme: "mocha",
  globe_style: "osm",
  disclaimer_acknowledged_at: null,
};

const STORE_FILE = "settings.json";
const LS_PREFIX = "tsunamisim.";

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
          // Smoke test: confirm we can write and read back. If this throws
          // we fall through to localStorage so the UI still works. The probe
          // key is deleted immediately afterwards so it doesn't pollute the
          // user's settings file.
          await store.set("__init_probe", true);
          await store.save();
          if (typeof store.delete === "function") {
            try {
              await store.delete("__init_probe");
              await store.save();
            } catch {
              /* delete is best-effort */
            }
          }
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

async function read<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const store = await getStore();
  if (store) {
    try {
      const v = await store.get<Settings[K]>(key);
      if (v !== undefined && v !== null) return v;
    } catch (err) {
      console.warn(`[settings] store.get(${String(key)}) failed`, err);
    }
  }
  // Fall through to localStorage as a robust mirror.
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_PREFIX + key) : null;
  if (raw !== null) {
    try {
      return JSON.parse(raw) as Settings[K];
    } catch {
      // Bad JSON — fall through to default.
    }
  }
  return DEFAULTS[key];
}

async function write<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  // Always also mirror to localStorage so a future plugin-store regression
  // doesn't silently lose user data.
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch {
      // Quota/private-mode — ignore.
    }
  }
  const store = await getStore();
  if (store) {
    try {
      await store.set(key, value);
      await store.save();
    } catch (err) {
      console.warn(`[settings] store.set/save failed for ${String(key)}; localStorage mirror kept.`, err);
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
  async getDisclaimerAcknowledged(): Promise<string | null> {
    return read("disclaimer_acknowledged_at");
  },
  async acknowledgeDisclaimer(): Promise<void> {
    return write("disclaimer_acknowledged_at", new Date().toISOString());
  },
  async loadAll(): Promise<Settings> {
    return {
      cesium_token: await read("cesium_token"),
      theme: await read("theme"),
      globe_style: await read("globe_style"),
      disclaimer_acknowledged_at: await read("disclaimer_acknowledged_at"),
    };
  },
};
