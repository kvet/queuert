import { A, useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";

import {
  PAGE_SIZE,
  type UnknownJob,
  countByJobTypeNames,
  getJobsByIds,
  listJobTypeNames,
  listJobs,
} from "../api.js";
import { createAutoLoadMore } from "./createAutoLoadMore.js";
import { createDebouncedInput } from "./createDebouncedInput.js";
import { formatCount, formatTotalCount } from "./formatCount.js";
import { StatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

export function JobList() {
  const [searchParams, setSearchParams] = useSearchParams();

  const status = () => (searchParams.status ?? "") as string;
  const typeName = () => (searchParams.typeName ?? "") as string;
  const ids = () => (searchParams.ids ?? "") as string;
  const idsInput = createDebouncedInput(ids, (value) => {
    setSearchParams({ ids: value || undefined });
  });

  const orderBy = () => (searchParams.orderBy ?? "") as string;
  const orderDirection = () => (searchParams.orderDirection ?? "desc") as string;

  const idMode = () => ids().length > 0;

  const [typeNames] = createResource(listJobTypeNames);

  const [counts] = createResource(
    () => typeName() || undefined,
    async (name) => (await countByJobTypeNames([name]))[0],
  );

  const statusLabel = (label: string, status: "blocked" | "pending" | "running" | "completed") => {
    const c = counts();
    return c ? `${label} (${formatCount(c[status])})` : label;
  };

  const orderByOptions = createMemo(() => {
    const s = status();
    if (s === "blocked" || s === "pending")
      return [
        { value: "scheduledAt", label: "Scheduled" },
        { value: "createdAt", label: "Created" },
      ] as const;
    if (s === "running")
      return [
        { value: "attemptAt", label: "Started" },
        { value: "attemptUntil", label: "Deadline" },
        { value: "createdAt", label: "Created" },
      ] as const;
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

  const cardDate = (job: UnknownJob): Date => {
    const key = effectiveOrderBy();
    if (key === "scheduledAt") return job.scheduledAt;
    if (key === "attemptAt" && job.status === "running") return job.attemptAt;
    if (key === "attemptUntil" && job.status === "running") return job.attemptUntil!;
    if (key === "completedAt" && job.status === "completed") return job.completedAt;
    return job.createdAt;
  };

  const [items, setItems] = createSignal<UnknownJob[]>([]);
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
        const result = await getJobsByIds(idList);
        setItems(result.items);
        setCursor(null);
        return result;
      }

      const result = await listJobs({
        typeName: params.typeName,
        status: params.status,
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
    let result: Awaited<ReturnType<typeof listJobs>>;
    try {
      result = await listJobs({
        typeName: tn,
        status: status(),
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
          placeholder="Job IDs (comma-separated)"
          value={idsInput.value()}
          onInput={(e) => {
            idsInput.onInput(e.currentTarget.value);
          }}
        />
        <Show
          when={!idMode()}
          fallback={
            <button
              class="clear-btn"
              title="Clear IDs"
              onClick={() => {
                idsInput.cancel();
                setSearchParams({ ids: undefined });
              }}
            >
              Clear
            </button>
          }
        >
          <select
            class="filter-type"
            ref={(el) => {
              createEffect(() => {
                typeNames();
                el.value = typeName();
              });
            }}
            onChange={(e) => {
              setSearchParams({ typeName: e.target.value || undefined });
            }}
          >
            <option value="">Select type…</option>
            <For each={typeNames()}>{(name) => <option value={name}>{name}</option>}</For>
          </select>
          <select
            class="filter-status"
            value={status()}
            onChange={(e) => {
              setSearchParams({ status: e.target.value || undefined, orderBy: undefined });
            }}
          >
            <option value="">
              All statuses
              {counts()
                ? ` (${formatTotalCount([counts()!.blocked, counts()!.pending, counts()!.running, counts()!.completed])})`
                : ""}
            </option>
            <option value="blocked">{statusLabel("Blocked", "blocked")}</option>
            <option value="pending">{statusLabel("Pending", "pending")}</option>
            <option value="running">{statusLabel("Running", "running")}</option>
            <option value="completed">{statusLabel("Completed", "completed")}</option>
          </select>
          <select
            class="filter-order-by"
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
        </Show>
      </div>

      <Show when={!idMode() && !typeName()}>
        <div class="empty">Select a type to list jobs</div>
      </Show>

      <Show when={(idMode() || typeName()) && !page.loading && items().length === 0}>
        <div class="empty">No jobs found</div>
      </Show>

      <For each={items()}>
        {(job) => (
          <div class="card">
            <A class="card-link" href={`/jobs/${job.id}`} aria-label={`Open job ${job.id}`} />
            <div class="card-header">
              <Show when={idMode()}>
                <span class="card-type">{job.typeName}</span>
              </Show>
              <span class="card-id">
                {job.id}
                <button
                  class="filter-btn"
                  title={`Filter by ${job.id}`}
                  onClick={() => {
                    setSearchParams({ ids: job.id });
                  }}
                />
              </span>
              <span class="card-time">
                <TimeAgo date={cardDate(job)} />
              </span>
            </div>
            <div class="card-meta">
              <A href={`/chains/${job.chainId}`} class="chain-link">
                chain {job.chainId}
              </A>
              <StatusBadge status={job.status} />
            </div>
            <Show when={job.input != null}>
              <div class="card-input">{inputPreview(job.input)}</div>
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
