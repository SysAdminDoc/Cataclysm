import { useCallback, useEffect, useState } from "react";
import {
  CRASH_REPORT_CHANGED_EVENT,
  clearPersistedCrashReport,
  readPersistedCrashReport,
  type CrashReport,
} from "../lib/diagnosticsLog";
import { UiIcon } from "./UiIcon";

type Props = {
  onInspect: () => void;
};

export function CrashRecoveryNotice({ onInspect }: Props) {
  const [report, setReport] = useState<CrashReport | null>(() => readPersistedCrashReport());
  const refresh = useCallback(() => setReport(readPersistedCrashReport()), []);

  useEffect(() => {
    window.addEventListener(CRASH_REPORT_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CRASH_REPORT_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  if (!report || report.seen) return null;

  return (
    <div className="crash-recovery-notice" role="status" aria-live="polite">
      <span className="crash-recovery-notice__icon" aria-hidden>
        <UiIcon name="alert" size={15} />
      </span>
      <span>
        <strong>A report from the previous failure is available.</strong>{" "}
        Inspect the redacted evidence before clearing it.
      </span>
      <button className="crash-recovery-notice__inspect" type="button" onClick={onInspect}>
        Inspect report
      </button>
      <button
        className="crash-recovery-notice__clear"
        type="button"
        onClick={clearPersistedCrashReport}
      >
        Clear report
      </button>
    </div>
  );
}
