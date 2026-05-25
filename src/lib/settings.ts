/**
 * Persistent app settings, stored via tauri-plugin-store under
 * `app_data_dir/settings.json`. In browser-preview mode we fall back to
 * `localStorage` so the same API works in `npm run dev`.
 */

import { isTauri } from "./tauri";

export type Theme = "mocha" | "latte";

export type Settings = {
  cesium_token: string;
  theme: Theme;
  disclaimer_acknowledged_at: string | null;
};

const DEFAULTS: Settings = {
  cesium_token: "",
  theme: "mocha",
  disclaimer_acknowledged_at: null,
};

const STORE_FILE = "settings.json";
const LS_PREFIX = "tsunamisim.";

type LazyStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
};

let storePromise: Promise<LazyStore | null> | null = null;
function getStore(): Promise<LazyStore | null> {
  if (!isTauri()) return Promise.resolve(null);
  if (!storePromise) {
    storePromise = import("@tauri-apps/plugin-store")
      .then(({ load }) => load(STORE_FILE, { defaults: DEFAULTS, autoSave: true }) as Promise<LazyStore>)
      .catch((err) => {
        console.warn("Settings store unavailable; falling back to in-memory.", err);
        return null;
      });
  }
  return storePromise;
}

async function read<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const store = await getStore();
  if (store) {
    const v = await store.get<Settings[K]>(key);
    if (v !== undefined && v !== null) return v;
    return DEFAULTS[key];
  }
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_PREFIX + key) : null;
  if (raw === null) return DEFAULTS[key];
  try {
    return JSON.parse(raw) as Settings[K];
  } catch {
    return DEFAULTS[key];
  }
}

async function write<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  const store = await getStore();
  if (store) {
    await store.set(key, value);
    await store.save();
    return;
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
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
      disclaimer_acknowledged_at: await read("disclaimer_acknowledged_at"),
    };
  },
};
