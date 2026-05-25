import type { Preset } from "../types/scenario";

type Props = {
  presets: Preset[];
  activeId: string | null;
  onSelect: (id: string) => void;
  busyId?: string | null;
};

function sortKey(p: Preset): number {
  // Speculative scenarios sort after historical ones.
  return p.is_speculative ? 1 : 0;
}

export function PresetSelector({ presets, activeId, onSelect, busyId }: Props) {
  const sorted = [...presets].sort((a, b) => sortKey(a) - sortKey(b));
  return (
    <div className="section">
      <div className="section__title">Historical Presets</div>
      <div className="preset-list">
        {sorted.map((p) => {
          const isBusy = busyId === p.id;
          return (
            <button
              key={p.id}
              className="preset-card"
              data-active={activeId === p.id ? "true" : "false"}
              data-speculative={p.is_speculative ? "true" : "false"}
              onClick={() => onSelect(p.id)}
              disabled={isBusy}
              title={p.controversy_note ?? p.reference}
            >
              <div className="preset-card__name">
                {p.is_speculative && (
                  <span className="preset-card__warning" aria-label="Hypothetical / contested">⚠</span>
                )}
                {p.name}
                {isBusy && <span className="preset-card__busy" aria-label="Loading">…</span>}
              </div>
              <div className="preset-card__meta">{p.date}</div>
              <div className="preset-card__blurb">{p.blurb}</div>
              {p.is_speculative && p.controversy_note && (
                <div className="preset-card__warn-note">{p.controversy_note}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
