import { Globe } from './components/Globe/Globe';
import { RingLegend } from './components/Globe/RingLegend';
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
    observerLat,
    observerLon,
    updateParam,
    setImpactLocation,
    setObserverLocation,
    loadPreset,
  } = useSimulation();

  return (
    <div
      className="app-layout"
      style={{
        background: catppuccinMocha.base,
        color: catppuccinMocha.text,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div className="input-panel">
        <InputPanel
          params={params}
          onUpdate={updateParam}
          onLoadPreset={loadPreset}
          lat={impactLat}
          lon={impactLon}
        />
      </div>

      <div className="globe-container">
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
            v0.2.0
          </span>
        </div>

        <Globe
          lat={impactLat}
          lon={impactLon}
          observerLat={observerLat}
          observerLon={observerLon}
          results={results}
          onLocationClick={setImpactLocation}
          onObserverClick={setObserverLocation}
        />

        {results && <RingLegend results={results} />}

        <div
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            zIndex: 10,
            background: `${catppuccinMocha.crust}cc`,
            padding: '6px 12px',
            borderRadius: 6,
            border: `1px solid ${catppuccinMocha.surface0}`,
            fontSize: 10,
            color: catppuccinMocha.overlay0,
          }}
        >
          Left click: set impact &nbsp; Right click: set observer
        </div>
      </div>

      <div className="results-panel">
        {results && <ResultsPanel results={results} />}
      </div>
    </div>
  );
}
