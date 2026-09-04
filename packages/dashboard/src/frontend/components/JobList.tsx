import { A, useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";

import { PAGE_SIZE, type UnknownJob, getJobsByIds, listJobTypeNames, listJobs } from "../api.js";
import { createAutoLoadMore } from "./createAutoLoadMore.js";
import { JobStatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

export function JobList() {
  const [searchParams, setSearchParams] = useSearchParams();

  const status = () => (searchParams.status ?? "") as string;
  const typeName = () => (searchParams.typeName ?? "") as string;
  const ids = () => (searchParams.ids ?? "") as string;

  const orderBy = () => (searchParams.orderBy ?? "") as string;
  const orderDirection = () => (searchParams.orderDirection ?? "desc") as string;

  const idMode = () => ids().length > 0;

  const [typeNames] = createResource(listJobTypeNames);

  const effectiveStatus = createMemo(() => {
    const s = status();
    if (s === "blocked" || s === "pending-unblocked") return "pending";
    if (s === "completed-terminal" || s === "completed-continued") return "completed";
    return s;
  });

  const orderByOptions = createMemo(() => {
    const s = effectiveStatus();
    if (s === "pending")
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
          <option value="pending">Pending</option>
          <option value="pending-unblocked">Pending (unblocked)</option>
          <option value="blocked">Pending (blocked)</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="completed-terminal">Completed (terminal)</option>
          <option value="completed-continued">Completed (continued)</option>
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
              <span class="card-type">
                {job.typeName}
                <button
                  class="filter-btn"
                  title={`Filter by ${job.typeName}`}
                  onClick={() => {
                    setSearchParams({ typeName: job.typeName, ids: undefined });
                  }}
                />
              </span>
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
              <JobStatusBadge job={job} />
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
