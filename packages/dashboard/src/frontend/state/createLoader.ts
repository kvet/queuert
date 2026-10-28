import { type Accessor, createEffect, createSignal, on, onCleanup } from "solid-js";

import { isAbort } from "../api.js";

export const createLoader = <TSource, TData>(
  source: () => TSource | false | null | undefined,
  fetcher: (source: TSource, signal: AbortSignal) => Promise<TData>,
): {
  data: Accessor<TData | undefined>;
  error: Accessor<unknown>;
  loading: Accessor<boolean>;
  retry: () => void;
  mutate: (data: TData) => void;
} => {
  const [data, setData] = createSignal<TData>();
  const [error, setError] = createSignal<unknown>();
  const [loading, setLoading] = createSignal(false);
  let controller: AbortController | null = null;
  let current: TSource | undefined;

  const run = async (value: TSource): Promise<void> => {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    setData(undefined);
    setError(undefined);
    setLoading(true);
    try {
      const result = await fetcher(value, own.signal);
      if (own.signal.aborted) return;
      setData(() => result);
    } catch (err) {
      if (own.signal.aborted || isAbort(err)) return;
      setError(err);
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
      void run(value);
    }),
  );

  onCleanup(() => {
    controller?.abort();
  });

  return {
    data,
    error,
    loading,
    retry: () => {
      if (current !== undefined) void run(current);
    },
    mutate: (next) => setData(() => next),
  };
};
