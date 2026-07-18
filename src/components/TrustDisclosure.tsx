import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { validateCitationUrl } from "../lib/external-links";
import { isTauri } from "../lib/tauri";
import type { TrustEvidence } from "../lib/trust-evidence";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";

function currentOnlineState(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

const CONFIDENCE_KEYS: Record<string, MessageKey> = {
  "Exploratory what-if": "trust.exploratoryWhatIf",
  "Historical/reference scenario": "trust.referenceScenario",
  "User-defined inputs": "trust.userInputs",
  "Exploratory estimate": "trust.exploratoryEstimate",
  "Reference inputs; modelled outcome": "trust.referenceModelled",
  "User-input estimate": "trust.userEstimate",
  "Deterministic model output": "trust.deterministicOutput",
  "Scenario geometry": "trust.scenarioGeometry",
  "Reference geometry": "trust.referenceGeometry",
  "First-order analytical estimate": "trust.analyticalEstimate",
  "Numerically checked output": "trust.checkedOutput",
  "Per-point provenance; screening estimate": "trust.provenanceEstimate",
  "Community-mapped context; completeness varies": "trust.communityContext",
  "Observed reference series": "trust.observedSeries",
  "Waiting for a versioned result": "trust.waitingResult",
  "Deterministic screening geometry": "trust.screeningGeometry",
  "Waiting for prerequisite output": "trust.waitingPrerequisite",
};

export function TrustDisclosure({
  evidence,
  compact = false,
  compactStatus,
}: {
  evidence: TrustEvidence;
  compact?: boolean;
  compactStatus?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(currentOnlineState);
  const [linkAlert, setLinkAlert] = useState<string | null>(null);
  const localizedConfidence = CONFIDENCE_KEYS[evidence.confidence]
    ? t(CONFIDENCE_KEYS[evidence.confidence])
    : evidence.confidence;
  const summaryStatus = compactStatus ?? (compact
    ? evidence.confidence.startsWith("Waiting")
      ? t("trust.waiting")
      : evidence.tone === "speculative"
        ? t("trust.whatIf")
        : evidence.tone === "reference"
          ? t("trust.reference")
          : evidence.tone === "validated"
            ? t("trust.validated")
            : t("trust.modelled")
    : localizedConfidence);

  useEffect(() => {
    const update = () => setOnline(currentOnlineState());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  function openCitation(url: string) {
    if (!online) {
      setLinkAlert(t("trust.offlineCitation"));
      return;
    }
    const validation = validateCitationUrl(url);
    if (!validation.ok) {
      setLinkAlert(t("trust.blockedCitation", { reason: validation.reason }));
      return;
    }
    setLinkAlert(null);
    if (isTauri()) {
      openExternal(validation.url).catch(() => {
        setLinkAlert(t("trust.openFailed"));
      });
    } else {
      window.open(validation.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <details className="trust-disclosure" data-compact={compact ? "true" : "false"} data-tone={evidence.tone} data-evidence-id={evidence.id} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={t("trust.summaryAria", { title: evidence.title })}>
        <span>{t("trust.summary")}</span>
        <small>{summaryStatus}</small>
      </summary>
      {open && <div className="trust-disclosure__body">
        <dl className="trust-disclosure__meta">
          <div><dt>{t("trust.source")}</dt><dd>{evidence.sourceTitle}</dd></div>
          <div><dt>{t("trust.model")}</dt><dd>{evidence.model}</dd></div>
          <div><dt>{t("trust.version")}</dt><dd>{evidence.version}</dd></div>
          <div><dt>{t("trust.status")}</dt><dd>{localizedConfidence}</dd></div>
          <div><dt>{t("trust.evidenceId")}</dt><dd><code>{evidence.id}</code></dd></div>
        </dl>
        <section aria-label={t("trust.assumptions")}>
          <strong>{t("trust.assumptions")}</strong>
          <ul>{evidence.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
        </section>
        <section aria-label={t("trust.limitations")}>
          <strong>{t("trust.limitations")}</strong>
          <ul>{evidence.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </section>
        <section aria-label={t("trust.citations")}>
          <strong>{t("trust.exactCitations")}</strong>
          <ul className="trust-disclosure__citations">
            {evidence.citations.map((citation) => {
              const validation = citation.url ? validateCitationUrl(citation.url) : null;
              return (
                <li key={`${citation.label}:${citation.url ?? "bibliography"}`}>
                  {citation.url && validation?.ok ? (
                    <a href={validation.url} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); openCitation(validation.url); }}>
                      {citation.label}
                    </a>
                  ) : citation.url ? (
                    <button type="button" onClick={() => setLinkAlert(t("trust.blockedCitation", { reason: validation && !validation.ok ? validation.reason : t("trust.invalidCitation") }))}>
                      {citation.label}
                    </button>
                  ) : (
                    <span>{citation.label}</span>
                  )}
                  <small data-link-state={citation.url ? validation?.ok ? validation.legacyHttp ? "legacy" : online ? "external" : "offline" : "blocked" : "bibliography"}>
                    {citation.url
                      ? validation?.ok
                        ? validation.legacyHttp
                          ? t("trust.legacyHttp")
                          : online ? t("trust.external") : t("trust.offline")
                        : t("trust.blocked")
                      : t("trust.bibliography")}
                  </small>
                </li>
              );
            })}
          </ul>
        </section>
        {linkAlert && <p className="trust-disclosure__alert" role="alert">{linkAlert}</p>}
      </div>}
    </details>
  );
}
