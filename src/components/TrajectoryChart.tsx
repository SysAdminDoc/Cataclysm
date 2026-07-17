import { useId } from "react";
import type { AsteroidTrajectoryPoint } from "../hazards";

export function TrajectoryChart({
  trajectory,
  reachesGround,
  breakupAltitude,
  airburstAltitude,
}: {
  trajectory: AsteroidTrajectoryPoint[];
  reachesGround: boolean;
  breakupAltitude: number;
  airburstAltitude: number;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const points = trajectory.filter((point) =>
    [point.altitude, point.velocity, point.groundDistance, point.time].every(Number.isFinite)
  );
  if (points.length < 3) return null;

  const width = 560;
  const height = 220;
  const pad = { top: 22, right: 22, bottom: 42, left: 70 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxAltitude = Math.max(...points.map((point) => point.altitude), 1);
  const maxDistance = Math.max(...points.map((point) => point.groundDistance), 1);
  const maxVelocity = Math.max(...points.map((point) => point.velocity), 1);
  const x = (distance: number) => pad.left + (distance / maxDistance) * plotWidth;
  const altitudeY = (altitude: number) => pad.top + (1 - altitude / maxAltitude) * plotHeight;
  const velocityY = (velocity: number) => pad.top + (1 - velocity / maxVelocity) * plotHeight;
  const path = (getY: (point: AsteroidTrajectoryPoint) => number) => points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.groundDistance).toFixed(1)},${getY(point).toFixed(1)}`)
    .join(" ");
  const breakupPoint = breakupAltitude > 0
    ? points.find((point) => point.altitude <= breakupAltitude)
    : undefined;
  const terminal = points[points.length - 1];
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
        <title id={titleId}>Atmospheric entry trajectory</title>
        <desc id={descriptionId}>
          Altitude and velocity along the Rust-modeled ground track, with breakup and terminal markers where applicable.
        </desc>
        <line className="hazard-diagram__axis" x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + plotHeight} />
        <line className="hazard-diagram__axis" x1={pad.left} y1={pad.top + plotHeight} x2={pad.left + plotWidth} y2={pad.top + plotHeight} />
        <path className="hazard-diagram__altitude" d={path((point) => altitudeY(point.altitude))} />
        <path className="hazard-diagram__velocity" d={path((point) => velocityY(point.velocity))} />
        {breakupPoint ? (
          <circle className="hazard-diagram__breakup" cx={x(breakupPoint.groundDistance)} cy={altitudeY(breakupAltitude)} r={5} />
        ) : null}
        {!reachesGround && airburstAltitude > 0 ? (
          <circle className="hazard-diagram__terminal" cx={x(terminal.groundDistance)} cy={altitudeY(airburstAltitude)} r={6} />
        ) : null}
        <text className="hazard-diagram__label" x={pad.left - 8} y={pad.top + 5} textAnchor="end">
          {formatDistance(maxAltitude)} alt
        </text>
        <text className="hazard-diagram__label" x={pad.left - 8} y={pad.top + plotHeight + 4} textAnchor="end">0</text>
        <text className="hazard-diagram__label" x={pad.left + plotWidth} y={pad.top + plotHeight + 24} textAnchor="end">
          {formatDistance(maxDistance)} ground track
        </text>
        <g className="hazard-diagram__legend" transform={`translate(${pad.left + 8} ${height - 10})`}>
          <line className="hazard-diagram__altitude" x1={0} y1={0} x2={28} y2={0} />
          <text x={34} y={4}>Altitude</text>
          <line className="hazard-diagram__velocity" x1={112} y1={0} x2={140} y2={0} />
          <text x={146} y={4}>Velocity (relative scale)</text>
        </g>
      </svg>
      <figcaption>Rust-authoritative entry profile · {points.length} bounded samples</figcaption>
    </figure>
  );
}
