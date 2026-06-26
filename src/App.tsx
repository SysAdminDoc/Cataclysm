import { Globe } from './components/Globe/Globe';
import { InputPanel } from './components/Controls/InputPanel';
import { ResultsPanel } from './components/Results/ResultsPanel';
import { useSimulation } from './hooks/useSimulation';
import { catppuccinMocha } from './theme';

export default function App() {
  const {
    params,
    results,
    impactLat,
    impactLon,
    updateParam,
    setImpactLocation,
    loadPreset,
  } = useSimulation();

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        background: catppuccinMocha.base,
        color: catppuccinMocha.text,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        overflow: 'hidden',
      }}
    >
      <InputPanel
        params={params}
        onUpdate={updateParam}
        onLoadPreset={loadPreset}
        lat={impactLat}
        lon={impactLon}
      />

      <div style={{ flex: 1, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            background: `${catppuccinMocha.crust}dd`,
            padding: '8px 20px',
            borderRadius: 8,
            border: `1px solid ${catppuccinMocha.surface0}`,
          }}
        >
          <span style={{ color: catppuccinMocha.text, fontSize: 15, fontWeight: 700 }}>
            AsteroidSimulator
          </span>
          <span style={{ color: catppuccinMocha.overlay0, fontSize: 12, marginLeft: 10 }}>
            v0.1.0
          </span>
        </div>

        <Globe
          lat={impactLat}
          lon={impactLon}
          results={results}
          onLocationClick={setImpactLocation}
        />
      </div>

      {results && <ResultsPanel results={results} />}
    </div>
  );
}
