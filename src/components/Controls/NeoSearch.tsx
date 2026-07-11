import { useState, useCallback, useRef } from 'react';
import { findFallbackNeo } from '../../data/fallbackNeos';
import { fetchJplJson } from '../../services/jplApi';
import { catppuccinMocha } from '../../theme';

interface SentryRisk {
  impactProbability: number;
  palermoScale: string;
  torinoScale: string;
  impactCount: number;
  yearRange: string;
}

interface NeoResult {
  fullname: string;
  diameter: number;
  velocity: number;
  density: number;
  risk?: SentryRisk;
  source?: string;
}

interface NeoSearchProps {
  onSelect: (neo: NeoResult) => void;
}

interface SbdbPhysPar {
  name: string;
  value?: string | null;
}

interface SbdbOrbitElement {
  name: string;
  value?: string | null;
}

interface SbdbResponse {
  code?: string;
  message?: string;
  object?: {
    fullname?: string;
    des?: string;
    pdes?: string;
  };
  orbit?: {
    elements?: SbdbOrbitElement[];
  };
  phys_par?: SbdbPhysPar[];
}

interface SentryResponse {
  summary?: {
    ip?: string;
    ps_cum?: string;
    ps_max?: string;
    ts_max?: string;
    n_imp?: number;
  };
  data?: {
    date?: string;
  }[];
}

function estimateDensity(specType: string): number {
  const s = (specType || '').toUpperCase();
  if (s.startsWith('M') || s.startsWith('X')) return 5000;
  if (s.startsWith('S') || s.startsWith('Q') || s.startsWith('V')) return 3300;
  if (s.startsWith('C') || s.startsWith('B') || s.startsWith('D') || s.startsWith('P')) return 1800;
  return 2600;
}

function estimateDiameterKm(hMag: number, albedo: number): number {
  return (1329 / Math.sqrt(albedo)) * Math.pow(10, -0.2 * hMag);
}

function valueOf(items: SbdbPhysPar[] | SbdbOrbitElement[] | undefined, name: string): string | undefined {
  return items?.find(item => item.name === name)?.value ?? undefined;
}

function formatProbability(probability: number): string {
  if (!Number.isFinite(probability) || probability <= 0) return '0';
  if (probability >= 0.001) return `${(probability * 100).toFixed(3)}%`;
  return probability.toExponential(2);
}

