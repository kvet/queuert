import { type AnyStatus, CHAIN_STATUSES, JOB_STATUSES } from "@queuert/ui/lib";
import { useSearchParams } from "@solidjs/router";
import { For, Match, Switch, createMemo } from "solid-js";

import { TypeRow } from "../rows/TypeRow.js";
import { createLoader } from "../state/createLoader.js";
import { EmptyState, ErrorState, SkeletonRows, buttonClass } from "../ui/kit.js";
import { FilterBar, StatusFilter } from "./filters.js";
import {
  type TypeEntry,
  loadChainTypes,
  loadJobTypes,
  narrowToStatuses,
  typeListHref,
} from "./typeData.js";

export type TypeKind = {
  noun: "chain" | "job";
  title: string;
  base: "/chains" | "/jobs";
  load: (signal: AbortSignal) => Promise<TypeEntry<AnyStatus>[]>;
  statuses: AnyStatus[];
};

export const chainKind: TypeKind = {
  noun: "chain",
  title: "Chain types",
  base: "/chains",
  load: loadChainTypes,
  statuses: CHAIN_STATUSES,
};

export const jobKind: TypeKind = {
  noun: "job",
  title: "Job types",
  base: "/jobs",
  load: loadJobTypes,
  statuses: JOB_STATUSES,
};

const TypeList = (props: {
  kind: TypeKind;
  entries: TypeEntry<AnyStatus>[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  status?: AnyStatus;
  onShowAll?: () => void;
}) => {
  return (
    <Switch>
      <Match when={props.error}>
        <ErrorState
          thing={`${props.kind.noun} types`}
          error={props.error}
          onRetry={props.onRetry}
        />
      </Match>
      <Match when={props.loading || !props.entries}>
        <div class="rounded-xs border border-border">
          <SkeletonRows />
        </div>
      </Match>
      <Match when={props.entries?.length === 0 && props.status}>
        {(status) => (
          <EmptyState title={`No ${status()} ${props.kind.noun}s`}>
            <button type="button" class={buttonClass.secondary} onClick={() => props.onShowAll?.()}>
              Show all
            </button>
          </EmptyState>
        )}
      </Match>
      <Match when={props.entries?.length === 0}>
        <EmptyState title={`No ${props.kind.noun} types found`} />
      </Match>
      <Match when={props.entries}>
        {(entries) => (
          <ul class="divide-y divide-border overflow-hidden rounded-xs border border-border">
            <For each={entries()}>
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
        )}
      </Match>
    </Switch>
  );
};

export const TypePicker = (props: { kind: TypeKind }) => {
  const types = createLoader(
    () => true,
    async (_, signal) => props.kind.load(signal),
  );
  return (
    <TypeList
      kind={props.kind}
      entries={types.data()}
      loading={types.loading()}
      error={types.error()}
      onRetry={types.retry}
    />
  );
};

const TypesPage = (props: { kind: TypeKind }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = () => props.kind.statuses.find((option) => option === searchParams.status);

  const types = createLoader(
    () => true,
    async (_, signal) => props.kind.load(signal),
  );

  const narrowed = createMemo(() => {
    const all = types.data();
    const selected = status();
    return all && selected ? narrowToStatuses(all, [selected]) : all;
  });

  const typeCounts = createMemo(() => {
    const all = types.data();
    if (!all) return undefined;
    return {
      all: { count: all.length, hasMore: false },
      byStatus: props.kind.statuses.map((option) => ({
        status: option,
        count: { count: narrowToStatuses(all, [option]).length, hasMore: false },
      })),
    };
  });

  const visible = createMemo(() =>
    narrowed()
      ?.slice()
      .sort((a, b) => a.typeName.localeCompare(b.typeName)),
  );

  return (
    <div>
      <div class="mb-5">
        <h1 class="text-base font-semibold">
          {props.kind.title}{" "}
          <span class="text-sm font-normal text-fg-muted tabular-nums">
            {narrowed()?.length ?? ""}
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
        loading={types.loading()}
        error={types.error()}
        onRetry={types.retry}
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
