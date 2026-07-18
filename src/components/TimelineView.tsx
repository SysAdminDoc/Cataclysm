import { useMemo } from "react";
import type { Preset } from "../types/scenario";
import { useI18n } from "../lib/i18n";

type Props = {
  presets: Preset[];
  activeId: string | null;
  onSelect: (id: string) => void;
  busyId?: string | null;
};

type TimelineEntry = {
  preset: Preset;
  yearsAgo: number;
  label: string;
};

function parseDateToYearsAgo(date: string): number | null {
  if (!date || date === "-") return null;
  const maMatch = date.match(/^([\d.]+)\s*Ma$/i);
  if (maMatch) return parseFloat(maMatch[1]) * 1_000_000;
  const bpMatch = date.match(/^~?(\d+)\s*BP$/i);
  if (bpMatch) return parseInt(bpMatch[1], 10);
  const isoMatch = date.match(/^(\d{4})/);
  if (isoMatch) return new Date().getFullYear() - parseInt(isoMatch[1], 10);
  return null;
}

function formatAge(
  yearsAgo: number,
  formatNumber: ReturnType<typeof useI18n>["formatNumber"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (yearsAgo >= 1_000_000) return t("timeline.millionYears", { value: formatNumber(yearsAgo / 1_000_000, { minimumFractionDigits: yearsAgo >= 10_000_000 ? 0 : 1, maximumFractionDigits: yearsAgo >= 10_000_000 ? 0 : 1 }) });
  if (yearsAgo >= 1_000) return t("timeline.thousandYears", { value: formatNumber(yearsAgo / 1_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  if (yearsAgo <= 0) return t("timeline.now");
  return t("timeline.yearsAgo", { value: formatNumber(yearsAgo) });
}

export function TimelineView({ presets, activeId, onSelect, busyId }: Props) {
  const { t, formatNumber } = useI18n();
  const sourceLabel = (kind: Preset["source"]["kind"]) => kind === "Earthquake"
    ? t("source.earthquake")
    : kind === "Asteroid"
      ? t("source.asteroidImpact")
      : kind === "Nuclear"
        ? t("source.underwaterDetonation")
        : kind === "Meteotsunami"
          ? t("source.meteotsunami")
          : t("source.submarineLandslide");
  const entries = useMemo<TimelineEntry[]>(() => {
    const parsed: TimelineEntry[] = [];
    for (const p of presets) {
      const ya = parseDateToYearsAgo(p.date);
      if (ya === null) continue;
      parsed.push({ preset: p, yearsAgo: ya, label: formatAge(ya, formatNumber, t) });
    }
    parsed.sort((a, b) => b.yearsAgo - a.yearsAgo);
    return parsed;
  }, [formatNumber, presets, t]);

  if (entries.length === 0) return null;

  const maxLog = Math.log10(Math.max(...entries.map((e) => e.yearsAgo), 1));
  const minLog = Math.log10(Math.max(Math.min(...entries.map((e) => e.yearsAgo), 1), 0.1));
  const span = maxLog - minLog;
  const range = Math.max(span, 1);
  // When every entry shares one age (e.g. a single filtered result), the log
  // formula collapses all markers to 0%; distribute them evenly instead.
  const degenerate = span < 1e-9;

  return (
    <div className="timeline" role="group" aria-label={t("timeline.label")}>
      <div className="timeline__track">
        <div className="timeline__line" />
        {entries.map((e, idx) => {
          const pct = degenerate
            ? entries.length > 1
              ? (idx / (entries.length - 1)) * 100
              : 50
            : ((maxLog - Math.log10(Math.max(e.yearsAgo, 0.1))) / range) * 100;
          const position = Math.round(pct / 5) * 5;
          const isActive = activeId === e.preset.id;
          const isBusy = busyId === e.preset.id;
          const localizedSource = sourceLabel(e.preset.source.kind);
          return (
            <button
              key={e.preset.id}
              className="timeline__marker"
              data-active={isActive ? "true" : "false"}
              data-position={position}
              data-source={e.preset.source.kind}
              onClick={() => onSelect(e.preset.id)}
              disabled={isBusy}
              aria-label={t("timeline.eventAria", { name: e.preset.name, source: localizedSource, date: e.preset.date })}
              title={t("timeline.eventTitle", { name: e.preset.name, source: localizedSource, date: e.preset.date })}
              type="button"
            >
              <span
                className="timeline__dot"
                aria-hidden
              />
              <span className="timeline__label">
                <strong>{e.preset.name.split(/\s+/).slice(0, 2).join(" ")}</strong>
                <span>{localizedSource} · {isBusy ? "…" : e.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="timeline__axis">
        <span>{t("timeline.ancient")}</span>
        <span>{t("timeline.recent")}</span>
      </div>
    </div>
  );
}
