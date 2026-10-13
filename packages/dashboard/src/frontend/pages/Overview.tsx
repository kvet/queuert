import { A } from "@solidjs/router";
import { For, Match, Show, Switch, createMemo } from "solid-js";

import { type CappedCount, formatSum, sumCounts } from "../domain/counts.js";
import { TypeRow } from "../rows/TypeRow.js";
import { createLoader } from "../state/createLoader.js";
import { useRefresh } from "../state/refresh.js";
import { Card, EmptyState, ErrorState, SkeletonRows, linkClass } from "../ui/kit.js";
import { type AnyStatus, CHAIN_STATUSES, JOB_STATUSES, statusClasses } from "../ui/status.js";
import { StatusDot } from "../ui/StatusPill.js";
import { type TypeEntry, countOf, loadChainTypes, loadJobTypes, typeListHref } from "./typeData.js";
import { type TypeKind, chainKind, jobKind } from "./Types.js";

const TOP = 5;

const statusSum = (entries: TypeEntry<AnyStatus>[], status: AnyStatus): CappedCount =>
  sumCounts(
    entries.flatMap((entry) =>
      entry.counts
        .filter((statusCount) => statusCount.status === status)
        .map((statusCount) => statusCount.count),
    ),
  );

/**
 * One kind (chains or jobs) as a stacked bar of its status totals plus a legend with every status,
 * zeros included, so the totals always add up.
 */
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
      <A href={props.href} class="flex items-baseline gap-2 hover:underline">
        <span class="text-xs font-semibold tracking-wider text-fg-muted uppercase">
          {props.label}
        </span>
        <span class="font-semibold tabular-nums">{formatSum(total())}</span>
      </A>
      <div class="flex min-w-0 flex-col gap-2">
        <div class="flex h-2 gap-px overflow-hidden bg-surface-2" aria-hidden="true">
          <For each={totals()}>
            {(statusTotal) => (
              <Show when={statusTotal.count.count > 0}>
                <span
                  class={`min-w-0.5 ${statusClasses[statusTotal.status].dot}`}
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

/**
 * The kind's types with the most work in `statuses`, busiest first. Types with none are left out;
 * each row shows a chip for every status the type has, completed included.
 */
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
    <Card
      title={props.kind.title}
      bodyClass=""
      actions={
        <Show when={props.entries.length > 0}>
          <A href={`${props.kind.base}/types`} class={linkClass}>
            All {props.entries.length} →
          </A>
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
              />
            )}
          </For>
        </ul>
      </Show>
    </Card>
  );
};

export const Overview = () => {
  const data = createLoader(
    () => true,
    async (_, signal) => {
      const [chains, jobs] = await Promise.all([loadChainTypes(signal), loadJobTypes(signal)]);
      return { chains, jobs };
    },
  );
  useRefresh(data.refetch);

  return (
    <div>
      <div class="mb-5">
        <h1 class="text-base font-semibold">Overview</h1>
      </div>
      <Switch>
        <Match when={data.error()}>
          <ErrorState thing="the overview" error={data.error()} onRetry={data.retry} />
        </Match>
        <Match when={data.loading() || !data.data()}>
          <div class="rounded-xs border border-border">
            <SkeletonRows />
          </div>
        </Match>
        <Match when={data.data()?.chains.length === 0 && data.data()?.jobs.length === 0}>
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
        </Match>
        <Match when={data.data()}>
          {(loaded) => (
            <>
              <Card title="Status" class="mb-6" bodyClass="divide-y divide-border">
                <StatusBreakdown
                  label="Chains"
                  href="/chains/types"
                  statuses={CHAIN_STATUSES}
                  entries={loaded().chains}
                />
                <StatusBreakdown
                  label="Jobs"
                  href="/jobs/types"
                  statuses={JOB_STATUSES}
                  entries={loaded().jobs}
                />
              </Card>
              <div class="grid gap-6 lg:grid-cols-2">
                <TopTypes kind={chainKind} statuses={["running"]} entries={loaded().chains} />
                <TopTypes
                  kind={jobKind}
                  statuses={["blocked", "pending", "running"]}
                  entries={loaded().jobs}
                />
              </div>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
};
