import { catppuccinMocha } from '../../theme';
import type { ImpactEffects } from '../../physics/types';
import { CraterDiagram } from './CraterDiagram';
import { TrajectoryChart } from './TrajectoryChart';

function fmt(n: number, decimals = 1): string {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(decimals)} T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(decimals)} B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(decimals)} M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(decimals)} k`;
  return n.toFixed(decimals);
}

function fmtDist(m: number): string {
  if (!isFinite(m) || m <= 0) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${m.toFixed(0)} m`;
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s <= 0) return '—';
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  return `${(s / 3600).toFixed(1)} hr`;
}

function fmtEnergy(j: number): string {
  if (j >= 4.184e18) return `${fmt(j / 4.184e15, 1)} Mt TNT`;
  if (j >= 4.184e15) return `${(j / 4.184e15).toFixed(2)} Mt TNT`;
  if (j >= 4.184e12) return `${(j / 4.184e12).toFixed(1)} kt TNT`;
  if (j >= 1e18) return `${(j / 1e18).toFixed(2)} EJ`;
  if (j >= 1e15) return `${(j / 1e15).toFixed(1)} PJ`;
  if (j >= 1e12) return `${(j / 1e12).toFixed(1)} TJ`;
  if (j >= 1e9) return `${(j / 1e9).toFixed(1)} GJ`;
  if (j >= 1e6) return `${(j / 1e6).toFixed(1)} MJ`;
  return `${fmt(j)} J`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          color: catppuccinMocha.blue,
          fontSize: 12,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 6,
          borderBottom: `1px solid ${catppuccinMocha.surface0}`,
          paddingBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '2px 0',
        fontSize: 12,
      }}
    >
      <span style={{ color: catppuccinMocha.subtext0 }}>{label}</span>
      <span
        style={{
          color: highlight ? catppuccinMocha.peach : catppuccinMocha.text,
          fontWeight: highlight ? 600 : 400,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}

interface ResultsPanelProps {
  results: ImpactEffects;
  title?: string;
}

export function ResultsPanel({ results, title = 'Impact Effects' }: ResultsPanelProps) {
  const { energy, atmosphericEntry, crater, thermal, seismic, airblast, ejecta, tsunami } = results;

  const s = {
    panel: {
      background: catppuccinMocha.mantle,
      borderLeft: `1px solid ${catppuccinMocha.surface0}`,
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
  };

  return (
    <div style={s.panel}>
      <h2 style={s.heading}>{title}</h2>

      <Section title="Energy">
        <Row label="Kinetic energy" value={fmtEnergy(energy.kineticEnergy)} highlight />
        <Row label="Impactor mass" value={`${fmt(energy.impactorMass)} kg`} />
        <Row label="Hiroshima (15 kt)" value={`${fmt(energy.kilotons / 15, 0)}x`} />
        {energy.megatons >= 50 && (
          <Row label="Tsar Bomba (50 Mt)" value={`${fmt(energy.megatons / 50, 1)}x`} />
        )}
        {energy.kineticEnergy >= 4.184e20 && (
          <Row label="M 9.0 earthquake" value={`${fmt(energy.kineticEnergy / 2e18, 1)}x`} />
        )}
      </Section>

      <Section title="Atmospheric Entry">
        <Row
          label="Outcome"
          value={atmosphericEntry.reachesGround ? 'Ground impact' : 'Airburst'}
          highlight
        />
        {!atmosphericEntry.reachesGround && (
          <Row label="Burst altitude" value={fmtDist(atmosphericEntry.airburstAltitude)} />
        )}
        {atmosphericEntry.breakupAltitude > 0 && (
          <Row label="Breakup begins" value={fmtDist(atmosphericEntry.breakupAltitude)} />
        )}
        <Row label="Impact velocity" value={`${(atmosphericEntry.impactVelocity / 1000).toFixed(1)} km/s`} />
        <TrajectoryChart entry={atmosphericEntry} />
      </Section>

      {crater && (
        <Section title="Crater">
          <Row label="Final diameter" value={fmtDist(crater.finalDiameter)} highlight />
          <Row label="Depth" value={fmtDist(crater.craterDepth)} />
          <Row label="Type" value={crater.isComplex ? 'Complex' : 'Simple'} />
          <Row label="Rim height" value={fmtDist(crater.rimHeight)} />
          {crater.meltVolume > 0 && (
            <Row label="Melt volume" value={`${fmt(crater.meltVolume)} m3`} />
          )}
          <CraterDiagram crater={crater} />
        </Section>
      )}

      <Section title="Thermal Radiation">
        <Row label="Fireball radius" value={fmtDist(thermal.fireballRadius)} />
        <Row label="Fireball duration" value={fmtTime(thermal.fireballDuration)} />
        <Row label="Exposure at observer" value={`${fmt(thermal.thermalExposure)} J/m2`} />
        <Row label="3rd degree burns" value={fmtDist(thermal.thermalRadiusThirdDegree)} />
        <Row label="Ignition radius" value={fmtDist(thermal.thermalRadiusIgnition)} />
      </Section>

      <Section title="Seismic">
        <Row label="Magnitude" value={seismic.magnitude.toFixed(1)} highlight />
        <Row label="Mercalli at observer" value={`${seismic.mercalliIntensity} — ${seismic.mercalliDescription}`} />
        <Row label="Arrival time" value={fmtTime(seismic.arrivalTime)} />
      </Section>

      <Section title="Air Blast">
        <Row label="Overpressure at observer" value={`${fmt(airblast.overpressure)} Pa`} />
        <Row label="Wind speed" value={`${fmt(airblast.windVelocity)} m/s`} />
        <Row label="Sound level" value={`${airblast.soundIntensity.toFixed(0)} dB`} />
        <Row label="Effect" value={airblast.damageDescription} highlight />
        <Row label="Arrival time" value={fmtTime(airblast.arrivalTime)} />
        <Row label="Window breakage radius" value={fmtDist(airblast.radiusWindowBreakage)} />
        <Row label="Total destruction radius" value={fmtDist(airblast.radiusTotalDestruction)} />
      </Section>

      {ejecta && (
        <Section title="Ejecta">
          <Row label="Thickness at observer" value={`${ejecta.ejectaThickness.toFixed(3)} m`} />
          <Row label="Max range" value={fmtDist(ejecta.maxEjectaRange)} />
          <Row label="Arrival time" value={fmtTime(ejecta.ejectaArrivalTime)} />
        </Section>
      )}

      {tsunami.applies && (
        <Section title="Tsunami">
          <Row label="Cavity diameter" value={fmtDist(tsunami.cavityDiameter)} />
          <Row label="Initial wave height" value={fmtDist(tsunami.initialAmplitude)} highlight />
          <Row label="Wave at observer" value={`${tsunami.amplitudeAtDistance.toFixed(2)} m`} />
          <Row label="Runup height" value={`${tsunami.runupHeight.toFixed(2)} m`} />
          <Row label="Arrival time" value={fmtTime(tsunami.arrivalTime)} />
        </Section>
      )}

      {energy.kineticEnergy >= 1e23 && (
        <Section title="Global Effects">
          <Row label="Classification" value="Extinction-level event" highlight />
          <Row label="Impact winter" value="Months to years of darkness" />
          <Row label="Global wildfires" value="Re-entering ejecta ignites vegetation" />
          <Row label="Acid rain" value="NOx + SO2 from shocked atmosphere" />
          <Row label="Tsunami (if ocean)" value="Global coastline inundation" />
        </Section>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button
          style={{
            flex: 1,
            padding: '5px 8px',
            background: catppuccinMocha.surface0,
            color: catppuccinMocha.subtext1,
            border: `1px solid ${catppuccinMocha.surface1}`,
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 11,
          }}
          onClick={() => {
            const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'asteroid-simulation.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export JSON
        </button>
        <button
          style={{
            flex: 1,
            padding: '5px 8px',
            background: catppuccinMocha.surface0,
            color: catppuccinMocha.subtext1,
            border: `1px solid ${catppuccinMocha.surface1}`,
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 11,
          }}
          onClick={() => {
            const url = window.location.href;
            navigator.clipboard.writeText(url);
          }}
        >
          Copy Link
        </button>
      </div>

      <Section title="At Your Location">
        <div style={{
          background: catppuccinMocha.surface0,
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 12,
          lineHeight: 1.6,
          color: catppuccinMocha.text,
        }}>
          {airblast.overpressure >= 137900
            ? '💀 Total destruction — no survival'
            : airblast.overpressure >= 48300
            ? '🏚️ Severe damage — most buildings collapse, high casualties'
            : airblast.overpressure >= 27600
            ? '⚠️ Moderate damage — structural failures, injuries from debris'
            : airblast.overpressure >= 13800
            ? '🪟 Minor damage — doors blown in, some walls crack'
            : airblast.overpressure >= 6900
            ? '🔊 Windows shatter — glass injuries likely'
            : airblast.overpressure >= 1000
            ? '👂 Loud boom — startling but no structural damage'
            : '✅ No significant effects at this distance'}
          <div style={{ color: catppuccinMocha.overlay0, fontSize: 10, marginTop: 4 }}>
            Right-click globe to set observer location
          </div>
        </div>
      </Section>
    </div>
  );
}
