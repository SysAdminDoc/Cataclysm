import { useCallback, useEffect, useRef, useState } from "react";
import type { RunupAtPointResult } from "../lib/tauri";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";
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

function initialState(
  plan: FacilityQueryPlan,
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
): HumanitarianFacilityState {
  return {
    status: "idle",
    facilities: [],
    message: t("layers.noRequest"),
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
  const { t, formatNumber } = useI18n();
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
  const [state, setState] = useState<HumanitarianFacilityState>(() => initialState(plan, t));

  useEffect(() => {
    if (!enabled) {
      setState(initialState(plan, t));
      return;
    }
    if (plan.discs.length === 0) {
      setState({
        ...initialState(plan, t),
        status: "empty",
        message: t("layers.advanceTimeline"),
      });
      return;
    }

    const freshCache = readFacilityCache(plan.signature);
    if (freshCache) {
      setState({
        status: freshCache.dataset.facilities.length > 0 ? "ready" : "empty",
        facilities: freshCache.dataset.facilities,
        message: freshCache.dataset.facilities.length > 0
          ? t("layers.loadedCache")
          : t("layers.noMappedFacilities"),
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
          ? t("layers.offlineOlderCache")
          : t("layers.offlineNoCache"),
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
      message: t("layers.queryingOsm"),
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
              ? t("layers.mappedFacilities", { count: formatNumber(dataset.facilities.length) })
              : t("layers.noMappedFacilities"),
            cached: false,
            stale: false,
            fetchedAt: dataset.fetchedAt,
            osmDataTimestamp: dataset.osmDataTimestamp,
            plan,
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.warn("[facilities] OpenStreetMap query failed", error);
          setState({
            status: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error",
            facilities: staleCache?.dataset.facilities ?? [],
            message: staleCache ? t("layers.showingCache") : t("layers.unavailable"),
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
  }, [enabled, formatNumber, plan, refreshNonce, t]);

  const refresh = useCallback(() => {
    removeFacilityCache(plan.signature);
    setRefreshNonce((nonce) => nonce + 1);
  }, [plan.signature]);

  return { state, refresh };
}
