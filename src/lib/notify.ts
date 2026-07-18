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
  if (document.hasFocus()) return;
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
}
