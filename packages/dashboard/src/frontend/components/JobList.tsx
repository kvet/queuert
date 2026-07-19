import { A, useSearchParams } from "@solidjs/router";
import { For, Show, createMemo, createResource, createSignal } from "solid-js";

import { PAGE_SIZE, type UnknownJob, listJobs } from "../api.js";
import { createAutoLoadMore } from "./createAutoLoadMore.js";
import { JobStatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

export function JobList() {
  const [searchParams, setSearchParams] = useSearchParams();

  const status = () => (searchParams.status ?? "") as string;
  const typeName = () => (searchParams.typeName ?? "") as string;
  const id = () => (searchParams.id ?? "") as string;

  const orderBy = () => (searchParams.orderBy ?? "") as string;
  const orderDirection = () => (searchParams.orderDirection ?? "desc") as string;

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
    () => ({
      status: status(),
      typeName: typeName(),
      id: id(),
      orderBy: orderBy() || undefined,
      orderDirection: orderDirection() || undefined,
    }),
    async (params) => {
      loadMoreController?.abort();
      loadMoreController = null;
      const result = await listJobs({ ...params, limit: PAGE_SIZE });
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
    let result: Awaited<ReturnType<typeof listJobs>>;
    try {
      result = await listJobs({
        status: status(),
        typeName: typeName(),
        id: id(),
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
          placeholder="Job ID"
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
      </div>

      <Show when={!page.loading && items().length === 0}>
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
                    setSearchParams({ typeName: job.typeName });
                  }}
                />
              </span>
              <span class="card-id">
                {job.id}
                <button
                  class="filter-btn"
                  title={`Filter by ${job.id}`}
                  onClick={() => {
                    setSearchParams({ id: job.id });
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
