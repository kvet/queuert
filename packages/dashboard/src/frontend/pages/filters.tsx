import { useLocation, useSearchParams } from "@solidjs/router";
import { For, type JSX, Show } from "solid-js";

import { basePath } from "../base.js";
import { type CappedCount, formatCount, formatSum, sumCounts } from "../domain/counts.js";
import { ArrowDownIcon, ArrowUpIcon } from "../ui/icons.js";
import { buttonClass } from "../ui/kit.js";
import { Select } from "../ui/Select.js";
import { type AnyStatus } from "../ui/status.js";
import { StatusDot } from "../ui/StatusPill.js";

/** Segmented control: a tinted track whose selected segment (`aria-current`) is filled. */
const segmentGroupClass = "flex max-w-full min-w-0 flex-wrap rounded-xs bg-surface-2 p-0.5";
const segmentClass =
  "group inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xs px-2.5 py-1 text-sm text-fg-muted hover:text-fg aria-[current=true]:bg-fg aria-[current=true]:font-medium aria-[current=true]:text-bg";

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
const FilterGroup = (props: { label: string; children: JSX.Element }) => (
  <div class="flex max-w-full min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
    <span class="shrink-0 text-sm text-fg-muted" aria-hidden="true">
      {props.label}
    </span>
    {props.children}
  </div>
);

const segmentCountClass =
  "text-fg-subtle tabular-nums group-aria-[current=true]:text-bg group-aria-[current=true]:opacity-75";

/**
 * Status segments that set the `status` search param on `path`, each with its count. Switching
 * status drops `orderBy`, since the sort options depend on the status. Plain anchors (the router still
 * handles the clicks): `<A>` sets its own `aria-current` from the path alone, which would mark every
 * status current.
 */
export const StatusFilter = (props: {
  path: string;
  statuses: AnyStatus[];
  /** The selected status, or `""` for All. */
  selected: string;
  counts: { status: AnyStatus; count: CappedCount }[] | undefined;
  /** The All count; the sum of `counts` when left out. */
  allCount?: CappedCount;
}) => {
  const location = useLocation();
  const href = (status: string) => {
    const params = new URLSearchParams(location.search);
    if (status) params.set("status", status);
    else params.delete("status");
    params.delete("orderBy");
    return `${basePath}${props.path}?${params}`;
  };
  const countOf = (status: AnyStatus) =>
    props.counts?.find((statusCount) => statusCount.status === status)?.count;
  const allCount = () =>
    props.allCount ??
    (props.counts ? sumCounts(props.counts.map((statusCount) => statusCount.count)) : undefined);

  return (
    <FilterGroup label="Status">
      <nav class={segmentGroupClass} aria-label="Status">
        <a
          href={href("")}
          aria-current={props.selected === "" ? "true" : undefined}
          class={segmentClass}
        >
          All
          <Show when={allCount()}>
            {(count) => <span class={segmentCountClass}>({formatSum(count())})</span>}
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
