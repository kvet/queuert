import { type Accessor, createEffect, createSignal, on, onCleanup } from "solid-js";

import { type PageResult, isAbort } from "../api.js";
import { appendPage, mergeRefreshedPage } from "../domain/pages.js";
import { createAutoLoadMore } from "./createAutoLoadMore.js";
import { markLoaded } from "./refresh.js";

/**
 * Cursor-paged list state for the list pages. A change of `params` loads page 1 from scratch;
 * scrolling appends pages via {@link createAutoLoadMore}. `refresh()` never replaces loaded pages
 * or moves the scroll position: it fetches page 1 again and, when the IDs at the top differ, parks
 * it in `fresh` so the page can offer a "List has changed · Show" banner (`applyFresh`). When the
 * IDs are unchanged, those same rows are updated in place.
 */
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
  fresh: Accessor<PageResult<TItem> | null>;
  announcement: Accessor<string>;
  applyFresh: () => void;
  refresh: () => Promise<void>;
  retry: () => void;
  autoLoadMore: ReturnType<typeof createAutoLoadMore>;
} => {
  const [items, setItems] = createSignal<TItem[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<unknown>();
  const [fresh, setFresh] = createSignal<PageResult<TItem> | null>(null);
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
    setFresh(null);
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
      markLoaded();
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

  const refresh = async () => {
    const value = current;
    if (value === null || loading()) return;
    if (error() !== undefined) {
      await load(value);
      // `load` keeps its error in `error()`; surface it so the refresh isn't reported as done.
      const failure = error();
      if (failure !== undefined) {
        throw failure instanceof Error ? failure : new Error("Refresh failed", { cause: failure });
      }
      return;
    }
    controller?.abort();
    const own = new AbortController();
    controller = own;
    let page: PageResult<TItem>;
    try {
      page = await fetchPage(value, undefined, own.signal);
    } catch (err) {
      // A newer load or refresh took over; that's not a failed refresh.
      if (own.signal.aborted || isAbort(err)) return;
      throw err;
    }
    if (own.signal.aborted) return;
    const merged = mergeRefreshedPage(items(), page.items);
    if (merged.kind === "replace") {
      setItems(page.items);
      setCursor(page.nextCursor);
      setFresh(null);
    } else if (merged.kind === "update") {
      setItems(merged.items);
      setFresh(null);
    } else {
      setFresh(page);
    }
  };

  const applyFresh = () => {
    const page = fresh();
    if (!page) return;
    loadMoreController?.abort();
    loadMoreController = null;
    setItems(page.items);
    setCursor(page.nextCursor);
    setFresh(null);
    window.scrollTo({ top: 0 });
  };

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
    fresh,
    announcement,
    applyFresh,
    refresh,
    retry: () => {
      if (current !== null) void load(current);
    },
    autoLoadMore: createAutoLoadMore(loadMore),
  };
};
