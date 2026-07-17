import { useId } from "react";
import type { AsteroidCraterVisual } from "../hazards";

export function CraterDiagram({ crater }: { crater: AsteroidCraterVisual }) {
  const titleId = useId();
  const descriptionId = useId();
  const markerLeftId = useId().replaceAll(":", "");
  const markerRightId = useId().replaceAll(":", "");
  if (crater.finalDiameter <= 0 || crater.craterDepth <= 0) return null;

  const width = 560;
  const height = 250;
  const pad = 38;
  const centerX = width / 2;
  const halfWidth = (width - pad * 2) / 2;
  const drawHeight = height - pad * 2 - 20;
  const verticalScale = drawHeight / Math.max(crater.craterDepth + crater.rimHeight, 1);
  const rimPixels = crater.rimHeight * verticalScale;
  const depthPixels = crater.craterDepth * verticalScale;
  const groundY = pad + rimPixels;
  const bottomY = groundY + depthPixels;
  const rimTopY = pad;
  const rimInset = halfWidth * 0.15;
  const bowlPath = crater.isComplex
    ? [
        `M ${centerX - halfWidth} ${groundY}`,
        `L ${centerX - halfWidth} ${rimTopY}`,
        `L ${centerX - halfWidth + rimInset} ${groundY}`,
        `Q ${centerX - halfWidth * 0.6} ${bottomY} ${centerX - halfWidth * 0.3} ${bottomY}`,
        `Q ${centerX - halfWidth * 0.1} ${bottomY} ${centerX} ${bottomY - depthPixels * 0.35}`,
        `Q ${centerX + halfWidth * 0.1} ${bottomY} ${centerX + halfWidth * 0.3} ${bottomY}`,
        `Q ${centerX + halfWidth * 0.6} ${bottomY} ${centerX + halfWidth - rimInset} ${groundY}`,
        `L ${centerX + halfWidth} ${rimTopY}`,
        `L ${centerX + halfWidth} ${groundY}`,
      ].join(" ")
    : [
        `M ${centerX - halfWidth} ${groundY}`,
        `L ${centerX - halfWidth} ${rimTopY}`,
        `L ${centerX - halfWidth + rimInset} ${groundY}`,
        `Q ${centerX} ${bottomY + depthPixels * 0.12} ${centerX + halfWidth - rimInset} ${groundY}`,
        `L ${centerX + halfWidth} ${rimTopY}`,
        `L ${centerX + halfWidth} ${groundY}`,
      ].join(" ");
  const formatDistance = (meters: number) => meters >= 1_000
    ? `${(meters / 1_000).toFixed(1)} km`
    : `${meters.toFixed(0)} m`;

  return (
    <figure className="hazard-diagram">
      <svg
        className="hazard-diagram__svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>Modeled crater cross-section</title>
        <desc id={descriptionId}>
          {crater.isComplex ? "Complex crater with a central peak" : "Simple bowl-shaped crater"}, annotated with final diameter and depth.
        </desc>
        <defs>
          <marker id={markerLeftId} markerWidth="7" markerHeight="6" refX="0" refY="3" orient="auto">
            <path className="hazard-diagram__dimension" d="M7,0 L0,3 L7,6" />
          </marker>
          <marker id={markerRightId} markerWidth="7" markerHeight="6" refX="7" refY="3" orient="auto">
            <path className="hazard-diagram__dimension" d="M0,0 L7,3 L0,6" />
          </marker>
        </defs>
        <line className="hazard-diagram__ground" x1={pad - 10} y1={groundY} x2={width - pad + 10} y2={groundY} />
        <path className="hazard-diagram__crater" d={bowlPath} />
        <line
          className="hazard-diagram__dimension"
          x1={centerX - halfWidth}
          y1={rimTopY - 8}
          x2={centerX + halfWidth}
          y2={rimTopY - 8}
          markerStart={`url(#${markerLeftId})`}
          markerEnd={`url(#${markerRightId})`}
        />
        <text className="hazard-diagram__dimension-label" x={centerX} y={rimTopY - 14} textAnchor="middle">
          {formatDistance(crater.finalDiameter)} diameter
        </text>
        <line className="hazard-diagram__depth" x1={width - pad + 18} y1={groundY} x2={width - pad + 18} y2={bottomY} />
        <text className="hazard-diagram__depth-label" x={width - 8} y={(groundY + bottomY) / 2 + 4} textAnchor="end">
          {formatDistance(crater.craterDepth)} deep
        </text>
      </svg>
      <figcaption>{crater.isComplex ? "Complex crater · central peak" : "Simple crater · bowl profile"}</figcaption>
    </figure>
  );
}
