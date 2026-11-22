import { Box, StatusDot } from "@queuert/ui/components";
import { type AnyStatus, CHAIN_STATUSES, JOB_STATUSES, statusClasses } from "@queuert/ui/lib";
import { useQuery } from "@tanstack/solid-query";
import { For, Show, createMemo } from "solid-js";

import { appHref } from "../base.ts";
import { type CappedCount, formatSum, sumCounts } from "../domain/counts.ts";
import { TypeRow } from "../rows/TypeRow.tsx";
import { chainTypesQuery, jobTypesQuery, workerCountsQuery } from "../state/queries.ts";
import { EmptyState, QueryBoundary, SkeletonCard, WarningBox, linkClass } from "../ui/kit.tsx";
import { type TypeEntry, countOf, typeListHref } from "./typeData.ts";
import { type TypeKind, chainKind, jobKind } from "./Types.tsx";

const TOP = 5;

const statusSum = (entries: TypeEntry<AnyStatus>[], status: AnyStatus): CappedCount =>
  sumCounts(
    entries.flatMap((entry) =>
      entry.counts
        .filter((statusCount) => statusCount.status === status)
        .map((statusCount) => statusCount.count),
    ),
  );

const StatusBreakdown = (props: {
  label: string;
  href: string;
  statuses: AnyStatus[];
  entries: TypeEntry<AnyStatus>[];
}) => {
  const totals = () =>
    props.statuses.map((status) => ({ status, count: statusSum(props.entries, status) }));
  const total = () => sumCounts(totals().map((statusTotal) => statusTotal.count));

  return (
    <div class="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
      <a href={appHref(props.href)} class="flex items-baseline gap-2 hover:underline">
        <span class="text-xs font-semibold font-mono tracking-wider text-fg-muted uppercase">
          {props.label}
        </span>
        <span class="font-semibold tabular-nums">{formatSum(total())}</span>
      </a>
      <div class="flex min-w-0 flex-col gap-2">
        <div class="flex h-2 gap-px overflow-hidden bg-surface-2" aria-hidden="true">
          <For each={totals()}>
            {(statusTotal) => (
              <Show when={statusTotal.count.count > 0}>
                <span
                  class={["min-w-0.5", statusClasses[statusTotal.status].dot]}
                  style={{ "flex-grow": statusTotal.count.count, "flex-basis": "0" }}
                />
              </Show>
            )}
          </For>
        </div>
        <ul class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
          <For each={totals()}>
            {(statusTotal) => (
              <li class="inline-flex items-center gap-1.5">
                <StatusDot status={statusTotal.status} />
                {statusTotal.status}
                <span class="font-semibold text-fg tabular-nums">
                  {formatSum(statusTotal.count)}
                </span>
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
};

const orList = new Intl.ListFormat("en", { type: "disjunction" });

const TopTypes = (props: {
  kind: TypeKind;
  statuses: AnyStatus[];
  entries: TypeEntry<AnyStatus>[];
}) => {
  const busiest = createMemo(() => {
    const statuses = props.statuses;
    return props.entries
      .filter((entry) => countOf(entry, statuses) > 0)
      .sort(
        (a, b) =>
          countOf(b, statuses) - countOf(a, statuses) || a.typeName.localeCompare(b.typeName),
      );
  });

  return (
    <Box
      title={props.kind.title}
      bodyClass=""
      actions={
        <Show when={props.entries.length > 0}>
          <a href={appHref(`${props.kind.base}/types`)} class={linkClass}>
            All {props.entries.length} →
          </a>
        </Show>
      }
    >
      <Show
        when={busiest().length > 0}
        fallback={
          <p class="px-4 py-6 text-sm text-fg-muted">
            No {orList.format(props.statuses)} {props.kind.noun}s
          </p>
        }
      >
        <ul class="divide-y divide-border">
          <For each={busiest().slice(0, TOP)}>
            {(entry) => (
              <TypeRow
                typeName={entry.typeName}
                counts={entry.counts}
                href={(status) => typeListHref(props.kind.base, entry.typeName, status)}
                workers={entry.workers}
              />
            )}
          </For>
        </ul>
      </Show>
    </Box>
  );
};

const WorkerBreakdown = (props: { counts: { live: number; expired: number } }) => (
  <div class="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
    <a href={appHref("/workers")} class="flex items-baseline gap-2 hover:underline">
      <span class="text-xs font-semibold font-mono tracking-wider text-fg-muted uppercase">
        Workers
      </span>
      <span class="font-semibold tabular-nums">
        {(props.counts.live + props.counts.expired).toLocaleString()}
      </span>
    </a>
    <ul class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
      <li class="inline-flex items-center gap-1.5">
        live
        <span class="font-semibold text-fg tabular-nums">{props.counts.live.toLocaleString()}</span>
      </li>
      <li class="inline-flex items-center gap-1.5">
        expired
        <span class="font-semibold text-fg tabular-nums">
          {props.counts.expired.toLocaleString()}
        </span>
      </li>
    </ul>
  </div>
);

const Warnings = (props: { leaseLostCount: number; strandedTypeCount: number }) => (
  <Show when={props.leaseLostCount > 0 || props.strandedTypeCount > 0}>
    <div class="mb-6 flex flex-col gap-2">
      <Show when={props.leaseLostCount > 0}>
        <WarningBox
          action={
            <a href={appHref("/workers")} class="font-medium underline">
              View workers
            </a>
          }
        >
          {props.leaseLostCount === 1
            ? "1 worker lost its lease."
            : `${props.leaseLostCount} workers lost their lease.`}
        </WarningBox>
      </Show>
      <Show when={props.strandedTypeCount > 0}>
        <WarningBox
          action={
            <a href={appHref("/jobs/types?status=pending")} class="font-medium underline">
              View job types
            </a>
          }
        >
          {props.strandedTypeCount}{" "}
          {props.strandedTypeCount === 1 ? "job type has" : "job types have"} pending jobs and no
          live worker.
        </WarningBox>
      </Show>
    </div>
  </Show>
);

export const Overview = () => {
  const chains = useQuery(() => chainTypesQuery());
  const jobs = useQuery(() => jobTypesQuery());
  const workerCounts = useQuery(() => workerCountsQuery());

  return (
    <div>
      <QueryBoundary thing="the dashboard" fallback={<SkeletonCard />}>
        <Show
          when={
            chains.data.length > 0 ||
            jobs.data.length > 0 ||
            workerCounts.data.live > 0 ||
            workerCounts.data.expired > 0
          }
          fallback={
            <EmptyState title="Nothing here yet. Chains appear once your app creates them.">
              <a
                href="https://kvet.github.io/queuert/"
                target="_blank"
                rel="noopener"
                class={linkClass}
              >
                Read the docs
              </a>
            </EmptyState>
          }
        >
          <Warnings
            leaseLostCount={workerCounts.data.expired}
            strandedTypeCount={jobs.data.filter((entry) => entry.workers?.stranded).length}
          />
          <Box title="Status" class="mb-6" bodyClass="divide-y divide-border">
            <StatusBreakdown
              label="Chains"
              href="/chains/types"
              statuses={CHAIN_STATUSES}
              entries={chains.data}
            />
            <StatusBreakdown
              label="Jobs"
              href="/jobs/types"
              statuses={JOB_STATUSES}
              entries={jobs.data}
            />
            <WorkerBreakdown counts={workerCounts.data} />
          </Box>
          <div class="grid gap-6 lg:grid-cols-2">
            <TopTypes kind={chainKind} statuses={["running"]} entries={chains.data} />
            <TopTypes
              kind={jobKind}
              statuses={["blocked", "pending", "running"]}
              entries={jobs.data}
            />
          </div>
        </Show>
      </QueryBoundary>
    </div>
  );
};
