import { Box } from "@queuert/ui/components";
import { shortId } from "@queuert/ui/lib";
import { useParams } from "@solidjs/router";
import { useInfiniteQuery, useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";

import { appHref } from "../base.ts";
import { decodeWorkerId } from "../domain/workers.ts";
import { JobRow } from "../rows/JobRow.tsx";
import { PageHeader } from "../shell/PageHeader.tsx";
import { workerJobsQuery, workerQuery } from "../state/queries.ts";
import { IdChip } from "../ui/IdChip.tsx";
import {
  EmptyState,
  Fact,
  NotFoundState,
  QueryBoundary,
  SkeletonCard,
  linkClass,
} from "../ui/kit.tsx";
import { Time } from "../ui/Time.tsx";
import { VirtualList } from "./listParts.tsx";

export const WorkerDetail = () => {
  const params = useParams<{ id: string }>();
  const workerId = () => decodeWorkerId(params.id);
  const detail = useQuery(() => workerQuery(workerId()));
  const runningJobs = useInfiniteQuery(() => workerJobsQuery({ workerId: workerId() }));

  const crumbs = () => [
    { label: "Workers", href: "/workers" },
    { label: shortId(workerId()), title: workerId() },
  ];

  return (
    <div>
      <PageHeader fallback="/workers" crumbs={crumbs()} />
      <QueryBoundary
        thing="this worker"
        fallback={
          <div class="mb-6 flex flex-col gap-3" aria-busy="true">
            <div class="h-7 w-72 animate-pulse rounded-xs bg-surface-2" />
            <div class="h-4 w-48 animate-pulse rounded-xs bg-surface-2" />
          </div>
        }
        notFound={
          <>
            <h1 class="mb-4 text-base font-semibold">
              <IdChip id={workerId()} full />
            </h1>
            <NotFoundState kind="Worker" href="/workers">
              A worker is removed when it stops or when its lease is reclaimed, and no history is
              kept.
            </NotFoundState>
          </>
        }
      >
        <div class="mb-6">
          <h1 class="flex flex-wrap items-center gap-3 text-base font-semibold">
            <IdChip id={detail.data.id} full />
          </h1>
          <Show when={detail.data.expired}>
            <p
              class="mt-3 rounded-xs border border-error-border bg-error-bg px-3 py-2 text-sm text-error-fg"
              role="alert"
            >
              This worker lost its lease.
            </p>
          </Show>
          <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <Fact label="Started">
              <Time date={detail.data.startedAt} />
            </Fact>
            <Fact label="Lease until">
              <Time date={detail.data.leaseUntil} />
            </Fact>
            <Fact label="Concurrency">{detail.data.concurrency}</Fact>
            <Fact label="Running jobs">{detail.data.runningJobCount}</Fact>
            <Fact label="Job types" wide>
              <span class="flex flex-wrap gap-x-3 gap-y-1">
                <For each={detail.data.typeNames}>
                  {(typeName) => (
                    <a
                      href={appHref(
                        `/jobs?typeName=${encodeURIComponent(typeName)}&status=running`,
                      )}
                      class={[linkClass, "font-mono text-xs"]}
                    >
                      {typeName}
                    </a>
                  )}
                </For>
              </span>
            </Fact>
          </dl>
        </div>
      </QueryBoundary>

      <QueryBoundary thing="running jobs" fallback={<SkeletonCard count={2} />}>
        <Show
          when={runningJobs.data.pages[0].items.length > 0}
          fallback={<EmptyState title="No running jobs" />}
        >
          <Box title="Running jobs" bodyClass="">
            <VirtualList query={runningJobs}>
              {(job) => <JobRow job={job} sortKey="attemptAt" showType showWorker={false} />}
            </VirtualList>
          </Box>
        </Show>
      </QueryBoundary>
    </div>
  );
};
