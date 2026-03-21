import { For, Show, createResource, createSignal } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { deleteChain, getChainBlocking, getChainDetail } from "../api.js";
import { StatusBadge } from "./StatusBadge.js";
import { JsonView } from "./JsonView.js";
import { TimeAgo } from "./TimeAgo.js";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";

export function ChainDetail() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [chain] = createResource(() => params.id, getChainDetail);
  const [blocking] = createResource(() => params.id, getChainBlocking);
  const [showDelete, setShowDelete] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteChain(params.id);
      navigate("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <A href="/" class="back-link">
        &larr; Back to chains
      </A>

      <Show when={chain()} keyed fallback={<div class="empty">Loading...</div>}>
        {(d) => {
          return (
            <>
              <div class="detail-header">
                <h2>
                  {d.chain.typeName} <StatusBadge status={d.chain.status} />
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
                onConfirm={() => void handleDelete()}
                deleting={deleting()}
                error={deleteError()}
              />

              <div class="section">
                <h3>Jobs ({d.jobs.length})</h3>
                <For each={d.jobs}>
                  {(job, i) => (
                    <div
                      class="card"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a")) return;
                        navigate(`/jobs/${job.id}`);
                      }}
                    >
                      <div class="card-header">
                        <span class="card-type">
                          {i() + 1}. {job.typeName}
                        </span>
                        <StatusBadge status={job.status} />
                      </div>
                      <div class="card-meta">
                        <Show when={job.attempt > 0}>
                          <span>attempt #{job.attempt}</span>
                        </Show>
                        <Show when={job.leasedBy}>
                          <span>{job.leasedBy}</span>
                        </Show>
                        <span>
                          <TimeAgo date={job.createdAt} />
                        </span>
                      </div>
                      <Show when={job.input != null}>
                        <div class="section" style={{ "margin-top": "8px", "margin-bottom": "0" }}>
                          <h3>Input</h3>
                          <JsonView data={job.input} />
                        </div>
                      </Show>
                      <Show when={job.output != null}>
                        <div class="section" style={{ "margin-top": "8px", "margin-bottom": "0" }}>
                          <h3>Output</h3>
                          <JsonView data={job.output} />
                        </div>
                      </Show>
                      <Show when={job.lastAttemptError}>
                        <div class="error-text" style={{ "margin-top": "4px" }}>
                          {String(job.lastAttemptError).slice(0, 200)}
                        </div>
                      </Show>
                      <Show when={d.jobBlockers[job.id]?.length}>
                        <div style={{ "margin-top": "8px" }}>
                          <strong style={{ "font-size": "12px" }}>Blockers</strong>
                          <ul class="blocker-list">
                            <For each={d.jobBlockers[job.id]}>
                              {(blocker) => (
                                <li>
                                  <StatusBadge status={blocker.status} /> {blocker.typeName}{" "}
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
              </div>

              <Show when={blocking()?.items?.length}>
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
                    <For each={blocking()!.items}>
                      {(job) => (
                        <li>
                          <StatusBadge status={job.status} /> {job.typeName}{" "}
                          <A href={`/chains/${job.chainId}`} class="chain-link">
                            chain {job.chainId}
                          </A>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}
