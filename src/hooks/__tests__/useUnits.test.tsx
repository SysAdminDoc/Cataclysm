import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useUnits } from "../useUnits";

describe("useUnits", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tsunamisim.units", JSON.stringify("metric"));
  });

  it("reacts immediately when Settings saves a new persisted unit system", async () => {
    const { result } = renderHook(() => useUnits());
    await waitFor(() => expect(result.current).toBe("metric"));

    localStorage.setItem("tsunamisim.units", JSON.stringify("imperial"));
    act(() => window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved")));

    await waitFor(() => expect(result.current).toBe("imperial"));
  });
});
