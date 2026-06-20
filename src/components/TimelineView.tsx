import { useMemo } from "react";
import type { Preset } from "../types/scenario";

type Props = {
  presets: Preset[];
  activeId: string | null;
  onSelect: (id: string) => void;
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
  if (isoMatch) return 2026 - parseInt(isoMatch[1], 10);
  return null;
}

function formatAge(yearsAgo: number): string {
  if (yearsAgo >= 1_000_000) return `${(yearsAgo / 1_000_000).toFixed(yearsAgo >= 10_000_000 ? 0 : 1)} Ma`;
  if (yearsAgo >= 1_000) return `${(yearsAgo / 1_000).toFixed(1)}k yr`;
  if (yearsAgo <= 0) return "now";
  return `${yearsAgo} yr ago`;
}

export function TimelineView({ presets, activeId, onSelect }: Props) {
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
  const range = Math.max(maxLog - minLog, 1);

  return (
    <div className="timeline" role="list" aria-label="Historical event timeline">
      <div className="timeline__track">
        <div className="timeline__line" />
        {entries.map((e) => {
          const pct = ((maxLog - Math.log10(Math.max(e.yearsAgo, 0.1))) / range) * 100;
          const color = SOURCE_COLORS[e.preset.source.kind] ?? "var(--accent)";
          const isActive = activeId === e.preset.id;
          return (
            <button
              key={e.preset.id}
              role="listitem"
              className="timeline__marker"
              data-active={isActive ? "true" : "false"}
              style={{ left: `${pct}%` }}
              onClick={() => onSelect(e.preset.id)}
              title={`${e.preset.name} — ${e.preset.date}`}
              type="button"
            >
              <span
                className="timeline__dot"
                style={{ background: color, boxShadow: isActive ? `0 0 0 3px ${color}` : undefined }}
              />
              <span className="timeline__label">
                <strong>{e.preset.name.split(/\s+/).slice(0, 2).join(" ")}</strong>
                <span>{e.label}</span>
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
