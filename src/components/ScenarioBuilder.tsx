import { useState } from "react";
import type { AsteroidImpactInput } from "../types/scenario";

type Props = {
  onSimulate: (input: AsteroidImpactInput) => void;
};

const initial: AsteroidImpactInput = {
  diameter_m: 500,
  density_kg_m3: 3000,
  velocity_m_s: 18_000,
  angle_deg: 45,
  water_depth_m: 4_000,
  location: { lat_deg: 0, lon_deg: -30, depth_m: 4_000 },
};

export function ScenarioBuilder({ onSimulate }: Props) {
  const [s, setS] = useState<AsteroidImpactInput>(initial);

  function update<K extends keyof AsteroidImpactInput>(k: K, v: AsteroidImpactInput[K]) {
    setS({ ...s, [k]: v });
  }

  function updateLoc(k: "lat_deg" | "lon_deg" | "depth_m", v: number) {
    setS({ ...s, location: { ...s.location, [k]: v } });
  }

  return (
    <div className="section">
      <div className="section__title">Custom Asteroid Scenario</div>
      <div className="scenario-form">
        <label>
          Diameter (m)
          <input
            type="number"
            value={s.diameter_m}
            onChange={(e) => update("diameter_m", Number(e.target.value))}
          />
        </label>
        <label>
          Density (kg/m³)
          <input
            type="number"
            value={s.density_kg_m3}
            onChange={(e) => update("density_kg_m3", Number(e.target.value))}
          />
        </label>
        <label>
          Velocity (m/s)
          <input
            type="number"
            value={s.velocity_m_s}
            onChange={(e) => update("velocity_m_s", Number(e.target.value))}
          />
        </label>
        <label>
          Angle (°)
          <input
            type="number"
            value={s.angle_deg}
            onChange={(e) => update("angle_deg", Number(e.target.value))}
          />
        </label>
        <label>
          Latitude (°)
          <input
            type="number"
            value={s.location.lat_deg}
            onChange={(e) => updateLoc("lat_deg", Number(e.target.value))}
          />
        </label>
        <label>
          Longitude (°)
          <input
            type="number"
            value={s.location.lon_deg}
            onChange={(e) => updateLoc("lon_deg", Number(e.target.value))}
          />
        </label>
        <label className="full">
          Water depth at impact (m)
          <input
            type="number"
            value={s.water_depth_m}
            onChange={(e) => {
              update("water_depth_m", Number(e.target.value));
              updateLoc("depth_m", Number(e.target.value));
            }}
          />
        </label>
        <button className="primary" style={{ gridColumn: "span 2" }} onClick={() => onSimulate(s)}>
          Simulate Impact
        </button>
      </div>
    </div>
  );
}
