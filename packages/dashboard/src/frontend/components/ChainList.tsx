import { A, useSearchParams } from "@solidjs/router";
import { For, Show, createMemo, createResource, createSignal } from "solid-js";

import { PAGE_SIZE, type UnknownChain, listChains } from "../api.js";
import { createAutoLoadMore } from "./createAutoLoadMore.js";
import { ChainStatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

export function ChainList() {
  const [searchParams, setSearchParams] = useSearchParams();

  const typeName = () => (searchParams.typeName ?? "") as string;
  const status = () => (searchParams.status ?? "") as string;
  const id = () => (searchParams.id ?? "") as string;
  const independent = () => searchParams.independent !== "false";
  const orderBy = () => (searchParams.orderBy ?? "") as string;
  const orderDirection = () => (searchParams.orderDirection ?? "desc") as string;

  const orderByOptions = createMemo(() => {
    const s = status();
    if (s === "completed")
      return [
        { value: "completedAt", label: "Completed" },
        { value: "createdAt", label: "Created" },
      ] as const;
    return [{ value: "createdAt", label: "Created" }] as const;
  });

  const effectiveOrderBy = createMemo(() => {
    const v = orderBy();
    const opts = orderByOptions();
    return v && opts.some((o) => o.value === v) ? v : opts[0].value;
  });

  const cardDate = (chain: UnknownChain): Date => {
    if (effectiveOrderBy() === "completedAt" && chain.status === "completed")
      return chain.completedAt;
    return chain.createdAt;
  };

  const [items, setItems] = createSignal<UnknownChain[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  let loadMoreController: AbortController | null = null;

  const [page] = createResource(
    () => ({
      typeName: typeName(),
      status: status(),
      id: id(),
      independent: independent(),
      orderBy: orderBy() || undefined,
      orderDirection: orderDirection() || undefined,
    }),
    async (params) => {
      loadMoreController?.abort();
      loadMoreController = null;
      const result = await listChains({
        ...params,
        independent: params.independent,
        limit: PAGE_SIZE,
      });
      setItems(result.items);
      setCursor(result.nextCursor);
      return result;
    },
  );

  const loadMore = async () => {
    const c = cursor();
    if (!c) return;
    const controller = new AbortController();
    loadMoreController = controller;
    let result: Awaited<ReturnType<typeof listChains>>;
    try {
      result = await listChains({
        typeName: typeName(),
        status: status(),
        id: id(),
        independent: independent(),
        orderBy: orderBy() || undefined,
        orderDirection: orderDirection() || undefined,
        cursor: c,
        limit: PAGE_SIZE,
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      throw e;
    }
    if (controller.signal.aborted) return;
    setItems((prev) => [...prev, ...result.items]);
    setCursor(result.nextCursor);
  };

  const autoLoadMore = createAutoLoadMore(loadMore);

  const inputPreview = (data: unknown): string => {
    if (data == null) return "";
    const s = JSON.stringify(data);
    return s.length > 80 ? s.slice(0, 77) + "..." : s;
  };

  return (
    <div>
      <div class="filter-bar">
        <input
          type="text"
          placeholder="Chain ID"
          value={id()}
          onChange={(e) => {
            setSearchParams({ id: e.target.value.trim() || undefined });
          }}
        />
        <input
          type="text"
          placeholder="Type name"
          value={typeName()}
          onChange={(e) => {
            setSearchParams({ typeName: e.target.value.trim() || undefined });
          }}
        />
        <select
          value={status()}
          onChange={(e) => {
            setSearchParams({ status: e.target.value || undefined, orderBy: undefined });
          }}
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
        </select>
        <select
          value={orderBy() || orderByOptions()[0].value}
          onChange={(e) => {
            setSearchParams({ orderBy: e.target.value || undefined });
          }}
        >
          <For each={orderByOptions()}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>
        <button
          class="order-direction-btn"
          title={orderDirection() === "asc" ? "Ascending" : "Descending"}
          onClick={() => {
            setSearchParams({ orderDirection: orderDirection() === "asc" ? "desc" : "asc" });
          }}
        >
          {orderDirection() === "asc" ? "↑" : "↓"}
        </button>
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={independent()}
            onChange={(e) => {
              setSearchParams({ independent: e.target.checked ? undefined : "false" });
            }}
          />
          Independent only
        </label>
      </div>

      <Show when={!page.loading && items().length === 0}>
        <div class="empty">No chains found</div>
      </Show>

      <For each={items()}>
        {(chain) => (
          <div class="card">
            <A
              class="card-link"
              href={`/chains/${chain.id}`}
              aria-label={`Open chain ${chain.id}`}
            />
            <div class="card-header">
              <span class="card-type">
                {chain.typeName}
                <button
                  class="filter-btn"
                  title={`Filter by ${chain.typeName}`}
                  onClick={() => {
                    setSearchParams({ typeName: chain.typeName });
                  }}
                />
              </span>
              <span class="card-id">
                {chain.id}
                <button
                  class="filter-btn"
                  title={`Filter by ${chain.id}`}
                  onClick={() => {
                    setSearchParams({ id: chain.id });
                  }}
                />
              </span>
              <span class="card-time">
                <TimeAgo date={cardDate(chain)} />
              </span>
            </div>
            <div class="card-meta">
              <ChainStatusBadge chain={chain} />
            </div>
            <Show when={chain.input != null}>
              <div class="card-input">{inputPreview(chain.input)}</div>
            </Show>
          </div>
        )}
      </For>

      <Show when={cursor()}>
        <button
          class="load-more"
          ref={autoLoadMore.ref}
          disabled={autoLoadMore.loading()}
          onClick={() => {
            autoLoadMore.trigger();
          }}
        >
          {autoLoadMore.loading() ? "Loading…" : autoLoadMore.failed() ? "Retry" : "Load more"}
        </button>
      </Show>
    </div>
  );
}
