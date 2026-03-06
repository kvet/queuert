import { For, Show, createResource, createSignal } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { type Job } from "../../shared/job.js";
import { listJobChains } from "../api.js";
import { StatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

export function ChainList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const typeName = () => (searchParams.typeName ?? "") as string;
  const status = () => (searchParams.status ?? "") as string;
  const id = () => (searchParams.id ?? "") as string;
  const jobId = () => (searchParams.jobId ?? "") as string;
  const rootOnly = () => searchParams.rootOnly !== "false";

  const [items, setItems] = createSignal<[Job, Job | null][]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);

  const [page] = createResource(
    () => ({
      typeName: typeName(),
      status: status(),
      id: id(),
      jobId: jobId(),
      rootOnly: rootOnly(),
    }),
    async (params) => {
      const result = await listJobChains({ ...params, limit: 25 });
      setItems(result.items);
      setCursor(result.nextCursor);
      return result;
    },
  );

  const loadMore = async () => {
    const c = cursor();
    if (!c) return;
    const result = await listJobChains({
      typeName: typeName(),
      status: status(),
      id: id(),
      jobId: jobId(),
      rootOnly: rootOnly(),
      cursor: c,
      limit: 25,
    });
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
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={rootOnly()}
            onChange={(e) => {
              setSearchParams({ rootOnly: e.target.checked ? undefined : "false" });
            }}
          />
          Hide blockers
        </label>
      </div>

      <Show when={!page.loading && items().length === 0}>
        <div class="empty">No chains found</div>
      </Show>

      <For each={items()}>
        {([rootJob, lastJob]) => {
          const chainStatus = (lastJob ?? rootJob).status;
          return (
            <div
              class="card"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                navigate(`/chains/${rootJob.chainId}`);
              }}
            >
              <div class="card-header">
                <span class="card-type">
                  {rootJob.chainTypeName}
                  <button
                    class="filter-btn"
                    title={`Filter by ${rootJob.chainTypeName}`}
                    onClick={() => {
                      setSearchParams({ typeName: rootJob.chainTypeName });
                    }}
                  />
                </span>
                <span class="card-id">
                  {rootJob.chainId}
                  <button
                    class="filter-btn"
                    title={`Filter by ${rootJob.chainId}`}
                    onClick={() => {
                      setSearchParams({ id: rootJob.chainId });
                    }}
                  />
                </span>
                <span class="card-time">
                  <TimeAgo date={rootJob.createdAt} />
                </span>
              </div>
              <div class="card-meta">
                <StatusBadge status={chainStatus} />
                <Show when={lastJob}>{(lj) => <span>{lj().typeName} (last)</span>}</Show>
                <Show when={chainStatus === "blocked" && (lastJob ?? rootJob).attempt > 0}>
                  <span>attempt #{(lastJob ?? rootJob).attempt}</span>
                </Show>
              </div>
              <Show when={rootJob.input != null}>
                <div class="card-input">{inputPreview(rootJob.input)}</div>
              </Show>
            </div>
          );
        }}
      </For>

      <Show when={cursor()}>
        <button class="load-more" onClick={() => void loadMore()}>
          Load more
        </button>
      </Show>
    </div>
  );
}
