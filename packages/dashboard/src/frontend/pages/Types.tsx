import { type AnyStatus, CHAIN_STATUSES, JOB_STATUSES } from "@queuert/ui/lib";
import { useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { For, Match, Switch, createMemo } from "solid-js";

import { TypeRow } from "../rows/TypeRow.tsx";
import { chainTypesQuery, jobTypesQuery } from "../state/queries.ts";
import { EmptyState, QueryBoundary, SkeletonCard, buttonClass } from "../ui/kit.tsx";
import { FilterBar, StatusFilter } from "./filters.tsx";
import { type TypeEntry, narrowToStatuses, typeListHref } from "./typeData.ts";

export type TypeKind = {
  noun: "chain" | "job";
  title: string;
  base: "/chains" | "/jobs";
  query: typeof chainTypesQuery;
  statuses: AnyStatus[];
};

export const chainKind: TypeKind = {
  noun: "chain",
  title: "Chain types",
  base: "/chains",
  query: chainTypesQuery,
  statuses: CHAIN_STATUSES,
};

export const jobKind: TypeKind = {
  noun: "job",
  title: "Job types",
  base: "/jobs",
  query: jobTypesQuery,
  statuses: JOB_STATUSES,
};

const TypeList = (props: {
  kind: TypeKind;
  entries: TypeEntry<AnyStatus>[];
  status?: AnyStatus;
  onShowAll?: () => void;
}) => {
  return (
    <QueryBoundary thing={`${props.kind.noun} types`} fallback={<SkeletonCard />}>
      <Switch>
        <Match when={props.entries.length === 0 && props.status}>
          {(status) => (
            <EmptyState title={`No ${status()} ${props.kind.noun}s`}>
              <button
                type="button"
                class={buttonClass.secondary}
                onClick={() => props.onShowAll?.()}
              >
                Show all
              </button>
            </EmptyState>
          )}
        </Match>
        <Match when={props.entries.length === 0}>
          <EmptyState title={`No ${props.kind.noun} types found`} />
        </Match>
        <Match when={true}>
          <ul class="divide-y divide-border overflow-hidden rounded-xs border border-border">
            <For each={props.entries}>
              {(entry) => (
                <TypeRow
                  typeName={entry.typeName}
                  counts={entry.counts}
                  workers={entry.workers}
                  href={(status) => typeListHref(props.kind.base, entry.typeName, status)}
                />
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </QueryBoundary>
  );
};

export const TypePicker = (props: { kind: TypeKind }) => {
  const types = useQuery(() => props.kind.query());
  return <TypeList kind={props.kind} entries={types.data} />;
};

const TypesPage = (props: { kind: TypeKind }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = () => props.kind.statuses.find((option) => option === searchParams.status);

  const types = useQuery(() => props.kind.query());

  const typeCounts = createMemo(() => {
    if (!types.isSuccess) return undefined;
    const all = types.data;
    return {
      all: { count: all.length, hasMore: false },
      byStatus: props.kind.statuses.map((option) => ({
        status: option,
        count: { count: narrowToStatuses(all, [option]).length, hasMore: false },
      })),
    };
  });

  const visible = createMemo(() => {
    const selected = status();
    return (selected ? narrowToStatuses(types.data, [selected]) : types.data.slice()).sort((a, b) =>
      a.typeName.localeCompare(b.typeName),
    );
  });

  return (
    <div>
      <div class="mb-5">
        <h1 class="text-base font-semibold">
          {props.kind.title}{" "}
          <span class="text-sm font-normal text-fg-muted tabular-nums">
            {types.isSuccess ? visible().length : ""}
          </span>
        </h1>
      </div>
      <FilterBar>
        <StatusFilter
          path={`${props.kind.base}/types`}
          statuses={props.kind.statuses}
          selected={status() ?? ""}
          counts={typeCounts()?.byStatus}
          allCount={typeCounts()?.all}
        />
      </FilterBar>
      <TypeList
        kind={props.kind}
        entries={visible()}
        status={status()}
        onShowAll={() => {
          setSearchParams({ status: undefined });
        }}
      />
    </div>
  );
};

export const ChainTypes = () => <TypesPage kind={chainKind} />;

export const JobTypes = () => <TypesPage kind={jobKind} />;
