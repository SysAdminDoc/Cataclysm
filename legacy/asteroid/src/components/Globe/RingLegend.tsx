import { catppuccinMocha, effectColors } from '../../theme';
import type { ImpactEffects } from '../../physics/types';

interface RingLegendProps {
  results: ImpactEffects;
}

function fmtDist(m: number): string {
  if (!isFinite(m) || m <= 0) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${m.toFixed(0)} m`;
}

interface LegendEntry {
  color: string;
  label: string;
  radius: number;
}

export function RingLegend({ results }: RingLegendProps) {
  const entries: LegendEntry[] = [];

  if (results.crater) {
    entries.push({ color: effectColors.craterRim, label: 'Crater rim', radius: results.crater.finalDiameter / 2 });
  }
  entries.push({ color: effectColors.fireball, label: 'Fireball', radius: results.thermal.fireballRadius });

  if (results.thermal.thermalRadiusThirdDegree > 10) {
    entries.push({ color: effectColors.thermal3, label: '3rd degree burns', radius: results.thermal.thermalRadiusThirdDegree });
  }

  entries.push({ color: effectColors.totalDestruction, label: 'Total destruction', radius: results.airblast.radiusTotalDestruction });
  entries.push({ color: effectColors.severeDamage, label: 'Severe damage', radius: results.airblast.radiusSevereDamage });
  entries.push({ color: effectColors.moderateDamage, label: 'Moderate damage', radius: results.airblast.radiusModerateDamage });
  entries.push({ color: effectColors.windowBreakage, label: 'Window breakage', radius: results.airblast.radiusWindowBreakage });

  if (results.ejecta && results.ejecta.maxEjectaRange > 10) {
    entries.push({ color: effectColors.ejecta, label: 'Ejecta range', radius: results.ejecta.maxEjectaRange });
  }

  const visible = entries.filter(e => e.radius > 10 && e.radius < 20_000_000);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 10,
        background: `${catppuccinMocha.crust}dd`,
        padding: '10px 14px',
        borderRadius: 8,
        border: `1px solid ${catppuccinMocha.surface0}`,
        fontSize: 11,
        maxHeight: 260,
        overflowY: 'auto',
      }}
    >
      <div style={{ color: catppuccinMocha.subtext0, fontWeight: 600, marginBottom: 6, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Effect Rings
      </div>
      {visible.map((e, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: e.color,
              border: `1px solid ${catppuccinMocha.surface1}`,
              flexShrink: 0,
            }}
          />
          <span style={{ color: catppuccinMocha.subtext1, flex: 1 }}>{e.label}</span>
          <span style={{ color: catppuccinMocha.overlay1, fontVariantNumeric: 'tabular-nums' }}>
            {fmtDist(e.radius)}
          </span>
        </div>
      ))}
    </div>
  );
}
