import { useNavigate, useSearchParams } from "@solidjs/router";
import { For, Show, createResource, createSignal } from "solid-js";

import { type UnknownJobChain, listJobChains } from "../api.js";
import { StatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

export function ChainList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const typeName = () => (searchParams.typeName ?? "") as string;
  const status = () => (searchParams.status ?? "") as string;
  const id = () => (searchParams.id ?? "") as string;
  const jobId = () => (searchParams.jobId ?? "") as string;
  const root = () => searchParams.root !== "false";

  const [items, setItems] = createSignal<UnknownJobChain[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  let loadMoreController: AbortController | null = null;

  const [page] = createResource(
    () => ({
      typeName: typeName(),
      status: status(),
      id: id(),
      jobId: jobId(),
      root: root(),
    }),
    async (params) => {
      loadMoreController?.abort();
      loadMoreController = null;
      const result = await listJobChains({ ...params, limit: 25 });
      setItems(result.items);
      setCursor(result.nextCursor);
      return result;
    },
  );

  const loadMore = async () => {
    const c = cursor();
    if (!c) return;
    loadMoreController?.abort();
    const controller = new AbortController();
    loadMoreController = controller;
    let result: Awaited<ReturnType<typeof listJobChains>>;
    try {
      result = await listJobChains({
        typeName: typeName(),
        status: status(),
        id: id(),
        jobId: jobId(),
        root: root(),
        cursor: c,
        limit: 25,
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
          placeholder="Job ID"
          value={jobId()}
          onChange={(e) => {
            setSearchParams({ jobId: e.target.value.trim() || undefined });
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
        <span class="select-with-warning">
          <select
            value={status()}
            onChange={(e) => {
              setSearchParams({ status: e.target.value || undefined });
            }}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="blocked">Blocked</option>
          </select>
          <a
            class="filter-warning-inline"
            href="https://kvet.github.io/queuert/guides/queries/#performance-considerations"
            target="_blank"
            rel="noopener noreferrer"
            title="Filtering chains by status alone is not optimized. Combine with a type name filter."
          >
            ⚠
          </a>
        </span>
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={root()}
            onChange={(e) => {
              setSearchParams({ root: e.target.checked ? undefined : "false" });
            }}
          />
          Hide blockers
        </label>
      </div>

      <Show when={!page.loading && items().length === 0}>
        <div class="empty">No chains found</div>
      </Show>

      <For each={items()}>
        {(chain) => (
          <div
            class="card"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              navigate(`/chains/${chain.id}`);
            }}
          >
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
                <TimeAgo date={chain.createdAt} />
              </span>
            </div>
            <div class="card-meta">
              <StatusBadge status={chain.status} />
            </div>
            <Show when={chain.input != null}>
              <div class="card-input">{inputPreview(chain.input)}</div>
            </Show>
          </div>
        )}
      </For>

      <Show when={cursor()}>
        <button class="load-more" onClick={() => void loadMore()}>
          Load more
        </button>
      </Show>
    </div>
  );
}
