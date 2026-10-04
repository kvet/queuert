import { A, useParams } from "@solidjs/router";
import { For, type JSX, Match, Show, Switch } from "solid-js";

import { type UnknownJob, getJobDetail, isNotFound } from "../api.js";
import { elapsedMs, formatDuration } from "../domain/duration.js";
import { shortId } from "../domain/ids.js";
import { jobPhase } from "../domain/jobPhase.js";
import { formatRelative } from "../domain/time.js";
import { BlockerChainRow } from "../rows/BlockerChainRow.js";
import { blockerProgress } from "../rows/BlockerChips.js";
import { ErrorText, RescheduleButton } from "../rows/JobItem.js";
import { PageHeader } from "../shell/PageHeader.js";
import { now } from "../state/clock.js";
import { createLoader } from "../state/createLoader.js";
import { useRefresh } from "../state/refresh.js";
import { CopyButton, IdChip } from "../ui/IdChip.js";
import { JsonViewer } from "../ui/JsonViewer.js";
import { Card, ErrorState, NotFoundState, SkeletonRows, linkClass } from "../ui/kit.js";
import { Pips } from "../ui/Pips.js";
import { StatusPill } from "../ui/StatusPill.js";
import { Time } from "../ui/Time.js";

const Fact = (props: { label: string; hint?: string; wide?: boolean; children: JSX.Element }) => (
  <div class={`min-w-0 ${props.wide ? "col-span-2" : ""}`}>
    <dt class="text-xs text-fg-muted" title={props.hint}>
      {props.label}
      <Show when={props.hint}>
        <span class="ml-1 cursor-help text-fg-subtle" aria-label={props.hint}>
          ⓘ
        </span>
      </Show>
    </dt>
    <dd class="mt-0.5 text-sm break-words">{props.children}</dd>
  </div>
);

