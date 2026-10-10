import { useLocation, useSearchParams } from "@solidjs/router";
import { For, type JSX, Match, Show, Switch } from "solid-js";

import { basePath } from "../base.js";
import { type CappedCount, formatCount, formatSum, sumCounts } from "../domain/counts.js";
import { type createPagedList } from "../state/createPagedList.js";
import { ArrowDownIcon, ArrowUpIcon } from "../ui/icons.js";
import { ErrorState, LiveRegion, SkeletonRows, buttonClass } from "../ui/kit.js";
import { Select } from "../ui/Select.js";
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
        <Select
          variant="ghost"
          label="Switch type"
          placeholder="Switch type"
          value={undefined}
          options={(props.typeNames ?? [])
            .filter((name) => name !== props.typeName)
            .map((name) => ({ value: name, label: name }))}
          onChange={(typeName) => {
            setSearchParams({ typeName });
          }}
        />
      </div>
    </div>
  );
};

/** One bordered row of list filters; items wrap onto more lines when the page is narrow. */
export const FilterBar = (props: { children: JSX.Element }) => (
  <div class="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xs border border-border py-1.5 pr-1.5 pl-3">
    {props.children}
  </div>
);

/**
 * A filter bar control with its muted caption (stacked above it on narrow screens); the control
 * carries its own accessible name.
 */
export const FilterGroup = (props: { label: string; children: JSX.Element }) => (
  <div class="flex max-w-full min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
    <span class="shrink-0 text-sm text-fg-muted" aria-hidden="true">
      {props.label}
    </span>
    {props.children}
  </div>
);

/** Segmented control: a tinted track whose selected segment (`aria-current`/`aria-pressed`) is filled. */
export const segmentGroupClass = "flex max-w-full min-w-0 flex-wrap rounded-xs bg-surface-2 p-0.5";
export const segmentClass =
  "group inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xs px-2.5 py-1 text-sm text-fg-muted hover:text-fg aria-[current=true]:bg-fg aria-[current=true]:font-medium aria-[current=true]:text-bg aria-pressed:bg-fg aria-pressed:font-medium aria-pressed:text-bg";
const segmentCountClass =
  "text-fg-subtle tabular-nums group-aria-[current=true]:text-bg group-aria-[current=true]:opacity-75";

/**
 * Switching status drops `orderBy`, since the sort options depend on the status. Plain anchors
 * (the router still handles the clicks): `<A>` sets its own `aria-current` from the path alone,
 * which would mark every status current.
 */
export const StatusFilter = (props: {
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
    return `${basePath}${props.base}?${params}`;
  };
  const countOf = (status: AnyStatus) =>
    props.counts?.find((statusCount) => statusCount.status === status)?.count;

  return (
    <FilterGroup label="Status">
      <nav class={segmentGroupClass} aria-label="Status">
        <a
          href={href()}
          aria-current={props.selected === "" ? "true" : undefined}
          class={segmentClass}
        >
          All
          <Show when={props.counts}>
            {(counts) => (
              <span class={segmentCountClass}>
                ({formatSum(sumCounts(counts().map((statusCount) => statusCount.count)))})
              </span>
            )}
          </Show>
        </a>
        <For each={props.statuses}>
          {(status) => (
            <a
              href={href(status)}
              aria-current={props.selected === status ? "true" : undefined}
              class={segmentClass}
            >
              <StatusDot status={status} />
              <span class="capitalize">{status}</span>
              <Show when={countOf(status)}>
                {(count) => <span class={segmentCountClass}>({formatCount(count())})</span>}
              </Show>
            </a>
          )}
        </For>
      </nav>
    </FilterGroup>
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
    <div class="ml-auto flex shrink-0 items-center gap-2">
      <span class="text-sm text-fg-muted" aria-hidden="true">
        Sort
      </span>
      <Select
        label="Sort by"
        value={props.orderBy}
        options={props.options}
        onChange={(orderBy) => {
          setSearchParams({ orderBy });
        }}
      />
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
