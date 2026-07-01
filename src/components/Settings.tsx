import { useEffect, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { primeCesiumToken } from "../lib/cesium";
import { CESIUM_SIGNUP_URL, validateTrustedExternalUrl } from "../lib/external-links";
import { settings, type Theme, type ColormapId } from "../lib/settings";
import { downloadBlob } from "../lib/export";
import { applyTheme, setTheme } from "../lib/theme";
import { DEFAULT_STYLE, GLOBE_STYLES, type GlobeStyleId } from "../lib/globe-styles";
import { api, isTauri } from "../lib/tauri";
import { UiIcon } from "./UiIcon";

type GpuStatus = "available" | "no-adapter" | "feature-off" | "browser-preview" | "unknown";

type Props = { onClose: () => void };

export function Settings({ onClose }: Props) {
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [token, setTokenLocal] = useState("");
  const [theme, setThemeLocal] = useState<Theme>("mocha");
  const [globeStyle, setGlobeStyle] = useState<GlobeStyleId>(DEFAULT_STYLE);
  const [colormapId, setColormapId] = useState<ColormapId>("diverging");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [gpuStatus, setGpuStatus] = useState<GpuStatus>(isTauri() ? "unknown" : "browser-preview");

  useEffect(() => {
    let cancelled = false;
    settings.loadAll().then((s) => {
      if (cancelled) return;
      setTokenLocal(s.cesium_token);
      setThemeLocal(s.theme);
      setGlobeStyle(s.globe_style);
      setColormapId(s.colormap);
    });
    if (isTauri()) {
      api
        .gpuProbe()
        .then((s) => {
          if (!cancelled) setGpuStatus(s);
        })
        .catch(() => {
          if (!cancelled) setGpuStatus("unknown");
        });
    } else {
      setGpuStatus("browser-preview");
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveErr(null);
    const trimmedToken = token.trim();
    // Apply the token immediately so the next imagery request sees it,
    // even if the persistence write below races. This makes 'Save' feel
    // instant even on slow disks.
    primeCesiumToken(trimmedToken || null);
    try {
      await Promise.all([
        settings.setCesiumToken(trimmedToken),
        setTheme(theme),
        settings.setGlobeStyle(globeStyle),
        settings.setColormap(colormapId),
      ]);
      setStatusMsg(`Saved at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error("[settings] save failed", err);
      setSaveErr(String(err));
    } finally {
      setSaving(false);
    }
    // Always dispatch — Globe + main.tsx listen for this to re-read the
    // active style + token. Even if persistence failed the in-memory
    // values are still useful for the current session.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
    }
  }

  const needsToken = GLOBE_STYLES.find((s) => s.id === globeStyle)?.requires_token ?? false;

  function openCesiumSignup() {
    const validation = validateTrustedExternalUrl(CESIUM_SIGNUP_URL);
    if (!validation.ok) {
      setStatusMsg(`Cesium signup link blocked: ${validation.reason}`);
      return;
    }

    if (isTauri()) {
      openExternal(validation.url).catch((err) => {
        console.error("shell open failed", err);
        setStatusMsg("Cesium signup link could not be opened by the desktop shell policy.");
      });
    } else {
      window.open(validation.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" ref={dialogRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal__header">
          <h2 id="settings-title">Settings</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </header>
        <div className="modal__body">
          <section className="settings__section">
            <h3 className="settings__h3">Globe imagery</h3>
            <p className="modal__intro">
              Pick how the globe is rendered. The default
              (<strong>Natural Earth II</strong>) is local-first and reliable
              without network tiles. Online street, satellite, bathymetry, and
              terrain layers remain available when you want more context.
            </p>
            <select
              value={globeStyle}
              onChange={(e) => setGlobeStyle(e.target.value as GlobeStyleId)}
              aria-label="Globe imagery style"
            >
              {GLOBE_STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="modal__footnote settings__description">
              {GLOBE_STYLES.find((s) => s.id === globeStyle)?.description}
            </p>
          </section>

          <section className="settings__section">
            <h3 className="settings__h3">
              Cesium ion access token{!needsToken && " (optional)"}
            </h3>
            <p className="modal__intro">
              Optional. Only needed if you select a Cesium ion-backed globe
              style above (terrain, bathymetry, satellite imagery). Token is
              stored locally in your app data settings store in the desktop
              build, and in <code>localStorage</code> only for browser preview.
              It is never embedded in the binary or sent anywhere except{" "}
              <code>cesium.com</code>. Get a free token at{" "}
              <a
                href={CESIUM_SIGNUP_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  openCesiumSignup();
                }}
              >
                cesium.com/ion/signup
              </a>
              .
            </p>
            <label className="settings__field">
              <span>Access token</span>
              <input
                type="password"
                autoComplete="off"
                placeholder={needsToken ? "Required for this globe style..." : "Paste your token here (optional)..."}
                value={token}
                onChange={(e) => setTokenLocal(e.target.value)}
              />
            </label>
          </section>

          <section className="settings__section">
            <h3 className="settings__h3">Theme</h3>
            <div className="settings__theme-grid">
              <button
                className="scenario-tab"
                data-active={theme === "mocha" ? "true" : "false"}
                aria-pressed={theme === "mocha"}
                onClick={() => setThemeLocal("mocha")}
                type="button"
              >
                Catppuccin Mocha (dark)
              </button>
              <button
                className="scenario-tab"
                data-active={theme === "latte" ? "true" : "false"}
                aria-pressed={theme === "latte"}
                onClick={() => setThemeLocal("latte")}
                type="button"
              >
                Catppuccin Latte (light)
              </button>
            </div>
          </section>

          <section className="settings__section">
            <h3 className="settings__h3">Colormap</h3>
            <div className="settings__theme-grid">
              <button
                className="scenario-tab"
                data-active={colormapId === "diverging" ? "true" : "false"}
                aria-pressed={colormapId === "diverging"}
                onClick={() => setColormapId("diverging")}
                type="button"
              >
                Blue &rarr; Red (classic)
              </button>
              <button
                className="scenario-tab"
                data-active={colormapId === "cividis" ? "true" : "false"}
                aria-pressed={colormapId === "cividis"}
                onClick={() => setColormapId("cividis")}
                type="button"
              >
                Cividis (CVD-safe)
              </button>
              <button
                className="scenario-tab"
                data-active={colormapId === "viridis" ? "true" : "false"}
                aria-pressed={colormapId === "viridis"}
                onClick={() => setColormapId("viridis")}
                type="button"
              >
                Viridis (sequential)
              </button>
            </div>
          </section>

          <section className="settings__actions">
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save settings"}
            </button>
            {statusMsg && !saveErr && (
              <span className="settings__status" data-tone="success" role="status" aria-live="polite">
                {statusMsg}
              </span>
            )}
            {saveErr && (
              <span className="settings__status" data-tone="danger" role="alert">
                Save failed: {saveErr}
              </span>
            )}
          </section>

          <hr className="modal__sep" />

          <section className="settings__section">
            <h3 className="settings__h3">GPU acceleration (F4-01)</h3>
            <p className="modal__intro">
              The SWE leapfrog can run on the GPU via <code>wgpu</code> when
              the binary is built with <code>--features gpu</code>. Status
              is probed lazily on first Settings open.
            </p>
            <div className="settings__row">
              <strong>Status:</strong>{" "}
              {gpuStatus === "available" && (
                <span className="settings__status" data-tone="success">Available — simulations will use the GPU.</span>
              )}
              {gpuStatus === "no-adapter" && (
                <span className="settings__status" data-tone="warning">
                  No usable adapter — falling back to CPU. Check Vulkan/Metal/D3D12 drivers.
                </span>
              )}
              {gpuStatus === "feature-off" && (
                <span className="settings__status" data-tone="muted">
                  GPU feature not compiled in this build (CPU-only). Build with{" "}
                  <code>cargo tauri build -- --features gpu</code> to enable.
                </span>
              )}
              {gpuStatus === "browser-preview" && (
                <span className="settings__status" data-tone="muted">
                  Desktop build only — browser preview uses deterministic demo frames.
                </span>
              )}
              {gpuStatus === "unknown" && (
                <span className="settings__status" data-tone="muted">Checking hardware...</span>
              )}
            </div>
          </section>

          <section className="settings__section">
            <h3 className="settings__h3">Advanced</h3>
            <div className="settings__button-row">
              <button
                className="scenario-tab"
                onClick={async () => {
                  await settings.clearDisclaimerAck();
                  setStatusMsg("First-run notice will show on next launch.");
                }}
                type="button"
              >
                <UiIcon name="info" size={14} />
                Show first-run again
              </button>
              <button
                className="scenario-tab"
                onClick={async () => {
                  await settings.clearTourCompleted();
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
                  }
                  setStatusMsg("Tour will replay shortly.");
                  onClose();
                }}
                type="button"
              >
                <UiIcon name="refresh" size={14} />
                Replay tour
              </button>
              <button
                className="scenario-tab"
                onClick={async () => {
                  await settings.clearTokenBannerDismissed();
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
                  }
                  setStatusMsg("Imagery token banner re-armed.");
                }}
                type="button"
              >
                <UiIcon name="alert" size={14} />
                Show token banner again
              </button>
              <button
                className="scenario-tab"
                onClick={async () => {
                  const json = await settings.exportSettings();
                  const blob = new Blob([json], { type: "application/json" });
                  downloadBlob(blob, "tsunamisimulator-settings.json");
                  setStatusMsg("Settings exported.");
                }}
                type="button"
              >
                <UiIcon name="download" size={14} />
                Export settings
              </button>
              <button
                className="scenario-tab"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".json,application/json";
                  input.onchange = async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const result = await settings.importSettings(text);
                      const all = await settings.loadAll();
                      setThemeLocal(all.theme);
                      setGlobeStyle(all.globe_style);
                      setColormapId(all.colormap);
                      applyTheme(all.theme);
                      setSaveErr(null);
                      if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
                      }
                      const msg = result.skipped.length > 0
                        ? `Imported ${result.applied} settings (skipped: ${result.skipped.join(", ")}).`
                        : `Imported ${result.applied} settings.`;
                      setStatusMsg(msg);
                    } catch (err) {
                      setSaveErr(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
                    }
                  };
                  input.click();
                }}
                type="button"
              >
                <UiIcon name="folder" size={14} />
                Import settings
              </button>
              <button
                className="scenario-tab"
                data-tone="danger"
                onClick={async () => {
                  await settings.resetAll();
                  setTokenLocal("");
                  setThemeLocal("mocha");
                  setGlobeStyle(DEFAULT_STYLE);
                  setColormapId("diverging");
                  applyTheme("mocha");
                  primeCesiumToken(null);
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
                  }
                  setStatusMsg("Settings reset to defaults.");
                }}
                type="button"
              >
                <UiIcon name="reset" size={14} />
                Reset to defaults
              </button>
            </div>
          </section>

          <p className="modal__footnote">
            For evacuation warnings use <strong>NOAA NTWC / PTWC</strong> — this
            tool is for education and hazard awareness only.
          </p>
        </div>
      </div>
    </div>
  );
}