export const JobDetail = () => {
  const params = useParams<{ id: string }>();
  const detail = createLoader(
    () => params.id,
    async (id, signal) => getJobDetail(id, { signal }),
  );
  useRefresh(detail.refetch);

  const replaceJob = (job: UnknownJob) => {
    const current = detail.data();
    if (current) detail.mutate({ ...current, job });
  };

  const fallbackCrumbs = () => [
    { label: "Jobs", href: "/jobs/types" },
    { label: shortId(params.id) },
  ];

  return (
    <div>
      <Switch>
        <Match when={detail.error() && isNotFound(detail.error())}>
          <PageHeader fallback="/jobs/types" crumbs={fallbackCrumbs()} />
          <NotFoundState kind="Job" href="/jobs/types" />
        </Match>
        <Match when={detail.error()}>
          <PageHeader fallback="/jobs/types" crumbs={fallbackCrumbs()} />
          <ErrorState thing="this job" error={detail.error()} onRetry={detail.retry} />
        </Match>
        <Match when={detail.loading() || !detail.data()}>
          <div class="mb-6 flex flex-col gap-3" aria-busy="true">
            <div class="h-4 w-48 animate-pulse rounded-xs bg-surface-2" />
            <div class="h-7 w-72 animate-pulse rounded-xs bg-surface-2" />
          </div>
          <div class="rounded-xs border border-border">
            <SkeletonRows count={4} />
          </div>
        </Match>
        <Match when={detail.data()}>
          {(data) => {
            const job = () => data().job;
            const phase = () => jobPhase(job(), now());
            const running = () => {
              const value = job();
              return value.status === "running" ? value : undefined;
            };
            const completed = () => {
              const value = job();
              return value.status === "completed" ? value : undefined;
            };
            const listHref = () => `/jobs?typeName=${encodeURIComponent(job().typeName)}`;
            const chainLink = () => (
              <A href={`/chains/${job().chainId}`} class={linkClass}>
                {job().chainTypeName} · <span class="font-mono">{shortId(job().chainId)}</span>
              </A>
            );

            return (
              <>
                <PageHeader
                  fallback={listHref()}
                  crumbs={[
                    { label: "Jobs", href: "/jobs/types" },
                    { label: job().typeName, href: listHref() },
                    { label: shortId(job().id), title: job().id },
                  ]}
                />
                <div class="mb-6 flex flex-wrap items-start gap-4">
                  <div class="min-w-0 flex-1">
                    <h1 class="flex flex-wrap items-center gap-3 text-base font-semibold">
                      <span class="min-w-0 truncate" title={job().typeName}>
                        {job().typeName}
                      </span>
                      <StatusPill status={job().status} />
                      <Show when={phase().phase === "rescheduledAfterError"}>
                        <span class="rounded-xs border border-error-border bg-error-bg px-2 py-0.5 text-xs font-medium text-error-fg">
                          Rescheduled after error
                        </span>
                      </Show>
                      <Show when={phase().phase === "scheduled"}>
                        <span class="rounded-xs border border-border px-2 py-0.5 text-xs font-medium text-fg-muted">
                          Scheduled
                        </span>
                      </Show>
                    </h1>
                    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
                      <IdChip id={job().id} full />
                      <span>
                        Job <strong class="font-semibold text-fg">#{job().chainIndex + 1}</strong>{" "}
                        of chain {chainLink()}
                      </span>
                    </div>
                    <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                      <Fact label="Attempts">
                        <Show
                          when={!(job().attempt === 0 && completed())}
                          fallback={<span>0 · completed without a worker</span>}
                        >
                          <span class="inline-flex items-center gap-2">
                            {job().attempt} <Pips count={job().attempt} />
                          </span>
                        </Show>
                      </Fact>
                      <Fact label="Created">
                        <Time date={job().createdAt} />
                      </Fact>
                      <Fact label="Scheduled">
                        <Time date={job().scheduledAt} />
                      </Fact>
                      <Show when={job().lastAttemptAt}>
                        {(at) => (
                          <Fact
                            label="Last reschedule"
                            hint="When a running attempt was last rescheduled, after an error or by its handler."
                          >
                            <Time date={at()} />
                          </Fact>
                        )}
                      </Show>
                      <Show when={running()}>
                        {(current) => (
                          <>
                            <Fact label="Worker" wide>
                              <code class="font-mono text-xs break-all">{current().attemptBy}</code>
                            </Fact>
                            <Fact label="Started">
                              <Time date={current().attemptAt} />
                            </Fact>
                            <Fact label="Deadline">
                              <Show
                                when={current().attemptUntil}
                                fallback={<span class="text-fg-muted">set on first heartbeat</span>}
                              >
                                {(until) => (
                                  <Show
                                    when={until().getTime() > now()}
                                    fallback={
                                      <span class="font-medium text-status-pending-fg">
                                        passed · may be reclaimed
                                      </span>
                                    }
                                  >
                                    <Time date={until()} />
                                  </Show>
                                )}
                              </Show>
                            </Fact>
                          </>
                        )}
                      </Show>
                      <Show when={completed()}>
                        {(done) => (
                          <>
                            <Fact label="Completed">
                              <Time date={done().completedAt} />
                            </Fact>
                            <Fact
                              label="Elapsed"
                              hint="Includes time spent blocked, queued and between attempts."
                            >
                              {formatDuration(elapsedMs(done().createdAt, done().completedAt))}
                            </Fact>
                            <Show when={done().completedBy}>
                              {(by) => (
                                <Fact label="Completed by" wide>
                                  <code class="font-mono text-xs break-all">{by()}</code>
                                </Fact>
                              )}
                            </Show>
                          </>
                        )}
                      </Show>
                    </dl>
                  </div>
                  <RescheduleButton job={job()} label="Run now" onRescheduled={replaceJob} />
                </div>

                <div class="flex min-w-0 flex-col gap-6">
                  <Show when={job().lastAttemptError}>
                    {(error) => (
                      <Card
                        title={
                          <>
                            Last error
                            <Show when={job().lastAttemptAt}>
                              {(at) => (
                                <span class="font-normal normal-case">
                                  {" "}
                                  · <Time date={at()} />
                                </span>
                              )}
                            </Show>
                          </>
                        }
                        tone="error"
                        actions={<CopyButton text={error()} label="Copy error" />}
                      >
                        <ErrorText text={error()} lines={12} />
                        <Show
                          when={
                            phase().phase === "rescheduledAfterError" &&
                            job().scheduledAt.getTime() > now()
                          }
                        >
                          <p class="mt-2 text-xs text-fg-muted">
                            next attempt {formatRelative(job().scheduledAt, now())}
                          </p>
                        </Show>
                      </Card>
                    )}
                  </Show>

                  <JsonViewer data={job().input} title="Input" label="input" />

                  <Switch
                    fallback={
                      <Card title="Output">
                        <p class="text-sm text-fg-subtle">no output yet</p>
                      </Card>
                    }
                  >
                    <Match when={completed()?.continuedToId}>
                      {(nextId) => (
                        <Card title="Continued to">
                          <Show
                            when={data().continuation}
                            fallback={<IdChip id={nextId()} href={`/jobs/${nextId()}`} />}
                          >
                            {(next) => (
                              <div class="flex flex-wrap items-center gap-2 text-sm">
                                <A href={`/jobs/${next().id}`} class="font-medium hover:underline">
                                  {next().typeName}
                                </A>
                                <StatusPill status={next().status} />
                                <IdChip id={next().id} href={`/jobs/${next().id}`} />
                                <span class="text-fg-muted">job #{job().chainIndex + 2}</span>
                              </div>
                            )}
                          </Show>
                        </Card>
                      )}
                    </Match>
                    <Match when={completed()}>
                      {(final) => (
                        <JsonViewer data={final().output} title="Output" label="output" />
                      )}
                    </Match>
                  </Switch>

                  <Show when={data().blockers.length > 0}>
                    <Card
                      title="Blockers"
                      actions={
                        <span class="text-fg-muted tabular-nums">
                          {blockerProgress(data().blockers)}
                        </span>
                      }
                      bodyClass=""
                    >
                      <ul class="divide-y divide-border">
                        <For each={data().blockers}>
                          {(blocker) => <BlockerChainRow chain={blocker} />}
                        </For>
                      </ul>
                    </Card>
                  </Show>
                </div>
              </>
            );
          }}
        </Match>
      </Switch>
    </div>
  );
};
