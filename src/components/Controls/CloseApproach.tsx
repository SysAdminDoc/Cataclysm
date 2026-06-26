import { useState, useEffect } from 'react';
import { catppuccinMocha } from '../../theme';

interface ApproachEntry {
  des: string;
  fullname: string;
  date: string;
  distAu: number;
  distKm: number;
  vRel: number;
  hMag: number;
  estDiameter: number;
}

interface CloseApproachProps {
  onSelect: (entry: { diameter: number; velocity: number; density: number }) => void;
}

export function CloseApproach({ onSelect }: CloseApproachProps) {
  const [entries, setEntries] = useState<ApproachEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded || entries.length > 0) return;

    setLoading(true);
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + 60);
    const dateMin = today.toISOString().slice(0, 10);
    const dateMax = future.toISOString().slice(0, 10);

    fetch(`/api/jpl/cad.api?date-min=${dateMin}&date-max=${dateMax}&dist-max=0.05&sort=dist&limit=10`)
      .then(r => r.json())
      .then(data => {
        if (!data.data) {
          setEntries([]);
          setLoading(false);
          return;
        }
        const fields = data.fields as string[];
        const desIdx = fields.indexOf('des');
        const dateIdx = fields.indexOf('cd');
        const distIdx = fields.indexOf('dist');
        const vRelIdx = fields.indexOf('v_rel');
        const hIdx = fields.indexOf('h');
        const fullnameIdx = fields.indexOf('fullname');

        const parsed: ApproachEntry[] = data.data.map((row: string[]) => {
          const hMag = parseFloat(row[hIdx]) || 25;
          const albedo = 0.15;
          const estDiameter = (1329 / Math.sqrt(albedo)) * Math.pow(10, -0.2 * hMag) * 1000;
          const distAu = parseFloat(row[distIdx]) || 0;

          return {
            des: row[desIdx] || '',
            fullname: row[fullnameIdx] || row[desIdx] || '',
            date: (row[dateIdx] || '').split(' ')[0] || '',
            distAu,
            distKm: distAu * 1.496e8,
            vRel: (parseFloat(row[vRelIdx]) || 20) * 1000,
            hMag,
            estDiameter: Math.max(1, estDiameter),
          };
        });

        setEntries(parsed);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [expanded]);

  const s = {
    toggle: {
      width: '100%',
      padding: '6px 10px',
      background: catppuccinMocha.surface0,
      color: catppuccinMocha.subtext1,
      border: `1px solid ${catppuccinMocha.surface1}`,
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 11,
      textAlign: 'left' as const,
      marginTop: 12,
    },
    entry: {
      padding: '5px 8px',
      background: catppuccinMocha.surface0,
      border: `1px solid ${catppuccinMocha.surface1}`,
      borderRadius: 6,
      marginTop: 4,
      cursor: 'pointer',
      fontSize: 11,
    },
  };

  return (
    <div>
      <button
        style={s.toggle}
        onClick={() => setExpanded(!expanded)}
        onMouseOver={e => (e.currentTarget.style.background = catppuccinMocha.surface1)}
        onMouseOut={e => (e.currentTarget.style.background = catppuccinMocha.surface0)}
      >
        {expanded ? '▾' : '▸'} Upcoming Close Approaches
      </button>

      {expanded && loading && (
        <div style={{ color: catppuccinMocha.overlay0, fontSize: 10, marginTop: 4 }}>
          Loading CNEOS data...
        </div>
      )}

      {expanded && !loading && entries.length === 0 && (
        <div style={{ color: catppuccinMocha.overlay0, fontSize: 10, marginTop: 4 }}>
          No close approaches in the next 60 days
        </div>
      )}

      {expanded && entries.map((e, i) => (
        <div
          key={i}
          style={s.entry}
          onClick={() => onSelect({
            diameter: e.estDiameter,
            velocity: e.vRel,
            density: 2600,
          })}
          onMouseOver={ev => (ev.currentTarget.style.background = catppuccinMocha.surface1)}
          onMouseOut={ev => (ev.currentTarget.style.background = catppuccinMocha.surface0)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: catppuccinMocha.text, fontWeight: 600 }}>{e.des}</span>
            <span style={{ color: catppuccinMocha.overlay1 }}>{e.date}</span>
          </div>
          <div style={{ color: catppuccinMocha.overlay0, marginTop: 2 }}>
            {e.estDiameter >= 1000
              ? `${(e.estDiameter / 1000).toFixed(1)} km`
              : `${e.estDiameter.toFixed(0)} m`}
            {' est, '}
            {(e.vRel / 1000).toFixed(1)} km/s,{' '}
            {e.distKm < 1e6
              ? `${(e.distKm).toFixed(0)} km`
              : `${e.distAu.toFixed(4)} AU`}
          </div>
        </div>
      ))}
    </div>
  );
}
