import { type Accessor, createEffect, createSignal, on, onCleanup } from "solid-js";

import { isAbort, isNotFound } from "../api.js";
import { markLoaded } from "./refresh.js";

/**
 * Loads data for a reactive `source` and keeps it fresh without flashing:
 *
 * - A change of `source` is a first load: data clears, `loading` is set, and errors land in `error`.
 * - `refetch()` keeps the current data visible until the new data arrives and rejects on failure
 *   (the caller decides how to report it) instead of replacing the view with an error. While a
 *   first load is in flight it does nothing, so a failed refresh can't strand an empty view. A
 *   404 is the exception: the record was deleted, so it lands in `error` like a first load would.
 * - Every request gets its own `AbortController`, and a newer request aborts the older one, so a
 *   stale response can never overwrite newer filters.
 *
 * A `false`, `null` or `undefined` `source` means "nothing to load" and clears the data.
 */
export const createLoader = <TSource, TData>(
  source: () => TSource | false | null | undefined,
  fetcher: (source: TSource, signal: AbortSignal) => Promise<TData>,
): {
  data: Accessor<TData | undefined>;
  error: Accessor<unknown>;
  loading: Accessor<boolean>;
  refetch: () => Promise<void>;
  retry: () => void;
  mutate: (data: TData) => void;
} => {
  const [data, setData] = createSignal<TData>();
  const [error, setError] = createSignal<unknown>();
  const [loading, setLoading] = createSignal(false);
  let controller: AbortController | null = null;
  let current: TSource | undefined;

  const run = async (value: TSource, mode: "load" | "refresh"): Promise<void> => {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    if (mode === "load") {
      setData(undefined);
      setError(undefined);
      setLoading(true);
    }
    try {
      const result = await fetcher(value, own.signal);
      if (own.signal.aborted) return;
      setData(() => result);
      setError(undefined);
      if (mode === "load") markLoaded();
    } catch (err) {
      if (own.signal.aborted || isAbort(err)) return;
      // A record deleted since it loaded shows as gone instead of staying on screen stale.
      if (mode === "load" || isNotFound(err)) {
        setData(undefined);
        setError(err);
      } else throw err;
    } finally {
      if (controller === own) setLoading(false);
    }
  };

  createEffect(
    on(source, (value) => {
      if (value === false || value === null || value === undefined) {
        controller?.abort();
        current = undefined;
        setData(undefined);
        setError(undefined);
        setLoading(false);
        return;
      }
      current = value;
      void run(value, "load");
    }),
  );

  onCleanup(() => {
    controller?.abort();
  });

  return {
    data,
    error,
    loading,
    refetch: async () => {
      if (current !== undefined && !loading()) await run(current, "refresh");
    },
    retry: () => {
      if (current !== undefined) void run(current, "load");
    },
    mutate: (next) => setData(() => next),
  };
};
