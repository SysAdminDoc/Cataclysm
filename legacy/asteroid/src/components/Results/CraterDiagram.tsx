import { catppuccinMocha } from '../../theme';
import type { CraterResult } from '../../physics/types';

interface CraterDiagramProps {
  crater: CraterResult;
}

export function CraterDiagram({ crater }: CraterDiagramProps) {
  const { finalDiameter, craterDepth, rimHeight, isComplex } = crater;
  if (finalDiameter <= 0) return null;

  const w = 280;
  const h = 140;
  const pad = 20;
  const drawW = w - pad * 2;
  const drawH = h - pad * 2;

  const totalVertical = craterDepth + rimHeight;
  const scaleY = drawH / totalVertical;
  const rimPx = rimHeight * scaleY;
  const depthPx = craterDepth * scaleY;

  const groundY = pad + rimPx;
  const craterBottomY = groundY + depthPx;
  const rimTopY = pad;
  const cx = w / 2;
  const halfW = drawW / 2;

  const rimOuterOffset = halfW * 0.15;

  let bowlPath: string;
  if (isComplex) {
    const flatW = halfW * 0.3;
    const centralPeakH = depthPx * 0.35;
    bowlPath = [
      `M ${cx - halfW} ${groundY}`,
      `L ${cx - halfW} ${rimTopY}`,
      `L ${cx - halfW + rimOuterOffset} ${groundY}`,
      `Q ${cx - halfW * 0.6} ${craterBottomY} ${cx - flatW} ${craterBottomY}`,
      `L ${cx - flatW * 0.4} ${craterBottomY}`,
      `Q ${cx - flatW * 0.2} ${craterBottomY} ${cx} ${craterBottomY - centralPeakH}`,
      `Q ${cx + flatW * 0.2} ${craterBottomY} ${cx + flatW * 0.4} ${craterBottomY}`,
      `L ${cx + flatW} ${craterBottomY}`,
      `Q ${cx + halfW * 0.6} ${craterBottomY} ${cx + halfW - rimOuterOffset} ${groundY}`,
      `L ${cx + halfW} ${rimTopY}`,
      `L ${cx + halfW} ${groundY}`,
    ].join(' ');
  } else {
    bowlPath = [
      `M ${cx - halfW} ${groundY}`,
      `L ${cx - halfW} ${rimTopY}`,
      `L ${cx - halfW + rimOuterOffset} ${groundY}`,
      `Q ${cx} ${craterBottomY + depthPx * 0.15} ${cx + halfW - rimOuterOffset} ${groundY}`,
      `L ${cx + halfW} ${rimTopY}`,
      `L ${cx + halfW} ${groundY}`,
    ].join(' ');
  }

  const fmtDist = (m: number) =>
    m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`;

  return (
    <div style={{ marginTop: 8, marginBottom: 8 }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block', margin: '0 auto' }}
      >
        {/* Ground line */}
        <line
          x1={pad - 5}
          y1={groundY}
          x2={w - pad + 5}
          y2={groundY}
          stroke={catppuccinMocha.surface2}
          strokeWidth={1}
          strokeDasharray="3,3"
        />

        {/* Crater profile */}
        <path
          d={bowlPath}
          fill={catppuccinMocha.surface0}
          stroke={catppuccinMocha.mauve}
          strokeWidth={1.5}
        />

        {/* Diameter dimension */}
        <line
          x1={cx - halfW}
          y1={rimTopY - 3}
          x2={cx + halfW}
          y2={rimTopY - 3}
          stroke={catppuccinMocha.blue}
          strokeWidth={1}
          markerStart="url(#arrowL)"
          markerEnd="url(#arrowR)"
        />
        <text
          x={cx}
          y={rimTopY - 6}
          textAnchor="middle"
          fill={catppuccinMocha.blue}
          fontSize={9}
          fontFamily="sans-serif"
        >
          {fmtDist(finalDiameter)}
        </text>

        {/* Depth dimension */}
        <line
          x1={w - pad + 12}
          y1={groundY}
          x2={w - pad + 12}
          y2={craterBottomY}
          stroke={catppuccinMocha.peach}
          strokeWidth={1}
        />
        <text
          x={w - pad + 15}
          y={(groundY + craterBottomY) / 2 + 3}
          fill={catppuccinMocha.peach}
          fontSize={8}
          fontFamily="sans-serif"
        >
          {fmtDist(craterDepth)}
        </text>

        {/* Type label */}
        <text
          x={cx}
          y={h - 3}
          textAnchor="middle"
          fill={catppuccinMocha.overlay0}
          fontSize={9}
          fontFamily="sans-serif"
        >
          {isComplex ? 'Complex crater (central peak)' : 'Simple crater (bowl shape)'}
        </text>

        <defs>
          <marker id="arrowL" markerWidth="6" markerHeight="4" refX="0" refY="2" orient="auto">
            <path d="M6,0 L0,2 L6,4" fill="none" stroke={catppuccinMocha.blue} strokeWidth={0.8} />
          </marker>
          <marker id="arrowR" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
            <path d="M0,0 L6,2 L0,4" fill="none" stroke={catppuccinMocha.blue} strokeWidth={0.8} />
          </marker>
        </defs>
      </svg>
    </div>
  );
}
