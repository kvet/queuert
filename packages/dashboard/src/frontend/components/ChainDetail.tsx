import { A, useNavigate, useParams } from "@solidjs/router";
import { For, Match, Show, Switch, createResource, createSignal } from "solid-js";

import {
  type UnknownChain,
  type UnknownJob,
  deleteChain,
  getChainBlocking,
  getChainDetail,
  getChainJobs,
} from "../api.js";
import { BackLink } from "./BackLink.js";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";
import { createAutoLoadMore } from "./createAutoLoadMore.js";
import { JsonView } from "./JsonView.js";
import { ChainStatusBadge, JobStatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

export function ChainDetail() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();

  const [jobs, setJobs] = createSignal<UnknownJob[]>([]);
  const [jobBlockers, setJobBlockers] = createSignal<Record<string, UnknownChain[]>>({});
  const [jobsCursor, setJobsCursor] = createSignal<string | null>(null);
  let jobsLoadController: AbortController | null = null;

  const [chain] = createResource(
    () => params.id,
    async (id) => {
      jobsLoadController?.abort();
      jobsLoadController = null;
      const detail = await getChainDetail(id);
      setJobs(detail.jobs);
      setJobBlockers(detail.jobBlockers);
      setJobsCursor(detail.nextCursor);
      return detail;
    },
  );
  const [blockingItems, setBlockingItems] = createSignal<UnknownJob[]>([]);
  const [blockingCursor, setBlockingCursor] = createSignal<string | null>(null);
  const [blockingLoading, setBlockingLoading] = createSignal(false);
  const [blockingFailed, setBlockingFailed] = createSignal(false);
  let blockingLoadController: AbortController | null = null;

  createResource(
    () => params.id,
    async (id) => {
      blockingLoadController?.abort();
      blockingLoadController = null;
      const result = await getChainBlocking(id);
      setBlockingItems(result.items);
      setBlockingCursor(result.nextCursor);
      return result;
    },
  );

  const loadMoreBlocking = async () => {
    const c = blockingCursor();
    if (!c || blockingLoading()) return;
    setBlockingLoading(true);
    setBlockingFailed(false);
    const controller = new AbortController();
    blockingLoadController = controller;
    try {
      const result = await getChainBlocking(params.id, { cursor: c, signal: controller.signal });
      if (controller.signal.aborted) return;
      setBlockingItems((prev) => [...prev, ...result.items]);
      setBlockingCursor(result.nextCursor);
    } catch {
      // Leave the cursor in place so the button stays a retry; an abort isn't a failure.
      if (controller.signal.aborted) return;
      setBlockingFailed(true);
    } finally {
      setBlockingLoading(false);
    }
  };

  const loadMoreJobs = async () => {
    const c = jobsCursor();
    if (!c) return;
    const controller = new AbortController();
    jobsLoadController = controller;
    let page: Awaited<ReturnType<typeof getChainJobs>>;
    try {
      page = await getChainJobs(params.id, { cursor: c, signal: controller.signal });
    } catch (e) {
      if (controller.signal.aborted) return;
      throw e;
    }
    if (controller.signal.aborted) return;
    setJobs((prev) => [...prev, ...page.jobs]);
    setJobBlockers((prev) => ({ ...prev, ...page.jobBlockers }));
    setJobsCursor(page.nextCursor);
  };

  const autoLoadMoreJobs = createAutoLoadMore(loadMoreJobs);

  const [showDelete, setShowDelete] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);

  const handleDelete = async (options: { cascade: boolean }) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteChain(params.id, { cascade: options.cascade });
      navigate("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <BackLink fallback="/chains" />

      <Switch>
        <Match when={chain.error}>
          <div class="empty">Chain not found</div>
        </Match>
        <Match when={chain.loading}>
          <div class="empty">Loading...</div>
        </Match>
        <Match when={chain()} keyed>
          {(d) => {
            return (
              <>
                <div class="detail-header">
                  <h2>
                    {d.chain.typeName} <ChainStatusBadge chain={d.chain} />
                  </h2>
                  <div class="id">chain {d.chain.id}</div>
                  <div style={{ "font-size": "13px", color: "var(--text-secondary)" }}>
                    Created <TimeAgo date={d.chain.createdAt} />
                  </div>
                  <button class="delete-btn" onClick={() => setShowDelete(true)}>
                    Delete chain
                  </button>
                </div>

                <ConfirmDeleteDialog
                  chainId={d.chain.id}
                  open={showDelete()}
                  onClose={() => {
                    setShowDelete(false);
                    setDeleteError(null);
                  }}
                  onConfirm={(options) => void handleDelete(options)}
                  deleting={deleting()}
                  error={deleteError()}
                />

                <Show when={blockingItems().length}>
                  <div class="section">
                    <h3>Blocking</h3>
                    <p
                      style={{
                        "font-size": "13px",
                        color: "var(--text-secondary)",
                        "margin-bottom": "8px",
                      }}
                    >
                      Jobs depending on this chain as a blocker:
                    </p>
                    <ul class="blocker-list">
                      <For each={blockingItems()}>
                        {(job) => (
                          <li>
                            <JobStatusBadge job={job} /> {job.typeName}{" "}
                            <A href={`/chains/${job.chainId}`} class="chain-link">
                              chain {job.chainId}
                            </A>
                          </li>
                        )}
                      </For>
                    </ul>
                    <Show when={blockingCursor()}>
                      <button
                        class="load-more"
                        disabled={blockingLoading()}
                        onClick={() => {
                          void loadMoreBlocking();
                        }}
                      >
                        {blockingLoading() ? "Loading…" : blockingFailed() ? "Retry" : "Load more"}
                      </button>
                    </Show>
                  </div>
                </Show>

                <div class="section">
                  <h3>
                    Jobs ({jobs().length}
                    {jobsCursor() ? "+" : ""})
                  </h3>
                  <For each={jobs()}>
                    {(job, i) => (
                      <div class="card">
                        <A
                          class="card-link"
                          href={`/jobs/${job.id}`}
                          aria-label={`Open job ${job.id}`}
                        />
                        <div class="card-header">
                          <span class="card-type">
                            {i() + 1}. {job.typeName}
                          </span>
                          <span class="card-id">{job.id}</span>
                          <span class="card-time">
                            <TimeAgo date={job.createdAt} />
                          </span>
                        </div>
                        <div class="card-meta">
                          <JobStatusBadge job={job} />
                        </div>
                        <Show when={job.input != null}>
                          <div
                            class="section"
                            style={{ "margin-top": "8px", "margin-bottom": "0" }}
                          >
                            <h3>Input</h3>
                            <JsonView data={job.input} />
                          </div>
                        </Show>
                        <Show when={job.output != null}>
                          <div
                            class="section"
                            style={{ "margin-top": "8px", "margin-bottom": "0" }}
                          >
                            <h3>Output</h3>
                            <JsonView data={job.output} />
                          </div>
                        </Show>
                        <Show when={job.lastAttemptError}>
                          <div class="error-text" style={{ "margin-top": "4px" }}>
                            {String(job.lastAttemptError).slice(0, 200)}
                          </div>
                        </Show>
                        <Show when={jobBlockers()[job.id]?.length}>
                          <div style={{ "margin-top": "8px" }}>
                            <strong style={{ "font-size": "12px" }}>Blockers</strong>
                            <ul class="blocker-list">
                              <For each={jobBlockers()[job.id]}>
                                {(blocker) => (
                                  <li>
                                    <ChainStatusBadge chain={blocker} /> {blocker.typeName}{" "}
                                    <A href={`/chains/${blocker.id}`} class="chain-link">
                                      chain {blocker.id}
                                    </A>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                  <Show when={jobsCursor()}>
                    <button
                      class="load-more"
                      ref={autoLoadMoreJobs.ref}
                      disabled={autoLoadMoreJobs.loading()}
                      onClick={() => {
                        autoLoadMoreJobs.trigger();
                      }}
                    >
                      {autoLoadMoreJobs.loading()
                        ? "Loading…"
                        : autoLoadMoreJobs.failed()
                          ? "Retry"
                          : "Load more"}
                    </button>
                  </Show>
                </div>
              </>
            );
          }}
        </Match>
      </Switch>
    </div>
  );
}
