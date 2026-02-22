import { For, Show, createResource } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { getChainBlocking, getChainDetail } from "../api.js";
import { StatusBadge } from "./StatusBadge.js";
import { JsonView } from "./JsonView.js";
import { TimeAgo } from "./TimeAgo.js";

export function ChainDetail() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [chain] = createResource(() => params.id, getChainDetail);
  const [blocking] = createResource(() => params.id, getChainBlocking);

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
                  {d.rootJob.chainTypeName} <StatusBadge status={(d.lastJob ?? d.rootJob).status} />
                </h2>
                <div class="id">chain {d.rootJob.chainId}</div>
                <div style={{ "font-size": "13px", color: "var(--text-secondary)" }}>
                  Created <TimeAgo date={d.rootJob.createdAt} />
                </div>
              </div>

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
                              {([rootJob, lastJob]) => (
                                <li>
                                  <StatusBadge status={(lastJob ?? rootJob).status} />{" "}
                                  {rootJob.chainTypeName}{" "}
                                  <A href={`/chains/${rootJob.chainId}`} class="chain-link">
                                    chain {rootJob.chainId}
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
