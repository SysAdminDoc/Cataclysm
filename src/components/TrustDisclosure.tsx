import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { validateCitationUrl } from "../lib/external-links";
import { isTauri } from "../lib/tauri";
import type { TrustEvidence } from "../lib/trust-evidence";

function currentOnlineState(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

export function TrustDisclosure({ evidence, compact = false }: { evidence: TrustEvidence; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(currentOnlineState);
  const [linkAlert, setLinkAlert] = useState<string | null>(null);
  const summaryStatus = compact
    ? evidence.confidence.startsWith("Waiting")
      ? "Waiting"
      : evidence.tone === "speculative"
        ? "What-if"
        : evidence.tone === "reference"
          ? "Reference"
          : evidence.tone === "validated"
            ? "Validated"
            : "Modelled"
    : evidence.confidence;

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
      setLinkAlert("Offline — the citation remains listed, but its external page cannot be opened.");
      return;
    }
    const validation = validateCitationUrl(url);
    if (!validation.ok) {
      setLinkAlert(`Blocked citation link. ${validation.reason}`);
      return;
    }
    setLinkAlert(null);
    if (isTauri()) {
      openExternal(validation.url).catch(() => {
        setLinkAlert("Citation link could not be opened by the desktop shell policy.");
      });
    } else {
      window.open(validation.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <details className="trust-disclosure" data-compact={compact ? "true" : "false"} data-tone={evidence.tone} data-evidence-id={evidence.id} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={`Why trust this? ${evidence.title}`}>
        <span>Why trust this?</span>
        <small>{summaryStatus}</small>
      </summary>
      {open && <div className="trust-disclosure__body">
        <dl className="trust-disclosure__meta">
          <div><dt>Source</dt><dd>{evidence.sourceTitle}</dd></div>
          <div><dt>Model</dt><dd>{evidence.model}</dd></div>
          <div><dt>Version</dt><dd>{evidence.version}</dd></div>
          <div><dt>Status</dt><dd>{evidence.confidence}</dd></div>
          <div><dt>Evidence ID</dt><dd><code>{evidence.id}</code></dd></div>
        </dl>
        <section aria-label="Key assumptions">
          <strong>Key assumptions</strong>
          <ul>{evidence.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
        </section>
        <section aria-label="Limitations">
          <strong>Limitations</strong>
          <ul>{evidence.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </section>
        <section aria-label="Citations">
          <strong>Exact citations</strong>
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
                    <button type="button" onClick={() => setLinkAlert(`Blocked citation link. ${validation && !validation.ok ? validation.reason : "Citation URL is invalid."}`)}>
                      {citation.label}
                    </button>
                  ) : (
                    <span>{citation.label}</span>
                  )}
                  <small data-link-state={citation.url ? validation?.ok ? validation.legacyHttp ? "legacy" : online ? "external" : "offline" : "blocked" : "bibliography"}>
                    {citation.url
                      ? validation?.ok
                        ? validation.legacyHttp
                          ? "Legacy HTTP"
                          : online ? "External" : "Offline"
                        : "Blocked"
                      : "Bibliography"}
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
