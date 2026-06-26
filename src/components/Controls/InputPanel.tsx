import { catppuccinMocha } from '../../theme';
import { COMPOSITION_DENSITY } from '../../physics/constants';
import type { ImpactParams, TargetType } from '../../physics/types';
import { PRESETS } from '../../presets/historical';
import { NeoSearch } from './NeoSearch';
import { CloseApproach } from './CloseApproach';

interface InputPanelProps {
  params: ImpactParams;
  onUpdate: <K extends keyof ImpactParams>(key: K, value: ImpactParams[K]) => void;
  onLoadPreset: (index: number) => void;
  lat: number;
  lon: number;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  format,
  tooltip,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  tooltip?: string;
}) {
  const display = format ? format(value) : value.toLocaleString();
  return (
    <div style={{ marginBottom: 12 }} title={tooltip}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: catppuccinMocha.subtext1, fontSize: 12, cursor: tooltip ? 'help' : undefined }}>{label}</span>
        <span style={{ color: catppuccinMocha.text, fontSize: 12, fontWeight: 600 }}>
          {display} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: catppuccinMocha.blue }}
      />
    </div>
  );
}

export function InputPanel({ params, onUpdate, onLoadPreset, lat, lon }: InputPanelProps) {
  const s = {
    panel: {
      background: catppuccinMocha.mantle,
      borderRight: `1px solid ${catppuccinMocha.surface0}`,
      padding: 16,
      width: '100%',
      height: '100%',
      boxSizing: 'border-box' as const,
    },
    heading: {
      color: catppuccinMocha.text,
      fontSize: 16,
      fontWeight: 700,
      marginBottom: 16,
      marginTop: 0,
    },
    subheading: {
      color: catppuccinMocha.subtext0,
      fontSize: 11,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.08em',
      marginBottom: 8,
      marginTop: 20,
    },
    select: {
      width: '100%',
      padding: '6px 8px',
      background: catppuccinMocha.surface0,
      color: catppuccinMocha.text,
      border: `1px solid ${catppuccinMocha.surface1}`,
      borderRadius: 6,
      fontSize: 13,
      marginBottom: 12,
    },
    presetBtn: {
      width: '100%',
      padding: '6px 10px',
      background: catppuccinMocha.surface0,
      color: catppuccinMocha.text,
      border: `1px solid ${catppuccinMocha.surface1}`,
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 12,
      textAlign: 'left' as const,
      marginBottom: 4,
    },
    coords: {
      color: catppuccinMocha.overlay1,
      fontSize: 11,
      marginBottom: 12,
    },
  };

  return (
    <div style={s.panel}>
      <h2 style={s.heading}>Impact Parameters</h2>

      <div style={s.coords}>
        {lat.toFixed(4)}, {lon.toFixed(4)} — click globe to move
      </div>

      <div style={s.subheading}>Presets</div>
      {PRESETS.map((p, i) => (
        <button
          key={p.name}
          style={s.presetBtn}
          onClick={() => onLoadPreset(i)}
          onMouseOver={e => (e.currentTarget.style.background = catppuccinMocha.surface1)}
          onMouseOut={e => (e.currentTarget.style.background = catppuccinMocha.surface0)}
        >
          {p.name} <span style={{ color: catppuccinMocha.overlay0 }}>({p.year})</span>
        </button>
      ))}

      <div style={s.subheading}>Projectile</div>

      <SliderRow
        label="Diameter"
        value={params.diameter}
        min={1}
        max={50000}
        step={1}
        unit="m"
        onChange={v => onUpdate('diameter', v)}
        format={v => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${v}`)}
        tooltip="Impactor diameter. Chelyabinsk was ~19m, Chicxulub ~12km."
      />

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: catppuccinMocha.subtext1, fontSize: 12 }}>Composition</span>
        </div>
        <select
          style={s.select}
          value={params.density}
          onChange={e => onUpdate('density', parseInt(e.target.value))}
        >
          <option value={COMPOSITION_DENSITY.ice}>Ice / Comet (1,000 kg/m3)</option>
          <option value={COMPOSITION_DENSITY.porous_rock}>Porous Rock (1,500 kg/m3)</option>
          <option value={COMPOSITION_DENSITY.dense_rock}>Dense Rock (3,000 kg/m3)</option>
          <option value={COMPOSITION_DENSITY.stony}>Stony Asteroid (3,300 kg/m3)</option>
          <option value={COMPOSITION_DENSITY.iron}>Iron (7,800 kg/m3)</option>
        </select>
      </div>

      <SliderRow
        label="Velocity"
        value={params.velocity / 1000}
        min={11.2}
        max={72}
        step={0.1}
        unit="km/s"
        onChange={v => onUpdate('velocity', v * 1000)}
        format={v => v.toFixed(1)}
        tooltip="Impact velocity. Min 11.2 km/s (Earth escape), max 72 km/s (head-on comet)."
      />

      <SliderRow
        label="Impact Angle"
        value={params.angle}
        min={1}
        max={90}
        step={1}
        unit="deg"
        onChange={v => onUpdate('angle', v)}
        tooltip="Angle from horizontal. 90° = vertical impact. Most probable angle is 45°."
      />

      <div style={s.subheading}>Target</div>

      <select
        style={s.select}
        value={params.targetType}
        onChange={e => onUpdate('targetType', e.target.value as TargetType)}
      >
        <option value="sedimentary_rock">Sedimentary Rock</option>
        <option value="crystalline_rock">Crystalline Rock</option>
        <option value="water">Water (Ocean)</option>
      </select>

      {params.targetType === 'water' && (
        <>
          <SliderRow
            label="Water Depth"
            value={params.waterDepth}
            min={10}
            max={11000}
            step={10}
            unit="m"
            onChange={v => onUpdate('waterDepth', v)}
          />
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: catppuccinMocha.subtext1, fontSize: 12 }}>Coastal Slope</span>
            </div>
            <select
              style={s.select}
              value={params.beachSlope}
              onChange={e => onUpdate('beachSlope', parseFloat(e.target.value))}
            >
              <option value={0.005}>Gentle shelf (0.3°)</option>
              <option value={0.02}>Average coast (1.1°)</option>
              <option value={0.05}>Moderate slope (2.9°)</option>
              <option value={0.1}>Steep volcanic (5.7°)</option>
            </select>
          </div>
        </>
      )}

      <SliderRow
        label="Observer Distance"
        value={params.distance / 1000}
        min={1}
        max={20000}
        step={1}
        unit="km"
        onChange={v => onUpdate('distance', v * 1000)}
        format={v => v.toLocaleString()}
        tooltip="Your distance from ground zero. Effects are calculated at this distance. Right-click globe to set visually."
      />

      <NeoSearch
        onSelect={neo => {
          onUpdate('diameter', neo.diameter);
          onUpdate('density', neo.density);
          onUpdate('velocity', neo.velocity);
        }}
      />

      <CloseApproach
        onSelect={neo => {
          onUpdate('diameter', neo.diameter);
          onUpdate('density', neo.density);
          onUpdate('velocity', neo.velocity);
        }}
      />
    </div>
  );
}
