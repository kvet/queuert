import { A, useLocation, useSearchParams } from "@solidjs/router";
import { For, type JSX, Match, Show, Switch } from "solid-js";

import { type CappedCount, formatCount, formatSum, sumCounts } from "../domain/counts.js";
import { type createPagedList } from "../state/createPagedList.js";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon } from "../ui/icons.js";
import { ErrorState, LiveRegion, SkeletonRows, buttonClass } from "../ui/kit.js";
import { type AnyStatus } from "../ui/status.js";
import { StatusDot } from "../ui/StatusPill.js";
import { type TypeKind, TypePicker } from "./Types.js";

/** Renders the list for the `typeName` search param, or the type picker when it is missing. */
export const TypeGate = (props: {
  title: string;
  kind: TypeKind;
  children: (typeName: string) => JSX.Element;
}) => {
  const [searchParams] = useSearchParams();
  const typeName = () => (searchParams.typeName ?? "") as string;

  return (
    <Show
      when={typeName()}
      keyed
      fallback={
        <div>
          <div class="mb-5">
            <h1 class="text-base font-semibold">{props.title}</h1>
          </div>
          <TypePicker kind={props.kind} />
        </div>
      }
    >
      {(name) => props.children(name)}
    </Show>
  );
};

export const ListHeader = (props: { typeName: string; typeNames: string[] | undefined }) => {
  const [, setSearchParams] = useSearchParams();
  return (
    <div class="mb-4">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 class="min-w-0 truncate text-base font-semibold" title={props.typeName}>
          {props.typeName}
        </h1>
        <label class="relative inline-flex items-center">
          <span class="sr-only">Switch type</span>
          <select
            class="h-8 cursor-pointer appearance-none rounded-xs bg-transparent pr-7 pl-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
            value={props.typeName}
            onChange={(event) => {
              setSearchParams({ typeName: event.currentTarget.value });
            }}
          >
            <option value={props.typeName} disabled>
              Switch type
            </option>
            <For each={(props.typeNames ?? []).filter((name) => name !== props.typeName)}>
              {(name) => <option value={name}>{name}</option>}
            </For>
          </select>
          <ChevronDownIcon size={14} class="pointer-events-none absolute right-2 text-fg-muted" />
        </label>
      </div>
    </div>
  );
};

/** Switching status drops `orderBy`, since the sort options depend on the status. */
export const StatusTabs = (props: {
  base: "/chains" | "/jobs";
  statuses: AnyStatus[];
  selected: string;
  counts: { status: AnyStatus; count: CappedCount }[] | undefined;
}) => {
  const location = useLocation();
  const href = (status?: string) => {
    const params = new URLSearchParams(location.search);
    if (status) params.set("status", status);
    else params.delete("status");
    params.delete("orderBy");
    return `${props.base}?${params}`;
  };
  const countOf = (status: AnyStatus) =>
    props.counts?.find((statusCount) => statusCount.status === status)?.count;
  const tabClass =
    "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm aria-[current=page]:border-accent aria-[current=page]:font-medium aria-[current=page]:text-fg border-transparent text-fg-muted hover:text-fg";

  return (
    <nav class="mb-3 flex overflow-x-auto border-b border-border" aria-label="Status">
      <A href={href()} aria-current={props.selected === "" ? "page" : undefined} class={tabClass}>
        All
        <Show when={props.counts}>
          {(counts) => (
            <span class="text-fg-subtle tabular-nums">
              ({formatSum(sumCounts(counts().map((statusCount) => statusCount.count)))})
            </span>
          )}
        </Show>
      </A>
      <For each={props.statuses}>
        {(status) => (
          <A
            href={href(status)}
            aria-current={props.selected === status ? "page" : undefined}
            class={tabClass}
          >
            <StatusDot status={status} />
            <span class="capitalize">{status}</span>
            <Show when={countOf(status)}>
              {(count) => <span class="text-fg-subtle tabular-nums">({formatCount(count())})</span>}
            </Show>
          </A>
        )}
      </For>
    </nav>
  );
};

export const SortControls = (props: {
  options: readonly { value: string; label: string }[];
  orderBy: string;
  orderDirection: string;
}) => {
  const [, setSearchParams] = useSearchParams();
  const ascending = () => props.orderDirection === "asc";
  return (
    <div class="flex items-center gap-1.5">
      <label class="flex items-center gap-2 text-sm text-fg-muted">
        Sort
        <select
          class="h-8 rounded-xs border border-border-strong bg-surface px-2 text-sm text-fg"
          value={props.orderBy}
          onChange={(event) => {
            setSearchParams({ orderBy: event.currentTarget.value });
          }}
        >
          <For each={props.options}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </select>
      </label>
      <button
        type="button"
        class={`${buttonClass.secondary} h-8 px-2`}
        title={ascending() ? "Ascending" : "Descending"}
        aria-label={`Sort direction: ${ascending() ? "ascending" : "descending"}`}
        onClick={() => {
          setSearchParams({ orderDirection: ascending() ? "desc" : "asc" });
        }}
      >
        <Show when={ascending()} fallback={<ArrowDownIcon size={14} />}>
          <ArrowUpIcon size={14} />
        </Show>
      </button>
    </div>
  );
};

const ListCard = (props: { children: JSX.Element }) => (
  <div class="overflow-hidden rounded-xs border border-border">{props.children}</div>
);

/** The paged list with its changed banner, error, loading and empty states, and load-more footer. */
export const PagedListBody = <TItem extends { id: string }>(props: {
  thing: "chains" | "jobs";
  list: ReturnType<typeof createPagedList<unknown, TItem>>;
  empty: JSX.Element;
  children: (item: TItem) => JSX.Element;
}) => {
  const autoLoadMore = () => props.list.autoLoadMore;
  const loadMoreLabel = () => {
    if (autoLoadMore().loading()) return "Loading…";
    if (autoLoadMore().failed()) return "Retry";
    return "Load more";
  };

  return (
    <>
      <Show when={props.list.fresh()}>
        <div class="mb-2 flex items-center justify-between gap-3 rounded-xs border border-accent/40 bg-status-running-bg px-3 py-2 text-sm text-status-running-fg">
          <span>List has changed</span>
          <button
            type="button"
            class="font-medium underline"
            onClick={() => {
              props.list.applyFresh();
            }}
          >
            Show
          </button>
        </div>
      </Show>

      <Switch>
        <Match when={props.list.error()}>
          <ErrorState thing={props.thing} error={props.list.error()} onRetry={props.list.retry} />
        </Match>
        <Match when={props.list.loading()}>
          <ListCard>
            <SkeletonRows />
          </ListCard>
        </Match>
        <Match when={props.list.items().length === 0}>{props.empty}</Match>
        <Match when={true}>
          <ListCard>
            <ul class="divide-y divide-border">
              <For each={props.list.items()}>{(item) => props.children(item)}</For>
            </ul>
            <Show when={props.list.cursor()}>
              <div class="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-fg-muted">
                <span>
                  Showing {props.list.items().length.toLocaleString()} · more load as you scroll
                </span>
                <button
                  type="button"
                  class={buttonClass.secondary}
                  ref={autoLoadMore().ref}
                  disabled={autoLoadMore().loading()}
                  onClick={() => {
                    autoLoadMore().trigger();
                  }}
                >
                  {loadMoreLabel()}
                </button>
              </div>
            </Show>
            <LiveRegion text={props.list.announcement()} />
          </ListCard>
        </Match>
      </Switch>
    </>
  );
};
