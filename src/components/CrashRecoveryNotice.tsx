import { useCallback, useEffect, useState } from "react";
import {
  CRASH_REPORT_CHANGED_EVENT,
  clearPersistedCrashReport,
  readPersistedCrashReport,
  type CrashReport,
} from "../lib/diagnosticsLog";
import { UiIcon } from "./UiIcon";
import { useI18n } from "../lib/i18n";

type Props = {
  onInspect: () => void;
};

export function CrashRecoveryNotice({ onInspect }: Props) {
  const { t } = useI18n();
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
        <strong>{t("crash.title")}</strong>{" "}
        {t("crash.body")}
      </span>
      <button className="crash-recovery-notice__inspect" type="button" onClick={onInspect}>
        {t("crash.inspect")}
      </button>
      <button
        className="crash-recovery-notice__clear"
        type="button"
        onClick={clearPersistedCrashReport}
      >
        {t("crash.clear")}
      </button>
    </div>
  );
}
