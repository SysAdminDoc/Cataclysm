import { useEffect, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { primeCesiumToken } from "../lib/cesium";
import { CESIUM_SIGNUP_URL, validateTrustedExternalUrl } from "../lib/external-links";
import { settings, type Theme, type ColormapId } from "../lib/settings";
import { downloadBlob } from "../lib/export";
import { applyTheme } from "../lib/theme";
import { DEFAULT_STYLE, GLOBE_STYLES, type GlobeStyleId } from "../lib/globe-styles";
import { api, isTauri } from "../lib/tauri";
import { getEarthAsset, getEarthProvider, getEarthStyleBinding } from "../lib/earth-assets";
import { UiIcon } from "./UiIcon";
import {
  RENDERER_QUALITY_BUDGETS,
  RENDERER_QUALITY_TIERS,
  type RendererQualityTier,
} from "../render/quality/quality-controller";

type GpuStatus = "available" | "no-adapter" | "feature-off" | "browser-preview" | "unknown";
type SettingsSection = "visual" | "performance" | "advanced";

type StagedSettings = {
  token: string;
  theme: Theme;
  globeStyle: GlobeStyleId;
  colormapId: ColormapId;
  rendererQuality: RendererQualityTier;
  rendererAutoQuality: boolean;
};

type Props = { onClose: () => void };

export function Settings({ onClose }: Props) {
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [token, setTokenLocal] = useState("");
  const [theme, setThemeLocal] = useState<Theme>("mocha");
  const [globeStyle, setGlobeStyle] = useState<GlobeStyleId>(DEFAULT_STYLE);
  const [colormapId, setColormapId] = useState<ColormapId>("diverging");
  const [rendererQuality, setRendererQuality] = useState<RendererQualityTier>("High");
  const [rendererAutoQuality, setRendererAutoQuality] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [gpuStatus, setGpuStatus] = useState<GpuStatus>(isTauri() ? "unknown" : "browser-preview");
  const [classroomLocked, setClassroomLocked] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("visual");
  const [appliedSettings, setAppliedSettings] = useState<StagedSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    settings.loadAll()
      .then((s) => {
        if (cancelled) return;
        setTokenLocal(s.cesium_token);
        setThemeLocal(s.theme);
        setGlobeStyle(s.globe_style);
        setColormapId(s.colormap);
        setRendererQuality(s.renderer_quality);
        setRendererAutoQuality(s.renderer_auto_quality);
        setClassroomLocked(s.classroom_locked);
        setAppliedSettings({
          token: s.cesium_token,
          theme: s.theme,
          globeStyle: s.globe_style,
          colormapId: s.colormap,
          rendererQuality: s.renderer_quality,
          rendererAutoQuality: s.renderer_auto_quality,
        });
      })
      .catch((err) => {
        if (!cancelled) setSaveErr(`Could not load settings: ${String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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
    try {
      await Promise.all([
        settings.setCesiumToken(trimmedToken),
        settings.setTheme(theme),
        settings.setGlobeStyle(globeStyle),
        settings.setColormap(colormapId),
        settings.setRendererQuality(rendererQuality),
        settings.setRendererAutoQuality(rendererAutoQuality),
      ]);
      setTokenLocal(trimmedToken);
      primeCesiumToken(trimmedToken || null);
      applyTheme(theme);
      setAppliedSettings({ token: trimmedToken, theme, globeStyle, colormapId, rendererQuality, rendererAutoQuality });
      setStatusMsg(`Changes applied at ${new Date().toLocaleTimeString()}`);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
      }
    } catch (err) {
      console.error("[settings] save failed", err);
      setSaveErr(String(err));
    } finally {
      setSaving(false);
    }
    // Always dispatch — Globe + main.tsx listen for this to re-read the
    // active style + token. Even if persistence failed the in-memory
    // values are still useful for the current session.
  }

  const needsToken = GLOBE_STYLES.find((s) => s.id === globeStyle)?.requires_token ?? false;
  const earthBinding = getEarthStyleBinding(globeStyle);
  const earthImagery = getEarthAsset(earthBinding.imagery_asset_id);
  const earthTerrain = getEarthAsset(earthBinding.terrain_asset_id);
  const earthProvider = getEarthProvider(earthImagery.provider_id);
  const earthTerrainProvider = getEarthProvider(earthTerrain.provider_id);
  const hasUnsavedChanges = appliedSettings !== null && (
    token !== appliedSettings.token
    || theme !== appliedSettings.theme
    || globeStyle !== appliedSettings.globeStyle
    || colormapId !== appliedSettings.colormapId
    || rendererQuality !== appliedSettings.rendererQuality
    || rendererAutoQuality !== appliedSettings.rendererAutoQuality
  );

  function handleBackdropClick() {
    if (hasUnsavedChanges) {
      setStatusMsg("Unsaved changes remain. Apply them or choose Cancel.");
      return;
    }
    onClose();
  }

  function openCesiumSignup() {
    openTrustedUrl(CESIUM_SIGNUP_URL, "Cesium signup");
  }

  function openTrustedUrl(url: string, label: string) {
    const validation = validateTrustedExternalUrl(url);
    if (!validation.ok) {
      setStatusMsg(`${label} link blocked: ${validation.reason}`);
      return;
    }

    if (isTauri()) {
      openExternal(validation.url).catch((err) => {
        console.error("shell open failed", err);
        setStatusMsg(`${label} link could not be opened by the desktop shell policy.`);
      });
    } else {
      window.open(validation.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className="modal modal--settings" data-loading={loading ? "true" : "false"} ref={dialogRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal__header">
          <h2 id="settings-title">Settings</h2>
          <button className="modal__close" onClick={onClose} aria-label="Cancel and close settings" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </header>
        <div className="modal__body settings__modal-body">
          {loading && <div className="settings__loading" role="status">Loading settings…</div>}
          {classroomLocked && (
            <div className="settings__classroom-note" role="note">
              <strong>Classroom profile active.</strong> Imagery, theme, and
              colormap are pinned by the imported teacher profile, and token
              entry is hidden. This is a convenience lock, not a security
              boundary.
              <button
                type="button"
                onClick={async () => {
                  await settings.setClassroomLocked(false);
                  setClassroomLocked(false);
                  setStatusMsg("Classroom profile unlocked.");
                }}
              >
                Unlock
              </button>
            </div>
          )}
          <div className="settings__workspace" inert={loading ? true : undefined}>
            <nav className="settings__nav" aria-label="Settings categories">
              <button type="button" aria-current={activeSection === "visual" ? "page" : undefined} onClick={() => setActiveSection("visual")}>Earth &amp; appearance</button>
              <button type="button" aria-current={activeSection === "performance" ? "page" : undefined} onClick={() => setActiveSection("performance")}>Simulation performance</button>
              <button type="button" aria-current={activeSection === "advanced" ? "page" : undefined} onClick={() => setActiveSection("advanced")}>Data &amp; onboarding</button>
            </nav>
            <div className="settings__content">
          {activeSection === "visual" && <>
          <section className="settings__section">
            <h3 className="settings__h3">Earth rendering</h3>
            <p className="modal__intro">
              Choose the visual map beneath the simulation. <strong>Natural
              Earth II</strong> is bundled and works offline; online street,
              satellite, bathymetry, and terrain maps provide more context.
            </p>
            <select
              value={globeStyle}
              onChange={(e) => setGlobeStyle(e.target.value as GlobeStyleId)}
              aria-label="Globe imagery style"
              disabled={classroomLocked}
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
            <div className="settings__source-card" role="group" aria-label="Selected Earth source provenance">
              <div className="settings__source-heading">
                <strong>Active source contract</strong>
                <span data-delivery={earthImagery.delivery}>{earthImagery.delivery}</span>
              </div>
              <dl className="settings__source-grid">
                <div><dt>Imagery</dt><dd>{earthProvider.name} · {earthImagery.role}</dd></div>
                <div><dt>Terrain</dt><dd>{earthTerrainProvider.name} · {earthTerrain.role}</dd></div>
                <div><dt>Coverage</dt><dd>{earthImagery.spatial.bounds.join("°, ")}° · {earthImagery.spatial.horizontal_crs}</dd></div>
                <div><dt>Vertical datum</dt><dd>{earthTerrain.spatial.vertical_datum}</dd></div>
                <div><dt>Resolution</dt><dd>{earthImagery.resolution.notes}</dd></div>
                <div><dt>Version</dt><dd>{earthImagery.version.provider_asset_id ?? earthImagery.version.upstream ?? earthImagery.version.package ?? "Mutable service"}</dd></div>
                <div><dt>Quality tiers</dt><dd>{earthImagery.quality_tiers.join(", ")}</dd></div>
                <div><dt>Attribution</dt><dd>{earthImagery.license.attribution_text}</dd></div>
                <div><dt>Rights review</dt><dd>Checked {earthProvider.policy_checked_at}; renew by {earthProvider.policy_review_by}</dd></div>
              </dl>
              <div className="settings__source-links">
                <a href={earthProvider.terms_url} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); openTrustedUrl(earthProvider.terms_url, `${earthProvider.name} terms`); }}>Provider terms</a>
                <a href={earthProvider.license_url} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); openTrustedUrl(earthProvider.license_url, `${earthProvider.name} license`); }}>License &amp; attribution</a>
                {earthTerrainProvider.id !== earthProvider.id && (
                  <a href={earthTerrain.license.url} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); openTrustedUrl(earthTerrain.license.url, `${earthTerrainProvider.name} terrain license`); }}>Terrain license</a>
                )}
              </div>
            </div>
          </section>

          {!classroomLocked && (
          <section className="settings__section">
            <h3 className="settings__h3">
              Online map access{!needsToken && " (optional)"}
            </h3>
            <p className="modal__intro">
              A Cesium ion token enables optional streamed terrain,
              bathymetry, and satellite imagery. The desktop app stores it in
              your operating system keychain and sends it only to{" "}
              <code>cesium.com</code>. Browser preview stores it locally in
              this browser.{" "}
              <a
                href={CESIUM_SIGNUP_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  openCesiumSignup();
                }}
              >
                Create a free Cesium ion token
              </a>
              .
            </p>
            <label className="settings__field">
              <span>Cesium ion token</span>
              <input
                type="password"
                autoComplete="off"
                placeholder={needsToken ? "Required for the selected map" : "Paste token (optional)"}
                value={token}
                onChange={(e) => setTokenLocal(e.target.value)}
              />
            </label>
          </section>
          )}

          <section className="settings__section">
            <h3 className="settings__h3">Theme</h3>
            <div className="settings__theme-grid">
              <button
                className="scenario-tab"
                data-active={theme === "mocha" ? "true" : "false"}
                aria-pressed={theme === "mocha"}
                onClick={() => setThemeLocal("mocha")}
                type="button"
                disabled={classroomLocked}
              >
                Catppuccin Mocha (dark)
              </button>
              <button
                className="scenario-tab"
                data-active={theme === "latte" ? "true" : "false"}
                aria-pressed={theme === "latte"}
                onClick={() => setThemeLocal("latte")}
                type="button"
                disabled={classroomLocked}
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
                disabled={classroomLocked}
              >
                Blue &rarr; Red (classic)
              </button>
              <button
                className="scenario-tab"
                data-active={colormapId === "cividis" ? "true" : "false"}
                aria-pressed={colormapId === "cividis"}
                onClick={() => setColormapId("cividis")}
                type="button"
                disabled={classroomLocked}
              >
                Cividis (CVD-safe)
              </button>
              <button
                className="scenario-tab"
                data-active={colormapId === "viridis" ? "true" : "false"}
                aria-pressed={colormapId === "viridis"}
                onClick={() => setColormapId("viridis")}
                type="button"
                disabled={classroomLocked}
              >
                Viridis (sequential)
              </button>
            </div>
          </section>
          </>}
          {activeSection === "performance" && (
          <>
          <section className="settings__section">
            <h3 className="settings__h3">Renderer quality budget</h3>
            <p className="modal__intro">
              Choose the maximum visual budget. Automatic control can step down one tier at a time when sustained frame time misses the target, then recover after headroom returns. Solver fields and event timing are never reduced.
            </p>
            <div className="settings__quality-grid" role="radiogroup" aria-label="Renderer quality tier">
              {RENDERER_QUALITY_TIERS.map((tier) => {
                const budget = RENDERER_QUALITY_BUDGETS[tier];
                return (
                  <button
                    key={tier}
                    className="settings__quality-card"
                    data-active={rendererQuality === tier ? "true" : "false"}
                    aria-checked={rendererQuality === tier}
                    role="radio"
                    type="button"
                    onClick={() => setRendererQuality(tier)}
                    disabled={classroomLocked}
                  >
                    <strong>{tier}</strong>
                    <span>{budget.resolution.width} x {budget.resolution.height} at {budget.targetFps} FPS</span>
                    <small>{budget.gpu.totalMemoryMb / 1024} GB GPU budget · {budget.features.msaaSamples}x MSAA · {budget.features.maximumParticles.toLocaleString()} particles</small>
                  </button>
                );
              })}
            </div>
            <label className="settings__toggle-row">
              <input
                type="checkbox"
                checked={rendererAutoQuality}
                onChange={(event) => setRendererAutoQuality(event.target.checked)}
                disabled={classroomLocked}
              />
              <span><strong>Automatic performance protection</strong><small>Uses rolling P95 frame time with hysteresis; never changes scientific data.</small></span>
            </label>
          </section>
          <section className="settings__section">
            <h3 className="settings__h3">Simulation acceleration</h3>
            <p className="modal__intro">
              The shallow-water solver can use a compatible graphics processor
              in accelerated desktop builds. Hardware is checked when this panel opens.
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
                  This desktop build uses the CPU. GPU acceleration is
                  available in accelerated builds.
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
          </>
          )}
          {activeSection === "advanced" && <>
          <section className="settings__section">
            <h3 className="settings__h3">Help &amp; onboarding</h3>
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
                  setStatusMsg("The online-map notice will appear again.");
                }}
                type="button"
              >
                <UiIcon name="alert" size={14} />
                Show online-map notice again
              </button>
            </div>
          </section>

          <section className="settings__section">
            <h3 className="settings__h3">Configuration data</h3>
            <p className="modal__intro">
              Export a portable settings file or restore one created by
              Cataclysm. Imported settings take effect immediately.
            </p>
            <div className="settings__button-row">
              <button
                className="scenario-tab"
                onClick={async () => {
                  const json = await settings.exportSettings();
                  const blob = new Blob([json], { type: "application/json" });
                  downloadBlob(blob, "cataclysm-settings.json");
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
                      if (file.size > 256 * 1024) throw new Error("Settings file exceeds the 256 KB import limit.");
                      const text = await file.text();
                      const result = await settings.importSettings(text);
                      const all = await settings.loadAll();
                      setTokenLocal(all.cesium_token);
                      setThemeLocal(all.theme);
                      setGlobeStyle(all.globe_style);
                      setColormapId(all.colormap);
                      setRendererQuality(all.renderer_quality);
                      setRendererAutoQuality(all.renderer_auto_quality);
                      setClassroomLocked(all.classroom_locked);
                      setAppliedSettings({
                        token: all.cesium_token,
                        theme: all.theme,
                        globeStyle: all.globe_style,
                        colormapId: all.colormap,
                        rendererQuality: all.renderer_quality,
                        rendererAutoQuality: all.renderer_auto_quality,
                      });
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
                  try {
                    await settings.resetAll();
                    setTokenLocal("");
                    setThemeLocal("mocha");
                    setGlobeStyle(DEFAULT_STYLE);
                    setColormapId("diverging");
                    setRendererQuality("High");
                    setRendererAutoQuality(true);
                    setClassroomLocked(false);
                    setAppliedSettings({
                      token: "",
                      theme: "mocha",
                      globeStyle: DEFAULT_STYLE,
                      colormapId: "diverging",
                      rendererQuality: "High",
                      rendererAutoQuality: true,
                    });
                    applyTheme("mocha");
                    primeCesiumToken(null);
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
                    }
                    setSaveErr(null);
                    setStatusMsg("Settings reset to defaults.");
                  } catch (err) {
                    setSaveErr(`Reset failed: ${err instanceof Error ? err.message : String(err)}`);
                  }
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
          </>}
            </div>
          </div>

          <section className="settings__actions settings__actions--footer">
            <div className="settings__footer-status" aria-live="polite">
              {hasUnsavedChanges && (
                <span className="settings__status" data-tone="warning">Unsaved changes</span>
              )}
              {statusMsg && !saveErr && (
                <span className="settings__footer-message" role="status">{statusMsg}</span>
              )}
              {saveErr && (
                <span className="settings__status" data-tone="danger" role="alert">
                  {saveErr.startsWith("Import failed:") ? saveErr : `Could not apply changes: ${saveErr}`}
                </span>
              )}
            </div>
            <div className="settings__footer-buttons">
              <button type="button" onClick={onClose}>Cancel</button>
              <button className="primary" type="button" onClick={save} disabled={loading || saving || !hasUnsavedChanges}>
                {saving ? "Applying Changes..." : "Apply Changes"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
