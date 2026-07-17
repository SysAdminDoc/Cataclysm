import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => {
  type FailureRule = {
    method: "keychainGet" | "keychainSet" | "get" | "set" | "delete" | "save";
    key?: string;
    skip?: number;
  };

  const storeValues = new Map<string, unknown>();
  let keychainToken: string | null = null;
  let failure: FailureRule | null = null;

  function maybeFail(method: FailureRule["method"], key?: string): void {
    if (!failure || failure.method !== method || (failure.key !== undefined && failure.key !== key)) return;
    if ((failure.skip ?? 0) > 0) {
      failure.skip = (failure.skip ?? 0) - 1;
      return;
    }
    const injected = failure;
    failure = null;
    throw new Error(`injected ${injected.method}${injected.key ? ` ${injected.key}` : ""} failure`);
  }

  const store = {
    get: vi.fn(async (key: string) => {
      maybeFail("get", key);
      return storeValues.get(key);
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      storeValues.set(key, value);
      maybeFail("set", key);
    }),
    delete: vi.fn(async (key: string) => {
      storeValues.delete(key);
      maybeFail("delete", key);
      return true;
    }),
    save: vi.fn(async () => {
      maybeFail("save");
    }),
  };

  const api = {
    keychainGetToken: vi.fn(async () => {
      maybeFail("keychainGet");
      return keychainToken;
    }),
    keychainSetToken: vi.fn(async (token: string) => {
      keychainToken = token;
      maybeFail("keychainSet", token);
    }),
  };

  return {
    api,
    store,
    storeValues,
    failNext(rule: FailureRule) {
      failure = { ...rule };
    },
    getKeychainToken() {
      return keychainToken;
    },
    reset(token: string | null = null) {
      keychainToken = token;
      failure = null;
      storeValues.clear();
      for (const mock of [store.get, store.set, store.delete, store.save, api.keychainGetToken, api.keychainSetToken]) {
        mock.mockClear();
      }
    },
  };
});

vi.mock("../tauri", () => ({
  isTauri: () => true,
  api: desktop.api,
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => desktop.store),
}));

import {
  settings,
  SETTINGS_SCHEMA_VERSION,
  SettingsTransactionError,
  type Settings,
} from "../settings";

