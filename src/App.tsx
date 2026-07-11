import { useMemo, useState } from 'react';
import { Globe } from './components/Globe/Globe';
import { RingLegend } from './components/Globe/RingLegend';
import { InputPanel } from './components/Controls/InputPanel';
import { ResultsPanel } from './components/Results/ResultsPanel';
import { useFireballs } from './hooks/useFireballs';
import { useSimulation } from './hooks/useSimulation';
import { catppuccinMocha } from './theme';
import type { ImpactParams } from './physics/types';
import type { FireballEvent } from './types/fireballs';

const APP_VERSION = '0.3.0';

const COMPARISON_DEFAULT_PARAMS: ImpactParams = {
  diameter: 500,
  density: 3300,
  velocity: 20_000,
  angle: 45,
  targetType: 'water',
  waterDepth: 4000,
  beachSlope: 0.02,
  distance: 500_000,
};

type ScenarioKey = 'primary' | 'comparison';
type SimulationController = ReturnType<typeof useSimulation>;

interface GlobePaneProps {
  title: string;
  scenario: SimulationController;
  showFireballs: boolean;
  fireballs: FireballEvent[];
  fireballStatus: string;
}

function GlobePane({
  title,
  scenario,
  showFireballs,
  fireballs,
  fireballStatus,
}: GlobePaneProps) {
  return (
    <div className="globe-pane">
      <div className="globe-title">
        <span>{title}</span>
        <span className="globe-title-version">v{APP_VERSION}</span>
      </div>

      <Globe
        lat={scenario.impactLat}
        lon={scenario.impactLon}
        observerLat={scenario.observerLat}
        observerLon={scenario.observerLon}
        results={scenario.results}
        showFireballs={showFireballs}
        fireballs={fireballs}
        onLocationClick={scenario.setImpactLocation}
        onObserverClick={scenario.setObserverLocation}
      />

      {scenario.results && <RingLegend results={scenario.results} />}

      <div className="globe-instructions">
        <div>Left click: set impact &nbsp; Right click: set observer</div>
        {showFireballs && <div className="fireball-status">{fireballStatus}</div>}
      </div>
    </div>
  );
}

function toolbarButton(active: boolean) {
  return {
    padding: '6px 8px',
    background: active ? catppuccinMocha.blue : catppuccinMocha.surface0,
    color: active ? catppuccinMocha.crust : catppuccinMocha.subtext1,
    border: `1px solid ${active ? catppuccinMocha.blue : catppuccinMocha.surface1}`,
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: active ? 700 : 500,
  };
}

export default function App() {
  const primary = useSimulation({ syncUrl: true });
  const comparison = useSimulation({
    syncUrl: false,
    defaultParams: COMPARISON_DEFAULT_PARAMS,
    defaultLat: 19.4,
    defaultLon: -156.2,
  });
  const [comparisonMode, setComparisonMode] = useState(false);
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>('primary');
  const [showFireballs, setShowFireballs] = useState(false);
  const fireballState = useFireballs(showFireballs);

  const active = comparisonMode && activeScenario === 'comparison' ? comparison : primary;
  const activeTitle = comparisonMode
    ? `Impact Parameters - ${activeScenario === 'primary' ? 'Primary' : 'Comparison'}`
    : 'Impact Parameters';

  const fireballStatus = useMemo(() => {
    if (!showFireballs) return '';
    if (fireballState.loading) return 'Loading CNEOS fireballs...';
    if (fireballState.error) return fireballState.error;
    return `${fireballState.events.length} CNEOS fireballs plotted`;
  }, [fireballState.error, fireballState.events.length, fireballState.loading, showFireballs]);

  const clonePrimaryToComparison = () => {
    comparison.replaceScenario({
      params: primary.params,
      impactLat: primary.impactLat,
      impactLon: primary.impactLon,
      observerLat: primary.observerLat,
      observerLon: primary.observerLon,
    });
    setComparisonMode(true);
    setActiveScenario('comparison');
  };

  const panelToolbar = (
    <div style={{
      display: 'grid',
      gap: 6,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          style={toolbarButton(comparisonMode)}
          onClick={() => {
            const nextMode = !comparisonMode;
            setComparisonMode(nextMode);
            setActiveScenario(nextMode ? 'comparison' : 'primary');
          }}
        >
          {comparisonMode ? 'Comparison On' : 'Compare'}
        </button>
        <button
          style={toolbarButton(showFireballs)}
          onClick={() => setShowFireballs(value => !value)}
        >
          {showFireballs ? 'Fireballs On' : 'Fireballs'}
        </button>
      </div>

      {comparisonMode && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button
              style={toolbarButton(activeScenario === 'primary')}
              onClick={() => setActiveScenario('primary')}
            >
              Primary
            </button>
            <button
              style={toolbarButton(activeScenario === 'comparison')}
              onClick={() => setActiveScenario('comparison')}
            >
              Comparison
            </button>
          </div>
          <button
            style={{
              ...toolbarButton(false),
              width: '100%',
              textAlign: 'center',
            }}
            onClick={clonePrimaryToComparison}
          >
            Clone Primary to Comparison
          </button>
        </>
      )}

      {showFireballs && (
        <div style={{
          color: fireballState.error ? catppuccinMocha.yellow : catppuccinMocha.overlay1,
          fontSize: 10,
          lineHeight: 1.4,
        }}>
          {fireballStatus}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`app-layout${comparisonMode ? ' comparison-mode' : ''}`}
      style={{
        background: catppuccinMocha.base,
        color: catppuccinMocha.text,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div className="input-panel">
        <InputPanel
          title={activeTitle}
          params={active.params}
          onUpdate={active.updateParam}
          onLoadPreset={active.loadPreset}
          lat={active.impactLat}
          lon={active.impactLon}
          toolbar={panelToolbar}
        />
      </div>

      <div className={`globe-container${comparisonMode ? ' globe-comparison' : ''}`}>
        <GlobePane
          title={comparisonMode ? 'Primary Impact' : 'AsteroidSimulator'}
          scenario={primary}
          showFireballs={showFireballs}
          fireballs={fireballState.events}
          fireballStatus={fireballStatus}
        />

        {comparisonMode && (
          <GlobePane
            title="Comparison Impact"
            scenario={comparison}
            showFireballs={showFireballs}
            fireballs={fireballState.events}
            fireballStatus={fireballStatus}
          />
        )}
      </div>

      <div className={`results-panel${comparisonMode ? ' comparison-results' : ''}`}>
        <ResultsPanel
          title={comparisonMode ? 'Primary Effects' : 'Impact Effects'}
          results={primary.results}
        />
        {comparisonMode && (
          <ResultsPanel
            title="Comparison Effects"
            results={comparison.results}
          />
        )}
      </div>
    </div>
  );
}
