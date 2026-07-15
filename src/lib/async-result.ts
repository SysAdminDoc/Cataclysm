export type AsyncResult<T> =
  | { status: "idle" }
  | { status: "loading"; previous?: T }
  | { status: "empty"; value: T }
  | { status: "ready"; value: T }
  | { status: "stale"; value: T; error: string }
  | { status: "error"; error: string };

type ResultWithValue<T> = Extract<
  AsyncResult<T>,
  { value: T } | { previous: T }
>;

export function asyncResultValue<T>(result: AsyncResult<T>): T | null {
  if ("value" in result) return result.value;
  if (result.status === "loading" && result.previous !== undefined) return result.previous;
  return null;
}

export function hasAsyncResultValue<T>(result: AsyncResult<T>): result is ResultWithValue<T> {
  return asyncResultValue(result) !== null;
}

export function startAsyncResult<T>(previous: AsyncResult<T>, retain = true): AsyncResult<T> {
  const value = retain ? asyncResultValue(previous) : null;
  return value === null ? { status: "loading" } : { status: "loading", previous: value };
}

export function resolveAsyncResult<T>(value: T, isEmpty: (value: T) => boolean): AsyncResult<T> {
  return isEmpty(value) ? { status: "empty", value } : { status: "ready", value };
}

export function rejectAsyncResult<T>(previous: AsyncResult<T>, error: unknown): AsyncResult<T> {
  const message = error instanceof Error ? error.message : String(error);
  const value = asyncResultValue(previous);
  return value === null ? { status: "error", error: message } : { status: "stale", value, error: message };
}
