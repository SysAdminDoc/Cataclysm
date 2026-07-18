export const LAYER_IDS = [
  "source",
  "wavefront",
  "swe-field",
  "arrival-isochrones",
  "coastal-runup",
  "humanitarian-facilities",
  "dart-observations",
  "hazard-rings",
  "fallout-plume",
] as const;

export type LayerId = (typeof LAYER_IDS)[number];
export type LayerDomain = "tsunami" | "asteroid" | "nuclear";

export type LayerSetting = Readonly<{
  id: LayerId;
  visible: boolean;
  opacity: number;
  order: number;
}>;

export type LayerState = Readonly<Record<LayerId, LayerSetting>>;

export type LayerExportRecord = Readonly<{
  id: LayerId;
  visible: boolean;
  opacityPct: number;
  order: number;
}>;

type StoredScenario = Readonly<{
  scenarioKey: string;
  domain: LayerDomain;
  updatedAt: number;
  layers: readonly LayerSetting[];
}>;

type StoredWorkspace = Readonly<{
  version: 1;
  scenarios: readonly StoredScenario[];
}>;

export const LAYER_STORAGE_KEY = "cataclysm.layer-controller.v1";
const MAX_SCENARIOS = 64;

const DOMAIN_ORDERS: Record<LayerDomain, readonly LayerId[]> = {
  tsunami: [
    "humanitarian-facilities",
    "dart-observations",
    "coastal-runup",
    "arrival-isochrones",
    "swe-field",
    "wavefront",
    "source",
  ],
  asteroid: ["hazard-rings", "source"],
  nuclear: ["fallout-plume", "hazard-rings", "source"],
};

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.max(0.1, Math.min(1, value)) * 100) / 100;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildLayerScenarioKey(domain: LayerDomain, stableId: string | null, input: unknown): string {
  if (stableId?.trim()) return `${domain}:id:${stableId.trim().slice(0, 180)}`;
  try {
    return `${domain}:custom:${fnv1a(JSON.stringify(input ?? null))}`;
  } catch {
    return `${domain}:custom:unserializable`;
  }
}

export function applicableLayerIds(domain: LayerDomain): readonly LayerId[] {
  return DOMAIN_ORDERS[domain];
}

export function defaultLayerState(domain: LayerDomain): LayerState {
  const applicable = new Set(applicableLayerIds(domain));
  const result = {} as Record<LayerId, LayerSetting>;
  for (const id of LAYER_IDS) {
    const order = DOMAIN_ORDERS[domain].indexOf(id);
    result[id] = Object.freeze({
      id,
      visible: applicable.has(id) && id !== "humanitarian-facilities",
      opacity: id === "swe-field" ? 0.9 : 1,
      order: order < 0 ? LAYER_IDS.length : order,
    });
  }
  return Object.freeze(result);
}

function normalizeLayerState(domain: LayerDomain, candidates: readonly LayerSetting[]): LayerState {
  const defaults = defaultLayerState(domain);
  const candidateById = new Map<LayerId, LayerSetting>();
  for (const candidate of candidates) {
    if (!LAYER_IDS.includes(candidate.id)) continue;
    if (candidateById.has(candidate.id)) continue;
    candidateById.set(candidate.id, candidate);
  }
  const ordered = applicableLayerIds(domain)
    .map((id) => candidateById.get(id) ?? defaults[id])
    .sort((left, right) => {
      const leftOrder = Number.isSafeInteger(left.order) ? left.order : defaults[left.id].order;
      const rightOrder = Number.isSafeInteger(right.order) ? right.order : defaults[right.id].order;
      return leftOrder - rightOrder || defaults[left.id].order - defaults[right.id].order;
    });
  const result = { ...defaults } as Record<LayerId, LayerSetting>;
  ordered.forEach((candidate, order) => {
    result[candidate.id] = Object.freeze({
      id: candidate.id,
      visible: candidate.visible === true,
      opacity: clampOpacity(candidate.opacity),
      order,
    });
  });
  return Object.freeze(result);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLayerSetting(value: unknown): LayerSetting | null {
  if (!isObject(value) || typeof value.id !== "string" || !LAYER_IDS.includes(value.id as LayerId)) return null;
  if (typeof value.visible !== "boolean" || typeof value.opacity !== "number" || typeof value.order !== "number") return null;
  return { id: value.id as LayerId, visible: value.visible, opacity: value.opacity, order: value.order };
}

function parseWorkspace(raw: string | null): StoredWorkspace {
  if (!raw) return { version: 1, scenarios: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.scenarios)) {
      return { version: 1, scenarios: [] };
    }
    const scenarios: StoredScenario[] = [];
    for (const value of parsed.scenarios.slice(0, MAX_SCENARIOS)) {
      if (!isObject(value)
        || typeof value.scenarioKey !== "string"
        || value.scenarioKey.length === 0
        || value.scenarioKey.length > 240
        || !["tsunami", "asteroid", "nuclear"].includes(String(value.domain))
        || typeof value.updatedAt !== "number"
        || !Array.isArray(value.layers)) continue;
      const layers = value.layers.map(parseLayerSetting).filter((layer): layer is LayerSetting => layer !== null);
      scenarios.push({
        scenarioKey: value.scenarioKey,
        domain: value.domain as LayerDomain,
        updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
        layers,
      });
    }
    return { version: 1, scenarios };
  } catch {
    return { version: 1, scenarios: [] };
  }
}