function sentryYearRange(data: SentryResponse['data']): string {
  const years = (data ?? [])
    .map(entry => Number.parseInt(entry.date?.slice(0, 4) ?? '', 10))
    .filter(Number.isFinite);

  if (years.length === 0) return 'active';
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}-${max}`;
}

async function lookupSentryRisk(designation: string | undefined): Promise<SentryRisk | undefined> {
  if (!designation) return undefined;

  try {
    const params = new URLSearchParams({ des: designation });
    const data = await fetchJplJson<SentryResponse>('sentry.api', params);
    if (!data.summary) return undefined;

    const impactProbability = Number.parseFloat(data.summary.ip ?? '0');
    if (!Number.isFinite(impactProbability) || impactProbability <= 0) return undefined;

    return {
      impactProbability,
      palermoScale: data.summary.ps_cum ?? data.summary.ps_max ?? 'n/a',
      torinoScale: data.summary.ts_max ?? '0',
      impactCount: data.summary.n_imp ?? data.data?.length ?? 0,
      yearRange: sentryYearRange(data.data),
    };
  } catch {
    return undefined;
  }
}

function fallbackResult(query: string): NeoResult | null {
  const fallback = findFallbackNeo(query);
  if (!fallback) return null;
  return {
    fullname: fallback.fullname,
    diameter: fallback.diameter,
    velocity: fallback.velocity,
    density: fallback.density,
    source: 'Built-in fallback',
  };
}

export function NeoSearch({ onSelect }: NeoSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NeoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setNotice('');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');

    try {
      const params = new URLSearchParams({
        sstr: q,
        'phys-par': '1',
      });
      const data = await fetchJplJson<SbdbResponse>('sbdb.api', params);

      if (data.code && data.code !== '200') {
        if (data.message?.includes('not found')) {
          setResults([]);
          setError('No matching objects found');
        } else {
          setError(data.message || 'API error');
        }
        setLoading(false);
        return;
      }

      const obj = data.object;
      if (!obj) {
        setResults([]);
        setLoading(false);
        return;
      }

      const physPar = data.phys_par ?? [];
      let diameter = 0;
      let albedo = 0.15;
      let specType = '';

      const diameterValue = valueOf(physPar, 'diameter');
      if (diameterValue) diameter = Number.parseFloat(diameterValue) * 1000;

      const albedoValue = valueOf(physPar, 'albedo');
      if (albedoValue) albedo = Number.parseFloat(albedoValue);

      specType = valueOf(physPar, 'spec_T') ?? valueOf(physPar, 'spec_B') ?? '';

      if (diameter <= 0) {
        const hMag = valueOf(physPar, 'H');
        if (hMag) {
          diameter = estimateDiameterKm(Number.parseFloat(hMag), albedo) * 1000;
        }
      }

      if (diameter <= 0 || !Number.isFinite(diameter)) diameter = 100;

      const density = estimateDensity(specType);
      let impactVelocity = 20_000;
      const aValue = valueOf(data.orbit?.elements, 'a');
      const eValue = valueOf(data.orbit?.elements, 'e');

      if (aValue && eValue) {
        const a = Number.parseFloat(aValue);
        const ecc = Number.parseFloat(eValue);
        const vInfSq = 29_780 ** 2 * (3 - 1 / a - 2 * Math.sqrt(Math.max(0, a * (1 - ecc * ecc))));
        const vEsc = 11_186;
        impactVelocity = Math.sqrt(Math.max(0, vInfSq) + vEsc ** 2);
      }

      const designation = obj.des ?? obj.pdes;
      const risk = await lookupSentryRisk(designation);

      setResults([{
        fullname: obj.fullname || obj.des || q,
        diameter,
        velocity: impactVelocity,
        density,
        risk,
        source: 'NASA/JPL SBDB',
      }]);
    } catch (err) {
      const fallback = fallbackResult(q);
      if (fallback) {
        setResults([fallback]);
        setNotice('Live JPL lookup unavailable; showing a built-in reference object.');
      } else {
        setError(err instanceof Error ? err.message : 'Network error');
        setResults([]);
      }
    }

    setLoading(false);
  }, []);

  const handleInput = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 500);
  }, [search]);

  const s = {
    container: { marginTop: 16 },
    label: {
      color: catppuccinMocha.subtext0,
      fontSize: 11,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.08em',
      marginBottom: 6,
      display: 'block',
    },
    input: {
      width: '100%',
      padding: '6px 8px',
      background: catppuccinMocha.surface0,
      color: catppuccinMocha.text,
      border: `1px solid ${catppuccinMocha.surface1}`,
      borderRadius: 6,
      fontSize: 13,
      outline: 'none',
      boxSizing: 'border-box' as const,
    },
    result: {
      padding: '6px 8px',
      background: catppuccinMocha.surface0,
      border: `1px solid ${catppuccinMocha.surface1}`,
      borderRadius: 6,
      marginTop: 4,
      cursor: 'pointer',
      fontSize: 12,
    },
    hint: {
      color: catppuccinMocha.overlay0,
      fontSize: 10,
      marginTop: 4,
    },
    risk: {
      marginTop: 5,
      padding: '4px 6px',
      borderRadius: 4,
      border: `1px solid ${catppuccinMocha.peach}`,
      color: catppuccinMocha.yellow,
      background: `${catppuccinMocha.crust}aa`,
      fontSize: 10,
      lineHeight: 1.35,
    },
  };

  return (
    <div style={s.container}>
      <span style={s.label}>NASA NEO Lookup</span>
      <input
        type="text"
        style={s.input}
        placeholder="e.g. Apophis, Bennu, 1979 XB"
        value={query}
        onChange={e => handleInput(e.target.value)}
        onFocus={e => (e.target.style.borderColor = catppuccinMocha.blue)}
        onBlur={e => (e.target.style.borderColor = catppuccinMocha.surface1)}
      />
      {loading && <div style={s.hint}>Searching JPL database...</div>}
      {error && <div style={{ ...s.hint, color: catppuccinMocha.red }}>{error}</div>}
      {notice && <div style={{ ...s.hint, color: catppuccinMocha.yellow }}>{notice}</div>}
      {results.map((neo, i) => (
        <div
          key={i}
          style={s.result}
          onClick={() => onSelect(neo)}
          onMouseOver={e => (e.currentTarget.style.background = catppuccinMocha.surface1)}
          onMouseOut={e => (e.currentTarget.style.background = catppuccinMocha.surface0)}
        >
          <div style={{ color: catppuccinMocha.text, fontWeight: 600 }}>{neo.fullname}</div>
          <div style={{ color: catppuccinMocha.overlay1, marginTop: 2 }}>
            {neo.diameter >= 1000
              ? `${(neo.diameter / 1000).toFixed(1)} km`
              : `${neo.diameter.toFixed(0)} m`}
            {' dia, '}
            {(neo.velocity / 1000).toFixed(1)} km/s,{' '}
            {neo.density} kg/m3
          </div>
          {neo.risk && (
            <div style={s.risk}>
              Sentry risk: {formatProbability(neo.risk.impactProbability)} impact probability,
              {' '}
              Palermo {neo.risk.palermoScale}, Torino {neo.risk.torinoScale},
              {' '}
              {neo.risk.impactCount} corridor{neo.risk.impactCount === 1 ? '' : 's'} ({neo.risk.yearRange})
            </div>
          )}
          <div style={{ color: catppuccinMocha.green, marginTop: 2, fontSize: 11 }}>
            Click to simulate impact
          </div>
          {neo.source && (
            <div style={{ color: catppuccinMocha.overlay0, marginTop: 2, fontSize: 10 }}>
              {neo.source}
            </div>
          )}
        </div>
      ))}
      {!loading && !error && results.length === 0 && query.length >= 2 && (
        <div style={s.hint}>Type an asteroid name or designation</div>
      )}
    </div>
  );
}
