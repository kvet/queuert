import { A, useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";

import {
  PAGE_SIZE,
  type UnknownChain,
  getChainsByIds,
  listChainTypeNames,
  listChains,
} from "../api.js";
import { createAutoLoadMore } from "./createAutoLoadMore.js";
import { ChainStatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

export function ChainList() {
  const [searchParams, setSearchParams] = useSearchParams();

  const typeName = () => (searchParams.typeName ?? "") as string;
  const status = () => (searchParams.status ?? "") as string;
  const ids = () => (searchParams.ids ?? "") as string;
  const independent = () => searchParams.independent !== "false";
  const orderBy = () => (searchParams.orderBy ?? "") as string;
  const orderDirection = () => (searchParams.orderDirection ?? "desc") as string;

  const idMode = () => ids().length > 0;

  const [typeNames] = createResource(listChainTypeNames);

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
    () => {
      const idsVal = ids();
      if (idsVal) return { mode: "ids" as const, ids: idsVal };
      const tn = typeName();
      if (!tn) {
        setItems([]);
        setCursor(null);
        return null;
      }
      return {
        mode: "list" as const,
        typeName: tn,
        status: status(),
        independent: independent(),
        orderBy: orderBy() || undefined,
        orderDirection: orderDirection() || undefined,
      };
    },
    async (params) => {
      loadMoreController?.abort();
      loadMoreController = null;

      if (params.mode === "ids") {
        const idList = params.ids
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const result = await getChainsByIds(idList);
        setItems(result.items);
        setCursor(null);
        return result;
      }

      const result = await listChains({
        typeName: params.typeName,
        status: params.status,
        independent: params.independent,
        orderBy: params.orderBy,
        orderDirection: params.orderDirection,
        limit: PAGE_SIZE,
      });
      setItems(result.items);
      setCursor(result.nextCursor);
      return result;
    },
  );

  const loadMore = async () => {
    const c = cursor();
    const tn = typeName();
    if (!c || !tn) return;
    const controller = new AbortController();
    loadMoreController = controller;
    let result: Awaited<ReturnType<typeof listChains>>;
    try {
      result = await listChains({
        typeName: tn,
        status: status(),
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
          placeholder="Chain IDs (comma-separated)"
          value={ids()}
          onChange={(e) => {
            setSearchParams({ ids: e.target.value.trim() || undefined });
          }}
        />
        <select
          ref={(el) => {
            createEffect(() => {
              typeNames();
              el.value = typeName();
            });
          }}
          disabled={idMode()}
          onChange={(e) => {
            setSearchParams({ typeName: e.target.value || undefined });
          }}
        >
          <option value="">Select type…</option>
          <For each={typeNames()}>{(name) => <option value={name}>{name}</option>}</For>
        </select>
        <select
          value={status()}
          disabled={idMode()}
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
          disabled={idMode()}
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
          disabled={idMode()}
          title={orderDirection() === "asc" ? "Ascending" : "Descending"}
          onClick={() => {
            setSearchParams({ orderDirection: orderDirection() === "asc" ? "desc" : "asc" });
          }}
        >
          {orderDirection() === "asc" ? "↑" : "↓"}
        </button>
        <label class="checkbox-label" data-disabled={idMode() || undefined}>
          <input
            type="checkbox"
            checked={independent()}
            disabled={idMode()}
            onChange={(e) => {
              setSearchParams({ independent: e.target.checked ? undefined : "false" });
            }}
          />
          Independent only
        </label>
      </div>

      <Show when={!idMode() && !typeName()}>
        <div class="empty">Select a type to list chains</div>
      </Show>

      <Show when={(idMode() || typeName()) && !page.loading && items().length === 0}>
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
                    setSearchParams({ typeName: chain.typeName, ids: undefined });
                  }}
                />
              </span>
              <span class="card-id">
                {chain.id}
                <button
                  class="filter-btn"
                  title={`Filter by ${chain.id}`}
                  onClick={() => {
                    setSearchParams({ ids: chain.id });
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
