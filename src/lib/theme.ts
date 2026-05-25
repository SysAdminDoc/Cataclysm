import { settings, type Theme } from "./settings";

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

export async function loadTheme(): Promise<Theme> {
  return settings.getTheme();
}

export async function setTheme(theme: Theme): Promise<void> {
  applyTheme(theme);
  await settings.setTheme(theme);
}
