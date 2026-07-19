import { A, useParams } from "@solidjs/router";
import { For, Show, createResource, createSignal } from "solid-js";

import { getJobDetail, rescheduleJob } from "../api.js";
import { BackLink } from "./BackLink.js";
import { JsonView } from "./JsonView.js";
import { ChainStatusBadge, JobStatusBadge } from "./StatusBadge.js";
import { TimeAgo } from "./TimeAgo.js";

const dtf = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

const fmtDate = (d: Date) => dtf.format(d);

export function JobDetail() {
  const params = useParams<{ id: string }>();
  const [detail, { mutate }] = createResource(() => params.id, getJobDetail);
  const [rescheduling, setRescheduling] = createSignal(false);

  const handleReschedule = async (jobId: string) => {
    setRescheduling(true);
    try {
      const updated = await rescheduleJob(jobId);
      mutate((prev) => (prev ? { ...prev, job: updated } : prev));
    } finally {
      setRescheduling(false);
    }
  };

  return (
    <div>
      <BackLink fallback="/jobs" />

      <Show when={detail()} keyed fallback={<div class="empty">Loading...</div>}>
        {(d) => {
          const job = d.job;
          return (
            <>
              <div class="detail-header">
                <h2>
                  {job.typeName} <JobStatusBadge job={job} />
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
                    <JobStatusBadge job={job} />
                  </dd>
                  <dt>Created</dt>
                  <dd>
                    {fmtDate(job.createdAt)} (<TimeAgo date={job.createdAt} />)
                  </dd>
                  <dt>Scheduled</dt>
                  <dd>
                    {fmtDate(job.scheduledAt)} (<TimeAgo date={job.scheduledAt} />)
                    <Show when={job.status === "pending" && job.scheduledAt > new Date()}>
                      {" "}
                      <button
                        class="reschedule-btn"
                        disabled={rescheduling()}
                        onClick={() => void handleReschedule(job.id)}
                      >
                        {rescheduling() ? "Rescheduling..." : "Reschedule"}
                      </button>
                    </Show>
                  </dd>
                  <dt>Attempt</dt>
                  <dd>#{job.attempt}</dd>
                  <Show when={job.lastAttemptAt}>
                    <dt>Last attempt at</dt>
                    <dd>
                      {fmtDate(job.lastAttemptAt!)} (<TimeAgo date={job.lastAttemptAt!} />)
                    </dd>
                  </Show>
                  <Show when={job.lastAttemptError}>
                    <dt>Last attempt error</dt>
                    <dd>
                      <pre class="error-text">{String(job.lastAttemptError)}</pre>
                    </dd>
                  </Show>
                  <Show when={job.status === "completed" ? job : undefined}>
                    {(completed) => (
                      <>
                        <dt>Completed</dt>
                        <dd>
                          {fmtDate(completed().completedAt)} (
                          <TimeAgo date={completed().completedAt} />)
                        </dd>
                        <Show when={completed().completedBy}>
                          <dt>Completed by</dt>
                          <dd>{completed().completedBy}</dd>
                        </Show>
                      </>
                    )}
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

              <Show when={job.input != null}>
                <div class="section">
                  <h3>Input</h3>
                  <JsonView data={job.input} />
                </div>
              </Show>

              <Show when={job.status === "running" ? job : undefined}>
                {(running) => (
                  <div class="section">
                    <h3>Current Attempt</h3>
                    <dl class="info-grid">
                      <dt>Worker</dt>
                      <dd>{running().attemptBy}</dd>
                      <dt>Started</dt>
                      <dd>
                        {fmtDate(running().attemptAt)} (<TimeAgo date={running().attemptAt} />)
                      </dd>
                      <Show when={running().attemptUntil}>
                        <dt>Deadline</dt>
                        <dd>
                          {fmtDate(running().attemptUntil!)} (
                          <TimeAgo date={running().attemptUntil!} />)
                        </dd>
                      </Show>
                    </dl>
                  </div>
                )}
              </Show>

              <Show
                when={job.status === "completed" && job.continuedToId === null ? job : undefined}
              >
                {(terminal) => (
                  <div class="section">
                    <h3>Output</h3>
                    <JsonView data={terminal().output} />
                  </div>
                )}
              </Show>

              <Show when={d.continuation} keyed>
                {(cont) => (
                  <div class="section">
                    <h3>Continuation</h3>
                    <A href={`/jobs/${cont.id}`} class="chain-link">
                      {cont.typeName} <JobStatusBadge job={cont} />
                    </A>
                  </div>
                )}
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}
