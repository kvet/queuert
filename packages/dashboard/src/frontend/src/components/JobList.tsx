import { For, Show, createResource, createSignal } from "solid-js";
import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { type SerializedJob, listJobs } from "../api.js";
import { StatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

export function JobList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const status = () => (searchParams.status ?? "") as string;
  const typeName = () => (searchParams.typeName ?? "") as string;
  const id = () => (searchParams.id ?? "") as string;

  const [items, setItems] = createSignal<SerializedJob[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);

  const [page] = createResource(
    () => ({
      status: status(),
      typeName: typeName(),
      id: id(),
    }),
    async (params) => {
      const result = await listJobs({ ...params, limit: 25 });
      setItems(result.items);
      setCursor(result.nextCursor);
      return result;
    },
  );

  const loadMore = async () => {
    const c = cursor();
    if (!c) return;
    const result = await listJobs({
      status: status(),
      typeName: typeName(),
      id: id(),
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
          placeholder="Job or chain ID"
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
            setSearchParams({ status: e.target.value || undefined });
          }}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="blocked">Blocked</option>
        </select>
      </div>

      <Show when={!page.loading && items().length === 0}>
        <div class="empty">No jobs found</div>
      </Show>

      <For each={items()}>
        {(job) => (
          <div
            class="card"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a, button")) return;
              navigate(`/jobs/${job.id}`);
            }}
          >
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
                <TimeAgo date={job.createdAt} />
              </span>
            </div>
            <div class="card-meta">
              <StatusBadge status={job.status} />
              <Show when={job.status === "blocked" && job.attempt > 0}>
                <span>attempt #{job.attempt}</span>
              </Show>
              <Show when={job.leasedBy}>
                <span>{job.leasedBy}</span>
              </Show>
              <A href={`/chains/${job.chainId}`} class="chain-link">
                chain {job.chainId}
              </A>
            </div>
            <Show when={job.input != null}>
              <div class="card-input">{inputPreview(job.input)}</div>
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
