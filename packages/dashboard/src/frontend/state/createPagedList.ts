import { type Accessor, createEffect, createSignal, on, onCleanup } from "solid-js";

import { type PageResult, isAbort } from "../api.js";
import { appendPage } from "../domain/pages.js";
import { createAutoLoadMore } from "./createAutoLoadMore.js";

export const createPagedList = <TParams, TItem extends { id: string }>(
  params: () => TParams | null,
  fetchPage: (
    params: TParams,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<PageResult<TItem>>,
): {
  items: Accessor<TItem[]>;
  cursor: Accessor<string | null>;
  loading: Accessor<boolean>;
  error: Accessor<unknown>;
  announcement: Accessor<string>;
  retry: () => void;
  autoLoadMore: ReturnType<typeof createAutoLoadMore>;
} => {
  const [items, setItems] = createSignal<TItem[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<unknown>();
  const [announcement, setAnnouncement] = createSignal("");
  let controller: AbortController | null = null;
  let loadMoreController: AbortController | null = null;
  let current: TParams | null = null;

  const abortAll = () => {
    controller?.abort();
    loadMoreController?.abort();
    controller = null;
    loadMoreController = null;
  };

  const reset = () => {
    abortAll();
    setItems([]);
    setCursor(null);
    setError(undefined);
  };

  const load = async (value: TParams) => {
    reset();
    setLoading(true);
    const own = new AbortController();
    controller = own;
    try {
      const page = await fetchPage(value, undefined, own.signal);
      if (own.signal.aborted) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      if (own.signal.aborted || isAbort(err)) return;
      setError(err);
    } finally {
      if (controller === own) setLoading(false);
    }
  };

  createEffect(
    on(params, (value) => {
      current = value;
      if (value === null) {
        reset();
        setLoading(false);
        return;
      }
      void load(value);
    }),
  );

  onCleanup(abortAll);

  const loadMore = async () => {
    const next = cursor();
    const value = current;
    if (!next || value === null) return;
    const own = new AbortController();
    loadMoreController = own;
    let page: PageResult<TItem>;
    try {
      page = await fetchPage(value, next, own.signal);
    } catch (err) {
      if (own.signal.aborted) return;
      throw err;
    }
    if (own.signal.aborted) return;
    setItems((previous) => appendPage(previous, page.items));
    setCursor(page.nextCursor);
    setAnnouncement(`Loaded ${page.items.length} more`);
  };

  return {
    items,
    cursor,
    loading,
    error,
    announcement,
    retry: () => {
      if (current !== null) void load(current);
    },
    autoLoadMore: createAutoLoadMore(loadMore),
  };
};
