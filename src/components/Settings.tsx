import { useEffect, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { primeCesiumToken } from "../lib/cesium";
import { CESIUM_SIGNUP_URL, validateTrustedExternalUrl } from "../lib/external-links";
import { settings, type Theme, type ColormapId, type LaunchExperiencePolicy } from "../lib/settings";
import type { UnitSystem } from "../lib/units";
import { downloadBlob, type ExportResult } from "../lib/export";
import { applyTheme } from "../lib/theme";
import { DEFAULT_STYLE, GLOBE_STYLES, type GlobeStyleId } from "../lib/globe-styles";
import { api, isTauri } from "../lib/tauri";
import { getEarthAsset, getEarthProvider, getEarthStyleBinding } from "../lib/earth-assets";
import { REPLAY_DISCLAIMER_EVENT } from "./FirstRunDisclaimer";
import { UiIcon } from "./UiIcon";
import { BathymetryImportPanel } from "./BathymetryImportPanel";
import {
  RENDERER_QUALITY_BUDGETS,
  RENDERER_QUALITY_TIERS,
  type RendererQualityTier,
} from "../render/quality/quality-controller";
import { useI18n } from "../lib/i18n";
import { LANGUAGE_TAGS, LOCALE_OPTIONS, translate, type Locale, type MessageKey } from "../lib/i18n-core";

type GpuStatus = "available" | "no-adapter" | "feature-off" | "browser-preview" | "unknown";
type SettingsSection = "visual" | "performance" | "advanced";

type StagedSettings = {
  token: string;
  theme: Theme;
  locale: Locale;
  units: UnitSystem;
  globeStyle: GlobeStyleId;
  colormapId: ColormapId;
  rendererQuality: RendererQualityTier;
  rendererAutoQuality: boolean;
  launchExperiencePolicy: LaunchExperiencePolicy;
};

type Props = { onClose: () => void };

export function Settings({ onClose }: Props) {
  const { formatNumber, t } = useI18n();
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [token, setTokenLocal] = useState("");
  const [theme, setThemeLocal] = useState<Theme>("mocha");
  const [locale, setLocale] = useState<Locale>("en");
  const [units, setUnitsLocal] = useState<UnitSystem>("metric");
  const [globeStyle, setGlobeStyle] = useState<GlobeStyleId>(DEFAULT_STYLE);
  const [colormapId, setColormapId] = useState<ColormapId>("diverging");
  const [rendererQuality, setRendererQuality] = useState<RendererQualityTier>("High");
  const [rendererAutoQuality, setRendererAutoQuality] = useState(true);
  const [launchExperiencePolicy, setLaunchExperiencePolicy] = useState<LaunchExperiencePolicy>("first");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [settingsExportFailure, setSettingsExportFailure] = useState<Extract<ExportResult, { ok: false }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [gpuStatus, setGpuStatus] = useState<GpuStatus>(isTauri() ? "unknown" : "browser-preview");
  const [classroomLocked, setClassroomLocked] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("visual");
  const [appliedSettings, setAppliedSettings] = useState<StagedSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const handleSettingsExport = async () => {
    let result: ExportResult;
    try {
      const json = await settings.exportSettings();
      const blob = new Blob([json], { type: "application/json" });
      result = downloadBlob(blob, "cataclysm-settings.json");
    } catch (error) {
      result = {
        ok: false,
        code: "filesystem",
        message: translate(locale, "settings.exportReadFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        retryable: true,
      };
    }
    setSettingsExportFailure(result.ok ? null : result);
    if (result.ok) setStatusMsg(translate(locale, "settings.exported"));
  };

  useEffect(() => {
    let cancelled = false;
    settings.loadAll()
      .then((s) => {
        if (cancelled) return;
        setTokenLocal(s.cesium_token);
        setThemeLocal(s.theme);
        setLocale(s.locale);
        setUnitsLocal(s.units);
        setGlobeStyle(s.globe_style);
        setColormapId(s.colormap);
        setRendererQuality(s.renderer_quality);
        setRendererAutoQuality(s.renderer_auto_quality);
        setLaunchExperiencePolicy(s.launch_experience_policy);
        setClassroomLocked(s.classroom_locked);
        setAppliedSettings({
          token: s.cesium_token,
          theme: s.theme,
          locale: s.locale,
          units: s.units,
          globeStyle: s.globe_style,
          colormapId: s.colormap,
          rendererQuality: s.renderer_quality,
          rendererAutoQuality: s.renderer_auto_quality,
          launchExperiencePolicy: s.launch_experience_policy,
        });
      })
      .catch((err) => {
        console.warn("[settings] failed to load", err);
        if (!cancelled) {
          const detail = err instanceof Error ? `${err.message} ` : "";
          setSaveErr(t("settings.loadFailed", { detail }));
          setAppliedSettings({
            token: "",
            theme: "mocha",
            locale: "en",
            units: "metric",
            globeStyle: DEFAULT_STYLE,
            colormapId: "diverging",
            rendererQuality: "High",
            rendererAutoQuality: true,
            launchExperiencePolicy: "first",
          });
        }
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
  }, [t]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveErr(null);
    setStatusMsg(null);
    const trimmedToken = token.trim();
    try {
      const patch: Parameters<typeof settings.apply>[0] = {
        theme,
        locale,
        units,
        globe_style: globeStyle,
        colormap: colormapId,
        renderer_quality: rendererQuality,
        renderer_auto_quality: rendererAutoQuality,
        launch_experience_policy: launchExperiencePolicy,
      };
      if (appliedSettings === null || trimmedToken !== appliedSettings.token) {
        patch.cesium_token = trimmedToken;
      }
      await settings.apply(patch);
      setTokenLocal(trimmedToken);
      primeCesiumToken(trimmedToken || null);
      applyTheme(theme);
      setAppliedSettings({ token: trimmedToken, theme, locale, units, globeStyle, colormapId, rendererQuality, rendererAutoQuality, launchExperiencePolicy });
      setStatusMsg(translate(locale, "settings.applied", { time: new Date().toLocaleTimeString(LANGUAGE_TAGS[locale]) }));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
      }
    } catch (err) {
      console.error("[settings] save failed", err);
      setSaveErr(translate(locale, "settings.applyFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSaving(false);
    }
  }

  const needsToken = GLOBE_STYLES.find((s) => s.id === globeStyle)?.requires_token ?? false;
  const earthBinding = getEarthStyleBinding(globeStyle);
  const earthImagery = getEarthAsset(earthBinding.imagery_asset_id);
  const earthTerrain = getEarthAsset(earthBinding.terrain_asset_id);
  const earthProvider = getEarthProvider(earthImagery.provider_id);
  const earthTerrainProvider = getEarthProvider(earthTerrain.provider_id);
  const localizedGlobeStyles = GLOBE_STYLES.map((style) => {
    switch (style.id) {
      case "natural-earth-2": return { ...style, label: t("style.naturalLabel"), description: t("style.naturalDescription") };
      case "osm": return { ...style, label: t("style.osmLabel"), description: t("style.osmDescription") };
      case "esri-world-imagery": return { ...style, label: t("style.esriLabel"), description: t("style.esriDescription") };
      case "cesium-world-imagery": return { ...style, label: t("style.cesiumLabel"), description: t("style.cesiumDescription") };
      case "cesium-bathymetry": return { ...style, label: t("style.bathymetryLabel"), description: t("style.bathymetryDescription") };
    }
  });
  const hasUnsavedChanges = appliedSettings !== null && (
    token !== appliedSettings.token
    || theme !== appliedSettings.theme
    || locale !== appliedSettings.locale
    || units !== appliedSettings.units
    || globeStyle !== appliedSettings.globeStyle
    || colormapId !== appliedSettings.colormapId
    || rendererQuality !== appliedSettings.rendererQuality
    || rendererAutoQuality !== appliedSettings.rendererAutoQuality
    || launchExperiencePolicy !== appliedSettings.launchExperiencePolicy
  );

  function handleBackdropClick() {
    if (hasUnsavedChanges) {
      setStatusMsg(t("settings.unsavedBody"));
      return;
    }
    onClose();
  }

  function openCesiumSignup() {
    openTrustedUrl(CESIUM_SIGNUP_URL, t("settings.signup"));
  }

  function openTrustedUrl(url: string, label: string) {
    const validation = validateTrustedExternalUrl(url);
    if (!validation.ok) {
      setStatusMsg(t("settings.linkBlocked", { label, reason: validation.reason }));
      return;
    }

    if (isTauri()) {
      openExternal(validation.url).catch((err) => {
        console.error("shell open failed", err);
        setStatusMsg(t("settings.linkFailed", { label }));
      });
    } else {
      window.open(validation.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className="modal modal--settings" data-loading={loading ? "true" : "false"} ref={dialogRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal__header">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button className="modal__close" onClick={onClose} aria-label={t("settings.close")} type="button">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <div className="modal__body settings__modal-body">
          {loading && <div className="settings__loading" role="status">{t("settings.loading")}</div>}
          {classroomLocked && (
            <div className="settings__classroom-note" role="note">
              <strong>{t("settings.classroomTitle")}</strong> {t("settings.classroomBody")}
              <button
                type="button"
                onClick={async () => {
                  await settings.setClassroomLocked(false);
                  setClassroomLocked(false);
                  setStatusMsg(t("settings.unlocked"));
                }}
              >
                {t("settings.unlock")}
              </button>
            </div>
          )}
          <div className="settings__workspace" inert={loading ? true : undefined}>
            <nav className="settings__nav" aria-label={t("settings.categories")}>
              <button type="button" aria-current={activeSection === "visual" ? "page" : undefined} onClick={() => setActiveSection("visual")}>{t("settings.visual")}</button>
              <button type="button" aria-current={activeSection === "performance" ? "page" : undefined} onClick={() => setActiveSection("performance")}>{t("settings.performance")}</button>
              <button type="button" aria-current={activeSection === "advanced" ? "page" : undefined} onClick={() => setActiveSection("advanced")}>{t("settings.advanced")}</button>
            </nav>
            <div className="settings__content">
          {activeSection === "visual" && <>
          <section className="settings__section">
            <h3 className="settings__h3">{t("language.heading")}</h3>
            <p className="modal__intro">{t("language.description")}</p>
            <label className="settings__field">
              <span>{t("language.label")}</span>
              <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
                {LOCALE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id} lang={option.id}>
                    {option.nativeName}
                  </option>
                ))}
              </select>
            </label>
            <p className="modal__footnote settings__description">{t("language.canonical")}</p>
          </section>
          <section className="settings__section">
            <h3 className="settings__h3">{t("units.heading")}</h3>
            <p className="modal__intro">{t("units.description")}</p>
            <label className="settings__field">
              <span>{t("units.label")}</span>
              <select value={units} onChange={(event) => setUnitsLocal(event.target.value as UnitSystem)}>
                <option value="metric">{t("units.metric")}</option>
                <option value="imperial">{t("units.imperial")}</option>
              </select>
            </label>
          </section>
          <section className="settings__section">
            <h3 className="settings__h3">{t("settings.earthRendering")}</h3>
            <p className="modal__intro">{t("settings.earthIntro")}</p>
            <select
              value={globeStyle}
              onChange={(e) => setGlobeStyle(e.target.value as GlobeStyleId)}
              aria-label={t("settings.globeStyle")}
              disabled={classroomLocked}
            >
              {localizedGlobeStyles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="modal__footnote settings__description">
              {localizedGlobeStyles.find((s) => s.id === globeStyle)?.description}
            </p>
            <div className="settings__source-card" role="group" aria-label={t("settings.provenance")}>
              <div className="settings__source-heading">
                <strong>{t("settings.activeContract")}</strong>
                <span data-delivery={earthImagery.delivery}>{earthImagery.delivery}</span>
              </div>
              <dl className="settings__source-grid">
                <div><dt>{t("settings.imagery")}</dt><dd>{earthProvider.name} · {earthImagery.role}</dd></div>
                <div><dt>{t("settings.terrain")}</dt><dd>{earthTerrainProvider.name} · {earthTerrain.role}</dd></div>
                <div><dt>{t("settings.coverage")}</dt><dd>{earthImagery.spatial.bounds.join("°, ")}° · {earthImagery.spatial.horizontal_crs}</dd></div>
                <div><dt>{t("settings.verticalDatum")}</dt><dd>{earthTerrain.spatial.vertical_datum}</dd></div>
                <div><dt>{t("settings.resolution")}</dt><dd>{earthImagery.resolution.notes}</dd></div>
                <div><dt>{t("settings.version")}</dt><dd>{earthImagery.version.provider_asset_id ?? earthImagery.version.upstream ?? earthImagery.version.package ?? t("settings.mutableService")}</dd></div>
                <div><dt>{t("settings.qualityTiers")}</dt><dd>{earthImagery.quality_tiers.join(", ")}</dd></div>
                <div><dt>{t("settings.attribution")}</dt><dd>{earthImagery.license.attribution_text}</dd></div>
                <div><dt>{t("settings.rightsReview")}</dt><dd>{t("settings.rightsChecked", { checked: earthProvider.policy_checked_at, renew: earthProvider.policy_review_by })}</dd></div>
              </dl>
              <div className="settings__source-links">
                <a href={earthProvider.terms_url} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); openTrustedUrl(earthProvider.terms_url, `${earthProvider.name} ${t("settings.providerTerms")}`); }}>{t("settings.providerTerms")}</a>
                <a href={earthProvider.license_url} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); openTrustedUrl(earthProvider.license_url, `${earthProvider.name} ${t("settings.licenseAttribution")}`); }}>{t("settings.licenseAttribution")}</a>
                {earthTerrainProvider.id !== earthProvider.id && (
                  <a href={earthTerrain.license.url} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); openTrustedUrl(earthTerrain.license.url, `${earthTerrainProvider.name} ${t("settings.terrainLicense")}`); }}>{t("settings.terrainLicense")}</a>
                )}
              </div>
            </div>
          </section>

          {!classroomLocked && (
          <section className="settings__section">
            <h3 className="settings__h3">
              {t("settings.onlineAccess")}{!needsToken && ` (${t("settings.optional")})`}
            </h3>
            <p className="modal__intro">
              {t("settings.onlineIntro")}{" "}
              <a
                href={CESIUM_SIGNUP_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  openCesiumSignup();
                }}
              >
                {t("settings.createToken")}
              </a>
              .
            </p>
            <label className="settings__field">
              <span>{t("settings.token")}</span>
              <input
                type="password"
                autoComplete="off"
                placeholder={needsToken ? t("settings.tokenRequired") : t("settings.tokenOptional")}
                value={token}
                onChange={(e) => setTokenLocal(e.target.value)}
              />
            </label>
          </section>
          )}

          <section className="settings__section">
            <h3 className="settings__h3">{t("settings.theme")}</h3>
            <div className="settings__theme-grid">
              <button
                className="scenario-tab"
                data-active={theme === "mocha" ? "true" : "false"}
                aria-pressed={theme === "mocha"}
                onClick={() => setThemeLocal("mocha")}
                type="button"
                disabled={classroomLocked}
              >
                {t("settings.mocha")}
              </button>
              <button
                className="scenario-tab"
                data-active={theme === "latte" ? "true" : "false"}
                aria-pressed={theme === "latte"}
                onClick={() => setThemeLocal("latte")}
                type="button"
                disabled={classroomLocked}
              >
                {t("settings.latte")}
              </button>
            </div>
          </section>

          <section className="settings__section">
            <h3 className="settings__h3">{t("settings.colormap")}</h3>
            <div className="settings__theme-grid">
              <button
                className="scenario-tab"
                data-active={colormapId === "diverging" ? "true" : "false"}
                aria-pressed={colormapId === "diverging"}
                onClick={() => setColormapId("diverging")}
                type="button"
                disabled={classroomLocked}
              >
                {t("settings.blueRed")}
              </button>
              <button
                className="scenario-tab"
                data-active={colormapId === "cividis" ? "true" : "false"}
                aria-pressed={colormapId === "cividis"}
                onClick={() => setColormapId("cividis")}
                type="button"
                disabled={classroomLocked}
              >
                {t("settings.cividis")}
              </button>
              <button
                className="scenario-tab"
                data-active={colormapId === "viridis" ? "true" : "false"}
                aria-pressed={colormapId === "viridis"}
                onClick={() => setColormapId("viridis")}
                type="button"
                disabled={classroomLocked}
              >
                {t("settings.viridis")}
              </button>
            </div>
          </section>
          </>}
          {activeSection === "performance" && (
          <>
          <section className="settings__section">
            <h3 className="settings__h3">{t("settings.qualityBudget")}</h3>
            <p className="modal__intro">{t("settings.qualityIntro")}</p>
            <div className="settings__quality-grid" role="radiogroup" aria-label={t("settings.qualityTier")}>
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
                    tabIndex={rendererQuality === tier ? 0 : -1}
                    onClick={() => setRendererQuality(tier)}
                    onKeyDown={(event) => {
                      const currentIndex = RENDERER_QUALITY_TIERS.indexOf(tier);
                      let nextIndex: number | null = null;
                      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                        nextIndex = (currentIndex + 1) % RENDERER_QUALITY_TIERS.length;
                      }
                      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                        nextIndex = (currentIndex - 1 + RENDERER_QUALITY_TIERS.length) % RENDERER_QUALITY_TIERS.length;
                      }
                      if (event.key === "Home") nextIndex = 0;
                      if (event.key === "End") nextIndex = RENDERER_QUALITY_TIERS.length - 1;
                      if (nextIndex === null) return;
                      event.preventDefault();
                      setRendererQuality(RENDERER_QUALITY_TIERS[nextIndex]);
                      const radios = event.currentTarget.parentElement
                        ?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                      radios?.[nextIndex]?.focus();
                    }}
                    disabled={classroomLocked}
                  >
                    <strong>{tier}</strong>
                    <span>{t("settings.qualitySummary", { width: budget.resolution.width, height: budget.resolution.height, fps: budget.targetFps })}</span>
                    <small>{t("settings.qualityDetail", { memory: budget.gpu.totalMemoryMb / 1024, msaa: budget.features.msaaSamples, particles: formatNumber(budget.features.maximumParticles) })}</small>
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
              <span><strong>{t("settings.autoPerformance")}</strong><small>{t("settings.autoPerformanceBody")}</small></span>
            </label>
          </section>
          <section className="settings__section">
            <h3 className="settings__h3">{t("settings.acceleration")}</h3>
            <p className="modal__intro">{t("settings.accelerationIntro")}</p>
            <div className="settings__row">
              <strong>{t("settings.status")}</strong>{" "}
              {gpuStatus === "available" && (
                <span className="settings__status" data-tone="success">{t("settings.gpuAvailable")}</span>
              )}
              {gpuStatus === "no-adapter" && (
                <span className="settings__status" data-tone="warning">
                  {t("settings.gpuNoAdapter")}
                </span>
              )}
              {gpuStatus === "feature-off" && (
                <span className="settings__status" data-tone="muted">
                  {t("settings.gpuFeatureOff")}
                </span>
              )}
              {gpuStatus === "browser-preview" && (
                <span className="settings__status" data-tone="muted">
                  {t("settings.gpuBrowser")}
                </span>
              )}
              {gpuStatus === "unknown" && (
                <span className="settings__status" data-tone="muted">{t("settings.gpuChecking")}</span>
              )}
            </div>
          </section>
          </>
          )}
          {activeSection === "advanced" && <>
          <BathymetryImportPanel />
          <section className="settings__section">
            <h3 className="settings__h3">{t("settings.help")}</h3>
            <label className="settings__field">
              <span>{t("settings.launchCinematic")}</span>
              <select
                value={launchExperiencePolicy}
                onChange={(event) => setLaunchExperiencePolicy(event.target.value as LaunchExperiencePolicy)}
              >
                <option value="first">{t("settings.firstLaunch")}</option>
                <option value="always">{t("settings.everyLaunch")}</option>
                <option value="never">{t("settings.never")}</option>
              </select>
            </label>
            <p className="modal__footnote settings__description">
              {t("settings.launchBody")}
            </p>
            <div className="settings__button-row">
              <button
                className="scenario-tab"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("cataclysm:preview-launch"));
                  onClose();
                }}
                type="button"
              >
                <UiIcon name="play" size={14} />
                {t("settings.previewCinematic")}
              </button>
              <button
                className="scenario-tab"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent(REPLAY_DISCLAIMER_EVENT));
                  setStatusMsg(t("settings.noticeReopened"));
                  onClose();
                }}
                type="button"
              >
                <UiIcon name="info" size={14} />
                {t("settings.replayNotice")}
              </button>
              <button
                className="scenario-tab"
                onClick={async () => {
                  await settings.clearTourCompleted();
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("tsunamisim:tour-requested"));
                  }
                  setStatusMsg(t("settings.tourReplay"));
                  onClose();
                }}
                type="button"
              >
                <UiIcon name="refresh" size={14} />
                {t("settings.replayTour")}
              </button>
              <button
                className="scenario-tab"
                onClick={async () => {
                  await settings.clearTokenBannerDismissed();
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
                  }
                  setStatusMsg(t("settings.mapNoticeAgain"));
                }}
                type="button"
              >
                <UiIcon name="alert" size={14} />
                {t("settings.showMapNotice")}
              </button>
            </div>
          </section>

          <section className="settings__section">
            <h3 className="settings__h3">{t("settings.configuration")}</h3>
            <p className="modal__intro">{t("settings.configurationBody")}</p>
            <div className="settings__button-row">
              <button
                className="scenario-tab"
                onClick={() => void handleSettingsExport()}
                type="button"
              >
                <UiIcon name="download" size={14} />
                {t("settings.export")}
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
                      if (file.size > 256 * 1024) throw new Error(t("settings.fileTooLarge"));
                      const text = await file.text();
                      const result = await settings.importSettings(text);
                      const all = await settings.loadAll();
                      setTokenLocal(all.cesium_token);
                      setThemeLocal(all.theme);
                      setLocale(all.locale);
                      setUnitsLocal(all.units);
                      setGlobeStyle(all.globe_style);
                      setColormapId(all.colormap);
                      setRendererQuality(all.renderer_quality);
                      setRendererAutoQuality(all.renderer_auto_quality);
                      setLaunchExperiencePolicy(all.launch_experience_policy);
                      setClassroomLocked(all.classroom_locked);
                      setAppliedSettings({
                        token: all.cesium_token,
                        theme: all.theme,
                        locale: all.locale,
                        units: all.units,
                        globeStyle: all.globe_style,
                        colormapId: all.colormap,
                        rendererQuality: all.renderer_quality,
                        rendererAutoQuality: all.renderer_auto_quality,
                        launchExperiencePolicy: all.launch_experience_policy,
                      });
                      applyTheme(all.theme);
                      setSaveErr(null);
                      if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
                      }
                      const msg = result.skipped.length > 0
                        ? translate(all.locale, "settings.importedSkipped", { count: result.applied, skipped: result.skipped.join(", ") })
                        : translate(all.locale, "settings.imported", { count: result.applied });
                      setStatusMsg(msg);
                    } catch (err) {
                      setSaveErr(translate(locale, "settings.importFailed", { error: err instanceof Error ? err.message : String(err) }));
                    }
                  };
                  input.click();
                }}
                type="button"
              >
                <UiIcon name="folder" size={14} />
                {t("settings.import")}
              </button>
              <button
                className="scenario-tab"
                data-tone="danger"
                onClick={async () => {
                  try {
                    await settings.resetAll();
                    setTokenLocal("");
                    setThemeLocal("mocha");
                    setLocale("en");
                    setUnitsLocal("metric");
                    setGlobeStyle(DEFAULT_STYLE);
                    setColormapId("diverging");
                    setRendererQuality("High");
                    setRendererAutoQuality(true);
                    setLaunchExperiencePolicy("first");
                    setClassroomLocked(false);
                    setAppliedSettings({
                      token: "",
                      theme: "mocha",
                      locale: "en",
                      units: "metric",
                      globeStyle: DEFAULT_STYLE,
                      colormapId: "diverging",
                      rendererQuality: "High",
                      rendererAutoQuality: true,
                      launchExperiencePolicy: "first",
                    });
                    applyTheme("mocha");
                    primeCesiumToken(null);
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
                    }
                    setSaveErr(null);
                    setStatusMsg(translate(locale, "settings.resetDone"));
                  } catch (err) {
                    setSaveErr(translate(locale, "settings.resetFailed", { error: err instanceof Error ? err.message : String(err) }));
                  }
                }}
                type="button"
              >
                <UiIcon name="reset" size={14} />
                {t("settings.reset")}
              </button>
            </div>
            {settingsExportFailure && (
              <div className="panel-error" role="alert">
                <span>{translate(locale, `app.export.failure.${settingsExportFailure.code}` as MessageKey)}: {settingsExportFailure.message}</span>
                {settingsExportFailure.retryable && (
                  <button type="button" onClick={() => void handleSettingsExport()}>{t("settings.retry")}</button>
                )}
              </div>
            )}
          </section>

          <p className="modal__footnote">
            {t("settings.safety")}
          </p>
          </>}
            </div>
          </div>

          <section className="settings__actions settings__actions--footer">
            <div className="settings__footer-status" aria-live="polite">
              {hasUnsavedChanges && (
                <span className="settings__status" data-tone="warning">{t("settings.unsaved")}</span>
              )}
              {statusMsg && !saveErr && (
                <span className="settings__footer-message" role="status">{statusMsg}</span>
              )}
              {saveErr && (
                <span className="settings__status" data-tone="danger" role="alert">
                  {saveErr}
                </span>
              )}
            </div>
            <div className="settings__footer-buttons">
              <button type="button" onClick={onClose}>{t("settings.cancel")}</button>
              <button className="primary" type="button" onClick={save} disabled={loading || saving || !hasUnsavedChanges}>
                {saving ? t("settings.applying") : t("settings.apply")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
