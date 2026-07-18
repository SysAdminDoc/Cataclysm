import { useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { validateCitationUrl, type ExternalUrlValidation } from "../lib/external-links";
import { api, isTauri } from "../lib/tauri";
import type { Preset } from "../types/scenario";
import { UiIcon } from "./UiIcon";
import { useI18n } from "../lib/i18n";

type Props = {
  presets: Preset[];
  onClose: () => void;
};

type Translate = ReturnType<typeof useI18n>["t"];

function validationMessage(validation: ExternalUrlValidation, t: Translate) {
  if (validation.ok) return undefined;
  const { reason } = validation;
  let localizedReason = reason;
  if (reason === "Citation has no URL.") localizedReason = t("citation.noUrl");
  else if (reason === "Citation URL is not valid.") localizedReason = t("citation.invalidUrl");
  else if (reason.startsWith("HTTPS citation URL is not in the allowlist: ")) {
    localizedReason = t("citation.httpsNotAllowed", { host: reason.split(": ").at(-1) ?? "" });
  } else if (reason.startsWith("HTTP citation URL is not an explicit legacy exception: ")) {
    localizedReason = t("citation.httpNotAllowed", { host: reason.split(": ").at(-1) ?? "" });
  } else if (reason.startsWith("Unsupported citation URL scheme: ")) {
    localizedReason = t("citation.unsupportedScheme", { scheme: reason.split(": ").at(-1) ?? "" });
  }
  return t("citation.blockedReason", { reason: localizedReason });
}

function openUrl(url: string, onBlocked: (message: string) => void, t: Translate) {
  const validation = validateCitationUrl(url);
  if (!validation.ok) {
    onBlocked(validationMessage(validation, t) ?? t("citation.blocked"));
    return;
  }

  if (isTauri()) {
    openExternal(validation.url).catch((err) => {
      console.error("shell open failed", err);
      onBlocked(t("citation.openFailed"));
    });
  } else {
    window.open(validation.url, "_blank", "noopener,noreferrer");
  }
}

export function CitationsModal({ presets, onClose }: Props) {
  const { t, formatNumber } = useI18n();
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [linkAlert, setLinkAlert] = useState<string | null>(null);
  const [notices, setNotices] = useState<string | null>(null);
  const [noticesError, setNoticesError] = useState<string | null>(null);
  const [noticesLoading, setNoticesLoading] = useState(false);
  const speculativeCount = presets.filter((p) => p.is_speculative).length;

  async function showThirdPartyNotices() {
    if (!isTauri()) return;
    setNoticesLoading(true);
    setNoticesError(null);
    try {
      setNotices(await api.thirdPartyNotices());
    } catch (error) {
      console.error("third-party notices could not be loaded", error);
      setNoticesError(t("citation.noticesError"));
    } finally {
      setNoticesLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" ref={dialogRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="citations-title">
        <div className="modal__header">
          <h2 id="citations-title">
            {notices ? t("citation.noticesTitle") : t("citation.title")}
          </h2>
          <button onClick={onClose} aria-label={t("citation.close")} className="modal__close" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <div className="modal__body">
          {notices ? (
            <>
              <div className="citations__notice-actions">
                <button className="secondary" type="button" onClick={() => setNotices(null)}>
                  {t("citation.back")}
                </button>
                <span>{t("citation.bundled")}</span>
              </div>
              <pre className="citations__notices" tabIndex={0}>{notices}</pre>
            </>
          ) : (
          <>
          <p className="modal__intro">{t("citation.intro")}</p>
          <div className="citations__summary" aria-label={t("citation.summary")}>
            <span><strong>{formatNumber(presets.length)}</strong> {t("citation.presetCount")}</span>
            <span><strong>{formatNumber(speculativeCount)}</strong> {t("citation.speculativeCount")}</span>
          </div>
          {linkAlert && (
            <div className="citations__alert" role="alert">
              {linkAlert}
            </div>
          )}
          <ul className="citations">
            {presets.map((p) => {
              const validation = validateCitationUrl(p.reference_url);
              return (
                <li key={p.id} className="citations__row">
                  <div className="citations__name">
                    {p.is_speculative && <span className="citations__tag">{t("citation.speculative")}</span>}
                    <span>{p.name}</span>
                    <span className="citations__date">{p.date}</span>
                  </div>
                  <div className="citations__ref">
                    {p.reference_url && validation.ok ? (
                      <a
                        href={validation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          openUrl(validation.url, setLinkAlert, t);
                        }}
                      >
                        <span>{p.reference}</span>
                        {validation.legacyHttp && <span className="citations__legacy">{t("citation.legacy")}</span>}
                        <span className="citations__open">{t("citation.open")}</span>
                      </a>
                    ) : p.reference_url ? (
                      <button
                        className="citations__blocked"
                        type="button"
                        onClick={() => setLinkAlert(validationMessage(validation, t) ?? t("citation.blocked"))}
                      >
                        <span>{p.reference}</span>
                        <span className="citations__open" data-tone="blocked">{t("citation.blocked")}</span>
                      </button>
                    ) : (
                      p.reference
                    )}
                  </div>
                  {p.controversy_note && (
                    <div className="citations__note">{p.controversy_note}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <hr className="modal__sep" />
          <p className="modal__footnote">
            {t("citation.bibtex")} <code>docs/science/REFERENCES.bib</code>. {t("citation.formulas")}{" "}
            <code>src-tauri/src/physics/</code> {t("citation.moduleBlocks")}
          </p>
          <div className="citations__notice-entry">
            <div>
              <strong>{t("citation.noticesTitle")}</strong>
              <span>{t("citation.noticesDescription")}</span>
            </div>
            <button
              className="secondary"
              type="button"
              disabled={!isTauri() || noticesLoading}
              onClick={() => void showThirdPartyNotices()}
            >
              {noticesLoading ? t("citation.noticesLoading") : t("citation.noticesView")}
            </button>
          </div>
          {!isTauri() && (
            <p className="citations__notice-help">{t("citation.noticesHelp")}</p>
          )}
          {noticesError && <div className="citations__alert" role="alert">{noticesError}</div>}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
