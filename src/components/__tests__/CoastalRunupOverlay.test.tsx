import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoastalRunupOverlay } from "../CoastalRunupOverlay";
import type { AsyncResult } from "../../lib/async-result";
import type { RunupAtPointResult } from "../../lib/tauri";
import type { InitialDisplacement } from "../../types/scenario";

const tauriApi = vi.hoisted(() => ({ runupAtPoints: vi.fn() }));

vi.mock("../../lib/tauri", () => ({
  api: tauriApi,
  isTauri: () => true,
}));

const INITIAL: InitialDisplacement = {
  center: { lat_deg: 38.3, lon_deg: 142.37, depth_m: 4000 },
  cavity_radius_m: 50_000,
  peak_amplitude_m: 4,
  source_energy_j: 1e18,
  seismic_mw_equivalent: 8,
  label: "Test source",
};

const RESULT = {
  id: "tokyo",
  name: "Tokyo",
  runup_m: 1.2,
  has_arrived: true,
} as RunupAtPointResult;

function Harness({ timeS }: { timeS: number }) {
  const [result, setResult] = useState<AsyncResult<RunupAtPointResult[]>>({ status: "idle" });
  const count = "value" in result ? result.value.length : result.status === "loading" ? result.previous?.length ?? 0 : 0;
  return (
    <>
      <output data-testid="coastal-state">{result.status}:{count}</output>
      <CoastalRunupOverlay
        initial={INITIAL}
        activePreset={null}
        sourceKind="Asteroid"
        timeS={timeS}
        result={result}
        onResult={setResult}
      />
    </>
  );
}

describe("CoastalRunupOverlay async state", () => {
  beforeEach(() => tauriApi.runupAtPoints.mockReset());

  it("distinguishes a failed first computation from a valid empty result", async () => {
    tauriApi.runupAtPoints.mockRejectedValueOnce(new Error("backend unavailable"));
    const { rerender } = render(<Harness timeS={0} />);
    await waitFor(() => expect(screen.getByTestId("coastal-state")).toHaveTextContent("error:0"));
    expect(screen.getByText(/Coastal screening failed: backend unavailable/)).toBeInTheDocument();

    tauriApi.runupAtPoints.mockResolvedValueOnce([]);
    rerender(<Harness timeS={60} />);
    await waitFor(() => expect(screen.getByTestId("coastal-state")).toHaveTextContent("empty:0"));
  });

  it("retains the last valid result as stale when a refresh fails", async () => {
    tauriApi.runupAtPoints.mockResolvedValueOnce([RESULT]);
    const { rerender } = render(<Harness timeS={0} />);
    await waitFor(() => expect(screen.getByTestId("coastal-state")).toHaveTextContent("ready:1"));

    tauriApi.runupAtPoints.mockRejectedValueOnce(new Error("refresh failed"));
    rerender(<Harness timeS={60} />);
    await waitFor(() => expect(screen.getByTestId("coastal-state")).toHaveTextContent("stale:1"));
    expect(screen.getByText(/Coastal screening is stale: refresh failed/)).toBeInTheDocument();
  });
});
