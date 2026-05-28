import { A, useParams } from "@solidjs/router";
import { For, Show, createResource, createSignal } from "solid-js";

import { getJobDetail, triggerJob } from "../api.js";
import { JsonView } from "./JsonView.js";
import { StatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

const dtf = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

const fmtDate = (d: Date) => dtf.format(d);

export function JobDetail() {
  const params = useParams<{ id: string }>();
  const [detail, { mutate }] = createResource(() => params.id, getJobDetail);
  const [triggering, setTriggering] = createSignal(false);

  const handleTrigger = async (jobId: string) => {
    setTriggering(true);
    try {
      const updated = await triggerJob(jobId);
      mutate((prev) => (prev ? { ...prev, job: updated } : prev));
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div>
      <A href="/jobs" class="back-link">
        &larr; Back to jobs
      </A>

      <Show when={detail()} keyed fallback={<div class="empty">Loading...</div>}>
        {(d) => {
          const job = d.job;
          return (
            <>
              <div class="detail-header">
                <h2>
                  {job.typeName} <StatusBadge status={job.status} />
                </h2>
                <div class="id">job {job.id}</div>
                <A href={`/chains/${job.chainId}`} class="chain-link">
                  {job.chainTypeName} ({job.chainId})
                </A>
              </div>

              <div class="section">
                <h3>Info</h3>
                <dl class="info-grid">
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge status={job.status} />
                  </dd>
                  <dt>Attempt</dt>
                  <dd>#{job.attempt}</dd>
                  <dt>Created</dt>
                  <dd>
                    {fmtDate(job.createdAt)} (<TimeAgo date={job.createdAt} />)
                  </dd>
                  <dt>Scheduled</dt>
                  <dd>
                    {fmtDate(job.scheduledAt)} (<TimeAgo date={job.scheduledAt} />)
                    <Show when={job.status === "scheduled"}>
                      {" "}
                      <button
                        class="trigger-btn"
                        disabled={triggering()}
                        onClick={() => void handleTrigger(job.id)}
                      >
                        {triggering() ? "Triggering..." : "Trigger now"}
                      </button>
                    </Show>
                  </dd>
                  <Show when={job.completedAt}>
                    <dt>Completed</dt>
                    <dd>
                      {fmtDate(job.completedAt)} (<TimeAgo date={job.completedAt} />)
                    </dd>
                  </Show>
                  <Show when={job.completedBy}>
                    <dt>Completed by</dt>
                    <dd>{job.completedBy}</dd>
                  </Show>
                  <Show when={job.leasedBy}>
                    <dt>Leased by</dt>
                    <dd>{job.leasedBy}</dd>
                  </Show>
                  <Show when={job.leasedUntil}>
                    <dt>Lease until</dt>
                    <dd>
                      {fmtDate(job.leasedUntil)} (<TimeAgo date={job.leasedUntil} />)
                    </dd>
                  </Show>
                </dl>
              </div>

              <Show when={d.blockers.length > 0}>
                <div class="section">
                  <h3>Blockers</h3>
                  <ul class="blocker-list">
                    <For each={d.blockers}>
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

              <Show when={job.input != null}>
                <div class="section">
                  <h3>Input</h3>
                  <JsonView data={job.input} />
                </div>
              </Show>

              <Show when={job.output != null}>
                <div class="section">
                  <h3>Output</h3>
                  <JsonView data={job.output} />
                </div>
              </Show>

              <Show when={d.continuation} keyed>
                {(cont) => (
                  <div class="section">
                    <h3>Continuation</h3>
                    <A href={`/jobs/${cont.id}`} class="chain-link">
                      {cont.typeName} <StatusBadge status={cont.status} />
                    </A>
                  </div>
                )}
              </Show>

              <Show when={job.lastAttemptError}>
                <div class="section">
                  <h3>Error</h3>
                  <pre class="error-text">{String(job.lastAttemptError)}</pre>
                </div>
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}
