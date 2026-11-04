import { Box } from "@queuert/ui/components";
import { shortId } from "@queuert/ui/lib";
import { A, useParams } from "@solidjs/router";
import { For, Match, Show, Switch } from "solid-js";

import { PAGE_SIZE, getWorker, isNotFound, listWorkerJobs } from "../api.js";
import { decodeWorkerId } from "../domain/workers.js";
import { JobRow } from "../rows/JobRow.js";
import { PageHeader } from "../shell/PageHeader.js";
import { createLoader } from "../state/createLoader.js";
import { createPagedList } from "../state/createPagedList.js";
import { IdChip } from "../ui/IdChip.js";
import { EmptyState, ErrorState, Fact, NotFoundState, SkeletonRows, linkClass } from "../ui/kit.js";
import { Time } from "../ui/Time.js";
import { LoadMoreFooter } from "./listParts.js";

export const WorkerDetail = () => {
  const params = useParams<{ id: string }>();
  const workerId = () => decodeWorkerId(params.id);
  const detail = createLoader(workerId, async (id, signal) => getWorker(id, { signal }));
  const runningJobs = createPagedList(workerId, async (id, cursor, signal) =>
    listWorkerJobs(id, { cursor, limit: PAGE_SIZE, signal }),
  );

  const crumbs = () => [
    { label: "Workers", href: "/workers" },
    { label: shortId(workerId()), title: workerId() },
  ];

  return (
    <div>
      <PageHeader fallback="/workers" crumbs={crumbs()} />
      <Switch>
        <Match
          when={
            isNotFound(detail.error()) ||
            (detail.data() !== undefined && detail.data()?.worker === undefined)
          }
        >
          <h1 class="mb-4 text-base font-semibold">
            <IdChip id={workerId()} full />
          </h1>
          <NotFoundState kind="Worker" href="/workers">
            A worker is removed when it stops or when its lease is reclaimed, and no history is
            kept.
          </NotFoundState>
        </Match>
        <Match when={detail.error()}>
          <ErrorState thing="this worker" error={detail.error()} onRetry={detail.retry} />
        </Match>
        <Match when={detail.loading() || !detail.data()}>
          <div class="mb-6 flex flex-col gap-3" aria-busy="true">
            <div class="h-7 w-72 animate-pulse rounded-xs bg-surface-2" />
            <div class="h-4 w-48 animate-pulse rounded-xs bg-surface-2" />
          </div>
        </Match>
        <Match when={detail.data()?.worker}>
          {(worker) => (
            <div class="mb-6">
              <h1 class="flex flex-wrap items-center gap-3 text-base font-semibold">
                <IdChip id={worker().id} full />
              </h1>
              <Show when={worker().expired}>
                <p
                  class="mt-3 rounded-xs border border-error-border bg-error-bg px-3 py-2 text-sm text-error-fg"
                  role="alert"
                >
                  This worker lost its lease.
                </p>
              </Show>
              <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                <Fact label="Started">
                  <Time date={worker().startedAt} />
                </Fact>
                <Fact label="Lease until">
                  <Time date={worker().leaseUntil} />
                </Fact>
                <Fact label="Concurrency">{worker().concurrency}</Fact>
                <Fact label="Running jobs">{worker().runningJobCount}</Fact>
                <Fact label="Job types" wide>
                  <span class="flex flex-wrap gap-x-3 gap-y-1">
                    <For each={worker().typeNames}>
                      {(typeName) => (
                        <A
                          href={`/jobs?typeName=${encodeURIComponent(typeName)}&status=running`}
                          class={`${linkClass} font-mono text-xs`}
                        >
                          {typeName}
                        </A>
                      )}
                    </For>
                  </span>
                </Fact>
              </dl>
            </div>
          )}
        </Match>
      </Switch>

      <Switch>
        <Match when={runningJobs.error()}>
          <ErrorState
            thing="running jobs"
            error={runningJobs.error()}
            onRetry={runningJobs.retry}
          />
        </Match>
        <Match when={runningJobs.loading()}>
          <div class="rounded-xs border border-border">
            <SkeletonRows count={2} />
          </div>
        </Match>
        <Match when={runningJobs.items().length > 0}>
          <Box title="Running jobs" bodyClass="">
            <ul class="divide-y divide-border">
              <For each={runningJobs.items()}>
                {(job) => <JobRow job={job} sortKey="attemptAt" showType showWorker={false} />}
              </For>
            </ul>
            <LoadMoreFooter
              hasMore={runningJobs.cursor() !== null}
              shownCount={runningJobs.items().length}
              autoLoadMore={runningJobs.autoLoadMore}
            />
          </Box>
        </Match>
        <Match when={runningJobs.items().length === 0}>
          <EmptyState title="No running jobs" />
        </Match>
      </Switch>
    </div>
  );
};
