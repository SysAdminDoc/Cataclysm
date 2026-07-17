import { useMemo } from "react";
import type { Preset } from "../types/scenario";

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

const SOURCE_COLORS: Record<string, string> = {
  Asteroid: "var(--red)",
  Earthquake: "var(--teal)",
  Nuclear: "var(--mauve)",
  Landslide: "var(--peach)",
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

function formatAge(yearsAgo: number): string {
  if (yearsAgo >= 1_000_000) return `${(yearsAgo / 1_000_000).toFixed(yearsAgo >= 10_000_000 ? 0 : 1)} Ma`;
  if (yearsAgo >= 1_000) return `${(yearsAgo / 1_000).toFixed(1)}k yr`;
  if (yearsAgo <= 0) return "now";
  return `${yearsAgo} yr ago`;
}

export function TimelineView({ presets, activeId, onSelect, busyId }: Props) {
  const entries = useMemo<TimelineEntry[]>(() => {
    const parsed: TimelineEntry[] = [];
    for (const p of presets) {
      const ya = parseDateToYearsAgo(p.date);
      if (ya === null) continue;
      parsed.push({ preset: p, yearsAgo: ya, label: formatAge(ya) });
    }
    parsed.sort((a, b) => b.yearsAgo - a.yearsAgo);
    return parsed;
  }, [presets]);

  if (entries.length === 0) return null;

  const maxLog = Math.log10(Math.max(...entries.map((e) => e.yearsAgo), 1));
  const minLog = Math.log10(Math.max(Math.min(...entries.map((e) => e.yearsAgo), 1), 0.1));
  const span = maxLog - minLog;
  const range = Math.max(span, 1);
  // When every entry shares one age (e.g. a single filtered result), the log
  // formula collapses all markers to 0%; distribute them evenly instead.
  const degenerate = span < 1e-9;

  return (
    <div className="timeline" role="group" aria-label="Historical event timeline">
      <div className="timeline__track">
        <div className="timeline__line" />
        {entries.map((e, idx) => {
          const pct = degenerate
            ? entries.length > 1
              ? (idx / (entries.length - 1)) * 100
              : 50
            : ((maxLog - Math.log10(Math.max(e.yearsAgo, 0.1))) / range) * 100;
          const color = SOURCE_COLORS[e.preset.source.kind] ?? "var(--accent)";
          const isActive = activeId === e.preset.id;
          const isBusy = busyId === e.preset.id;
          return (
            <button
              key={e.preset.id}
              className="timeline__marker"
              data-active={isActive ? "true" : "false"}
              style={{ left: `${pct}%` }}
              onClick={() => onSelect(e.preset.id)}
              disabled={isBusy}
              aria-label={`${e.preset.name}, ${e.preset.source.kind} source, ${e.preset.date}`}
              title={`${e.preset.name} — ${e.preset.source.kind} source — ${e.preset.date}`}
              type="button"
            >
              <span
                className="timeline__dot"
                style={{ background: color, boxShadow: isActive ? `0 0 0 3px ${color}` : undefined }}
                aria-hidden
              />
              <span className="timeline__label">
                <strong>{e.preset.name.split(/\s+/).slice(0, 2).join(" ")}</strong>
                <span>{e.preset.source.kind} · {isBusy ? "..." : e.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="timeline__axis">
        <span>Ancient</span>
        <span>Recent</span>
      </div>
    </div>
  );
}