export function loadScenarioLayerState(
  scenarioKey: string,
  domain: LayerDomain,
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
): LayerState {
  try {
    const workspace = parseWorkspace(storage?.getItem(LAYER_STORAGE_KEY) ?? null);
    const stored = workspace.scenarios.find((scenario) => scenario.scenarioKey === scenarioKey && scenario.domain === domain);
    return stored ? normalizeLayerState(domain, stored.layers) : defaultLayerState(domain);
  } catch {
    return defaultLayerState(domain);
  }
}

export function saveScenarioLayerState(
  scenarioKey: string,
  domain: LayerDomain,
  state: LayerState,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
  now = Date.now(),
): void {
  if (!storage || scenarioKey.length === 0 || scenarioKey.length > 240) return;
  try {
    const workspace = parseWorkspace(storage.getItem(LAYER_STORAGE_KEY));
    const next: StoredScenario = {
      scenarioKey,
      domain,
      updatedAt: now,
      layers: applicableLayerIds(domain).map((id) => state[id]),
    };
    const scenarios = [
      next,
      ...workspace.scenarios.filter((scenario) => scenario.scenarioKey !== scenarioKey || scenario.domain !== domain),
    ]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SCENARIOS);
    storage.setItem(LAYER_STORAGE_KEY, JSON.stringify({ version: 1, scenarios } satisfies StoredWorkspace));
  } catch {
    // The view remains fully usable when storage is unavailable or full.
  }
}

export function updateLayerSetting(
  state: LayerState,
  id: LayerId,
  patch: Partial<Pick<LayerSetting, "visible" | "opacity">>,
): LayerState {
  return Object.freeze({
    ...state,
    [id]: Object.freeze({
      ...state[id],
      visible: patch.visible ?? state[id].visible,
      opacity: patch.opacity === undefined ? state[id].opacity : clampOpacity(patch.opacity),
    }),
  });
}

export function moveLayer(state: LayerState, domain: LayerDomain, id: LayerId, delta: -1 | 1): LayerState {
  const ordered = applicableLayerIds(domain)
    .map((layerId) => state[layerId])
    .sort((left, right) => left.order - right.order);
  const index = ordered.findIndex((layer) => layer.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ordered.length) return state;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  const next = { ...state } as Record<LayerId, LayerSetting>;
  ordered.forEach((layer, order) => {
    next[layer.id] = Object.freeze({ ...layer, order });
  });
  return Object.freeze(next);
}

export function orderedLayerSettings(state: LayerState, domain: LayerDomain): LayerSetting[] {
  return applicableLayerIds(domain)
    .map((id) => state[id])
    .sort((left, right) => left.order - right.order);
}

export function layerExportRecords(state: LayerState, domain: LayerDomain): LayerExportRecord[] {
  return orderedLayerSettings(state, domain).map((layer) => ({
    id: layer.id,
    visible: layer.visible,
    opacityPct: Math.round(layer.opacity * 100),
    order: layer.order,
  }));
}
