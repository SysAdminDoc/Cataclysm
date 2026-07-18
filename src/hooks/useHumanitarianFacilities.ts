import { useCallback, useEffect, useRef, useState } from "react";
import type { RunupAtPointResult } from "../lib/tauri";
import {
  buildFacilityQueryPlan,
  fetchHumanitarianFacilities,
  readFacilityCache,
  removeFacilityCache,
  writeFacilityCache,
  type FacilityQueryPlan,
  type HumanitarianFacility,
} from "../lib/osm-facilities";

export type HumanitarianFacilityStatus = "idle" | "loading" | "ready" | "empty" | "offline" | "error";

export type HumanitarianFacilityState = {
  status: HumanitarianFacilityStatus;
  facilities: HumanitarianFacility[];
  message: string;
  cached: boolean;
  stale: boolean;
  fetchedAt: number | null;
  osmDataTimestamp: string | null;
  plan: FacilityQueryPlan;
};

function initialState(plan: FacilityQueryPlan): HumanitarianFacilityState {
  return {
    status: "idle",
    facilities: [],
    message: "Off — no network request has been made.",
    cached: false,
    stale: false,
    fetchedAt: null,
    osmDataTimestamp: null,
    plan,
  };
}

export function useHumanitarianFacilities(
  enabled: boolean,
  runupResults: readonly RunupAtPointResult[],
): { state: HumanitarianFacilityState; refresh: () => void } {
  const planKey = runupResults.map((result) => [
    result.id,
    result.lat,
    result.lon,
    result.has_arrived ? 1 : 0,
    result.inundation_extent_m,
  ].join(":")).join("|");
  const planCacheRef = useRef<{ key: string; plan: FacilityQueryPlan } | null>(null);
  if (planCacheRef.current?.key !== planKey) {
    planCacheRef.current = { key: planKey, plan: buildFacilityQueryPlan(runupResults) };
  }
  const plan = planCacheRef.current.plan;
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [state, setState] = useState<HumanitarianFacilityState>(() => initialState(plan));

  useEffect(() => {
    if (!enabled) {
      setState(initialState(plan));
      return;
    }
    if (plan.discs.length === 0) {
      setState({
        ...initialState(plan),
        status: "empty",
        message: "Advance the timeline until a modeled coastal inundation extent is active.",
      });
      return;
    }

    const freshCache = readFacilityCache(plan.signature);
    if (freshCache) {
      setState({
        status: freshCache.dataset.facilities.length > 0 ? "ready" : "empty",
        facilities: freshCache.dataset.facilities,
        message: freshCache.dataset.facilities.length > 0
          ? "Loaded from the local 24-hour cache."
          : "No mapped facilities were found inside the screened extents.",
        cached: true,
        stale: false,
        fetchedAt: freshCache.dataset.fetchedAt,
        osmDataTimestamp: freshCache.dataset.osmDataTimestamp,
        plan,
      });
      return;
    }

    const staleCache = readFacilityCache(plan.signature, { allowStale: true });
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    if (!online) {
      setState({
        status: "offline",
        facilities: staleCache?.dataset.facilities ?? [],
        message: staleCache
          ? "Offline — showing an older local cache."
          : "Offline — no cached facility data is available for these extents.",
        cached: Boolean(staleCache),
        stale: Boolean(staleCache?.stale),
        fetchedAt: staleCache?.dataset.fetchedAt ?? null,
        osmDataTimestamp: staleCache?.dataset.osmDataTimestamp ?? null,
        plan,
      });
      return;
    }

    const controller = new AbortController();
    setState({
      status: "loading",
      facilities: staleCache?.dataset.facilities ?? [],
      message: "Querying the public OpenStreetMap Overpass service…",
      cached: Boolean(staleCache),
      stale: Boolean(staleCache),
      fetchedAt: staleCache?.dataset.fetchedAt ?? null,
      osmDataTimestamp: staleCache?.dataset.osmDataTimestamp ?? null,
      plan,
    });
    const timer = window.setTimeout(() => {
      void fetchHumanitarianFacilities(plan, { signal: controller.signal })
        .then((dataset) => {
          writeFacilityCache(dataset);
          setState({
            status: dataset.facilities.length > 0 ? "ready" : "empty",
            facilities: dataset.facilities,
            message: dataset.facilities.length > 0
              ? `Mapped ${dataset.facilities.length} facilities inside the screened extents.`
              : "No mapped facilities were found inside the screened extents.",
            cached: false,
            stale: false,
            fetchedAt: dataset.fetchedAt,
            osmDataTimestamp: dataset.osmDataTimestamp,
            plan,
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          const message = error instanceof Error ? error.message : String(error);
          setState({
            status: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error",
            facilities: staleCache?.dataset.facilities ?? [],
            message: staleCache
              ? `${message} Showing the last local cache.`
              : message,
            cached: Boolean(staleCache),
            stale: Boolean(staleCache),
            fetchedAt: staleCache?.dataset.fetchedAt ?? null,
            osmDataTimestamp: staleCache?.dataset.osmDataTimestamp ?? null,
            plan,
          });
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, plan, refreshNonce]);

  const refresh = useCallback(() => {
    removeFacilityCache(plan.signature);
    setRefreshNonce((nonce) => nonce + 1);
  }, [plan.signature]);

  return { state, refresh };
}
