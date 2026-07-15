import { describe, expect, it } from "vitest";
import {
  asyncResultValue,
  rejectAsyncResult,
  resolveAsyncResult,
  startAsyncResult,
  type AsyncResult,
} from "../async-result";

describe("AsyncResult", () => {
  it("distinguishes valid empty data from idle and errors", () => {
    expect(resolveAsyncResult([], (items) => items.length === 0)).toEqual({
      status: "empty",
      value: [],
    });
    expect(asyncResultValue({ status: "idle" })).toBeNull();
    expect(asyncResultValue({ status: "error", error: "failed" })).toBeNull();
  });

  it("retains a previous value while refreshing and after a failed refresh", () => {
    const ready: AsyncResult<number[]> = { status: "ready", value: [1, 2] };
    const loading = startAsyncResult(ready);
    expect(loading).toEqual({ status: "loading", previous: [1, 2] });
    expect(rejectAsyncResult(loading, new Error("offline"))).toEqual({
      status: "stale",
      value: [1, 2],
      error: "offline",
    });
  });

  it("does not retain data when a new context makes it unsafe", () => {
    const ready: AsyncResult<number> = { status: "ready", value: 7 };
    expect(startAsyncResult(ready, false)).toEqual({ status: "loading" });
    expect(rejectAsyncResult(startAsyncResult(ready, false), "bad input")).toEqual({
      status: "error",
      error: "bad input",
    });
  });
});
