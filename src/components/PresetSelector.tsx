import type { Preset } from "../types/scenario";

type Props = {
  presets: Preset[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

export function PresetSelector({ presets, activeId, onSelect }: Props) {
  return (
    <div className="section">
      <div className="section__title">Historical Presets</div>
      <div className="preset-list">
        {presets.map((p) => (
          <button
            key={p.id}
            className="preset-card"
            data-active={activeId === p.id ? "true" : "false"}
            onClick={() => onSelect(p.id)}
          >
            <div className="preset-card__name">{p.name}</div>
            <div className="preset-card__meta">{p.date}</div>
            <div className="preset-card__blurb">{p.blurb}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
