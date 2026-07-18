import { isTauri } from "./tauri";

let notificationModule: typeof import("@tauri-apps/plugin-notification") | null = null;

async function loadModule() {
  if (!isTauri()) return null;
  if (!notificationModule) {
    notificationModule = await import("@tauri-apps/plugin-notification");
  }
  return notificationModule;
}

export async function notifyRunComplete(title: string, body: string): Promise<void> {
  if (typeof document === "undefined" || document.hasFocus()) return;

  // Completion notifications are a best-effort convenience. A missing plugin
  // bridge, denied permission, or platform notification failure must never
  // surface as an unhandled rejection after an otherwise successful run.
  try {
    const mod = await loadModule();
    if (!mod) return;
    const { isPermissionGranted, requestPermission, sendNotification } = mod;
    let permitted = await isPermissionGranted();
    if (!permitted) {
      const result = await requestPermission();
      permitted = result === "granted";
    }
    if (permitted) {
      sendNotification({ title, body });
    }
  } catch {
    // Keep solver completion independent from optional OS notification state.
  }
}
