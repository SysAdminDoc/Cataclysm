import { catppuccinMocha } from '../../theme';
import type { AtmosphericEntryResult } from '../../physics/types';

interface TrajectoryChartProps {
  entry: AtmosphericEntryResult;
}

export function TrajectoryChart({ entry }: TrajectoryChartProps) {
  const { trajectory } = entry;
  if (trajectory.length < 3) return null;

  const w = 280;
  const h = 120;
  const pad = { top: 12, right: 12, bottom: 22, left: 38 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const maxAlt = Math.max(...trajectory.map(p => p.altitude));
  const maxDist = Math.max(...trajectory.map(p => p.groundDistance), 1);
  const maxVel = Math.max(...trajectory.map(p => p.velocity), 1);

  function x(gd: number): number {
    return pad.left + (gd / maxDist) * plotW;
  }
  function y(alt: number): number {
    return pad.top + (1 - alt / maxAlt) * plotH;
  }

  const altPath = trajectory
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.groundDistance).toFixed(1)},${y(p.altitude).toFixed(1)}`)
    .join(' ');

  const velPoints = trajectory.map(p => ({
    x: x(p.groundDistance),
    y: pad.top + (1 - p.velocity / maxVel) * plotH,
  }));
  const velPath = velPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const altLabel = maxAlt >= 1000 ? `${(maxAlt / 1000).toFixed(0)} km` : `${maxAlt.toFixed(0)} m`;
  const distLabel = maxDist >= 1000 ? `${(maxDist / 1000).toFixed(0)} km` : `${maxDist.toFixed(0)} m`;

  return (
    <div style={{ marginTop: 8, marginBottom: 8 }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block', margin: '0 auto' }}
      >
        {/* Grid lines */}
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + plotH} stroke={catppuccinMocha.surface0} strokeWidth={1} />
        <line x1={pad.left} y1={pad.top + plotH} x2={pad.left + plotW} y2={pad.top + plotH} stroke={catppuccinMocha.surface0} strokeWidth={1} />

        {/* Altitude line */}
        <path d={altPath} fill="none" stroke={catppuccinMocha.peach} strokeWidth={1.5} />

        {/* Velocity line */}
        <path d={velPath} fill="none" stroke={catppuccinMocha.blue} strokeWidth={1} strokeDasharray="4,2" />

        {/* Breakup marker */}
        {entry.breakupAltitude > 0 && (
          <circle
            cx={x(trajectory.find(p => p.altitude <= entry.breakupAltitude)?.groundDistance ?? 0)}
            cy={y(entry.breakupAltitude)}
            r={3}
            fill={catppuccinMocha.yellow}
            stroke={catppuccinMocha.crust}
            strokeWidth={1}
          />
        )}

        {/* Airburst / impact marker */}
        {!entry.reachesGround && entry.airburstAltitude > 0 && (
          <circle
            cx={x(trajectory[trajectory.length - 1].groundDistance)}
            cy={y(entry.airburstAltitude)}
            r={4}
            fill={catppuccinMocha.red}
            stroke={catppuccinMocha.crust}
            strokeWidth={1}
          />
        )}

        {/* Y-axis label */}
        <text x={pad.left - 4} y={pad.top + 4} textAnchor="end" fill={catppuccinMocha.overlay0} fontSize={8} fontFamily="sans-serif">
          {altLabel}
        </text>
        <text x={pad.left - 4} y={pad.top + plotH} textAnchor="end" fill={catppuccinMocha.overlay0} fontSize={8} fontFamily="sans-serif">
          0
        </text>

        {/* X-axis label */}
        <text x={pad.left + plotW} y={pad.top + plotH + 14} textAnchor="end" fill={catppuccinMocha.overlay0} fontSize={8} fontFamily="sans-serif">
          {distLabel}
        </text>

        {/* Legend */}
        <line x1={pad.left + 4} y1={h - 6} x2={pad.left + 18} y2={h - 6} stroke={catppuccinMocha.peach} strokeWidth={1.5} />
        <text x={pad.left + 21} y={h - 3} fill={catppuccinMocha.peach} fontSize={7} fontFamily="sans-serif">Alt</text>
        <line x1={pad.left + 40} y1={h - 6} x2={pad.left + 54} y2={h - 6} stroke={catppuccinMocha.blue} strokeWidth={1} strokeDasharray="4,2" />
        <text x={pad.left + 57} y={h - 3} fill={catppuccinMocha.blue} fontSize={7} fontFamily="sans-serif">Vel</text>
      </svg>
    </div>
  );
}