const LS_PREFIX = "tsunamisim.";
const SCHEMA_VERSION_KEY = "_settings_schema_version";
const SETTINGS_KEYS: readonly (keyof Settings)[] = [
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

const DESKTOP_BASELINE: Settings = {
  cesium_token: "",
  theme: "mocha",
  globe_style: "osm",
  colormap: "cividis",
  renderer_quality: "Low",
  renderer_auto_quality: true,
  workspace_mode: "advanced",
  launch_experience_policy: "first",
  launch_experience_seen_at: "2026-07-01T00:00:00.000Z",
  disclaimer_acknowledged_at: "2026-07-02T00:00:00.000Z",
  tour_completed_at: "2026-07-03T00:00:00.000Z",
  lessons_completed: { baseline: "2026-07-04T00:00:00.000Z" },
  token_banner_dismissed_at: "2026-07-05T00:00:00.000Z",
  classroom_locked: true,
};

async function captureTransactionFailure(action: () => Promise<unknown>): Promise<SettingsTransactionError> {
  let failure: unknown;
  try {
    await action();
  } catch (err) {
    failure = err;
  }
  expect(failure).toBeInstanceOf(SettingsTransactionError);
  expect(failure).toMatchObject({ rollbackStatus: "complete" });
  return failure as SettingsTransactionError;
}

function seedDesktopBaseline(): void {
  desktop.reset("old-keychain-token");
  desktop.storeValues.set(SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
  for (const key of SETTINGS_KEYS) desktop.storeValues.set(key, DESKTOP_BASELINE[key]);
  localStorage.clear();
  localStorage.setItem(LS_PREFIX + SCHEMA_VERSION_KEY, JSON.stringify(SETTINGS_SCHEMA_VERSION));
  for (const key of SETTINGS_KEYS) {
    if (key !== "cesium_token") localStorage.setItem(LS_PREFIX + key, JSON.stringify(DESKTOP_BASELINE[key]));
  }
}

function expectDesktopBaseline(): void {
  expect(desktop.getKeychainToken()).toBe("old-keychain-token");
  expect(Object.fromEntries(desktop.storeValues)).toEqual({
    [SCHEMA_VERSION_KEY]: SETTINGS_SCHEMA_VERSION,
    ...DESKTOP_BASELINE,
  });
  expect(localStorage.getItem(LS_PREFIX + "cesium_token")).toBeNull();
  for (const key of SETTINGS_KEYS) {
    if (key === "cesium_token") continue;
    expect(localStorage.getItem(LS_PREFIX + key)).toBe(JSON.stringify(DESKTOP_BASELINE[key]));
  }
}

describe("settings desktop transactions", () => {
  beforeEach(() => {
    seedDesktopBaseline();
  });

  it.each([
    ["keychain write", { method: "keychainSet", key: "new-token" }],
    ["legacy-token blank", { method: "set", key: "cesium_token" }],
    ["legacy-token save", { method: "save" }],
    ["settings-store write", { method: "set", key: "theme" }],
    ["settings-store save", { method: "save", skip: 1 }],
  ] as const)("rolls Apply back after a %s failure", async (_label, rule) => {
    desktop.failNext(rule);
    const failure = await captureTransactionFailure(() => settings.apply({
      cesium_token: "new-token",
      theme: "latte",
    }));
    expect(failure.message).toContain("All persisted values were restored.");
    expectDesktopBaseline();
  });

  it("does not fall back to a plaintext token when the keychain read fails", async () => {
    desktop.reset(null);
    desktop.storeValues.set(SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
    desktop.storeValues.set("cesium_token", "legacy-plaintext-token");
    desktop.failNext({ method: "keychainGet" });

    await expect(settings.getCesiumToken()).rejects.toThrow(/keychain could not be read/i);
    expect(desktop.storeValues.get("cesium_token")).toBe("legacy-plaintext-token");
  });

  it.each([
    ["keychain persistence", { method: "keychainSet", key: "legacy-plaintext-token" }],
    ["plaintext blank", { method: "set", key: "cesium_token" }],
    ["plaintext save", { method: "save" }],
  ] as const)("fails closed and restores both copies after legacy migration %s fails", async (_label, rule) => {
    desktop.reset(null);
    desktop.storeValues.set(SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
    desktop.storeValues.set("cesium_token", "legacy-plaintext-token");
    desktop.failNext(rule);

    await captureTransactionFailure(() => settings.getCesiumToken());
    expect(desktop.getKeychainToken()).toBe("");
    expect(desktop.storeValues.get("cesium_token")).toBe("legacy-plaintext-token");
  });

  it("returns a legacy token only after keychain persistence and plaintext blanking commit", async () => {
    desktop.reset(null);
    desktop.storeValues.set(SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
    desktop.storeValues.set("cesium_token", "legacy-plaintext-token");

    await expect(settings.getCesiumToken()).resolves.toBe("legacy-plaintext-token");
    expect(desktop.getKeychainToken()).toBe("legacy-plaintext-token");
    expect(desktop.storeValues.get("cesium_token")).toBe("");
  });

  it("keeps a legacy WebView token when keychain migration cannot commit", async () => {
    desktop.reset(null);
    desktop.storeValues.set(SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
    desktop.storeValues.set("cesium_token", "");
    localStorage.clear();
    localStorage.setItem(LS_PREFIX + SCHEMA_VERSION_KEY, JSON.stringify(SETTINGS_SCHEMA_VERSION));
    localStorage.setItem(LS_PREFIX + "cesium_token", JSON.stringify("legacy-webview-token"));
    desktop.failNext({ method: "keychainSet", key: "legacy-webview-token" });

    await captureTransactionFailure(() => settings.getCesiumToken());
    expect(desktop.getKeychainToken()).toBe("");
    expect(localStorage.getItem(LS_PREFIX + "cesium_token")).toBe(JSON.stringify("legacy-webview-token"));
  });

  it("purges a legacy WebView token only after keychain migration commits", async () => {
    desktop.reset(null);
    desktop.storeValues.set(SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
    desktop.storeValues.set("cesium_token", "");
    localStorage.clear();
    localStorage.setItem(LS_PREFIX + SCHEMA_VERSION_KEY, JSON.stringify(SETTINGS_SCHEMA_VERSION));
    localStorage.setItem(LS_PREFIX + "cesium_token", JSON.stringify("legacy-webview-token"));

    await expect(settings.getCesiumToken()).resolves.toBe("legacy-webview-token");
    expect(desktop.getKeychainToken()).toBe("legacy-webview-token");
    expect(localStorage.getItem(LS_PREFIX + "cesium_token")).toBeNull();
  });

  it.each([
    ["keychain clear", { method: "keychainSet", key: "" }],
    ...SETTINGS_KEYS.map((key) => [`store delete ${key}`, { method: "delete", key }] as const),
    ["schema stamp", { method: "set", key: SCHEMA_VERSION_KEY }],
    ["store save", { method: "save" }],
  ] as const)("rolls Reset back after a %s failure", async (_label, rule) => {
    desktop.failNext(rule);
    await captureTransactionFailure(() => settings.resetAll());
    expectDesktopBaseline();
  });

  it("clears desktop and WebView visual settings without deleting user state", async () => {
    await settings.resetVisualSettings();

    for (const key of ["theme", "globe_style", "colormap", "renderer_quality", "renderer_auto_quality"]) {
      expect(desktop.storeValues.has(key)).toBe(false);
      expect(localStorage.getItem(LS_PREFIX + key)).toBeNull();
    }
    expect(desktop.getKeychainToken()).toBe("old-keychain-token");
    expect(desktop.storeValues.get("workspace_mode")).toBe("advanced");
    expect(desktop.storeValues.get("disclaimer_acknowledged_at")).toBe("2026-07-02T00:00:00.000Z");
    expect(desktop.storeValues.get("classroom_locked")).toBe(true);
  });

  it.each([
    ["tour completion", "tour_completed_at", () => settings.clearTourCompleted()],
    ["online-map notice dismissal", "token_banner_dismissed_at", () => settings.clearTokenBannerDismissed()],
    ["disclaimer acknowledgement", "disclaimer_acknowledged_at", () => settings.clearDisclaimerAck()],
  ] as const)("clears %s transactionally in both settings stores", async (_label, key, action) => {
    await action();
    expect(desktop.storeValues.has(key)).toBe(false);
    expect(localStorage.getItem(LS_PREFIX + key)).toBeNull();
  });

  it.each([
    ["tour completion", "tour_completed_at", () => settings.clearTourCompleted()],
    ["online-map notice dismissal", "token_banner_dismissed_at", () => settings.clearTokenBannerDismissed()],
    ["disclaimer acknowledgement", "disclaimer_acknowledged_at", () => settings.clearDisclaimerAck()],
  ] as const)("rolls %s back when desktop persistence fails", async (_label, key, action) => {
    const original = DESKTOP_BASELINE[key];
    desktop.failNext({ method: "save" });
    await captureTransactionFailure(action);
    expect(desktop.storeValues.get(key)).toEqual(original);
    expect(localStorage.getItem(LS_PREFIX + key)).toBe(JSON.stringify(original));
  });
});
