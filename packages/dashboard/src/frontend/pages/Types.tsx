import { useSearchParams } from "@solidjs/router";
import { For, Match, Switch, createMemo, onCleanup } from "solid-js";

import { TypeRow } from "../rows/TypeRow.js";
import { createLoader } from "../state/createLoader.js";
import { useRefresh } from "../state/refresh.js";
import { EmptyState, ErrorState, SkeletonRows, buttonClass } from "../ui/kit.js";
import { type AnyStatus } from "../ui/status.js";
import { type TypeEntry, countOf, loadChainTypes, loadJobTypes, typeListHref } from "./typeData.js";

export type TypeKind = {
  noun: "chain" | "job";
  title: string;
  base: "/chains" | "/jobs";
  load: (signal: AbortSignal) => Promise<TypeEntry<AnyStatus>[]>;
  sorts: { value: string; label: string; key: (entry: TypeEntry<AnyStatus>) => number }[];
};

const sharedSorts: TypeKind["sorts"] = [
  {
    value: "total",
    label: "Total",
    key: (entry) => entry.counts.reduce((sum, statusCount) => sum + statusCount.count.count, 0),
  },
  { value: "running", label: "Running", key: (entry) => countOf(entry, ["running"]) },
];

export const chainKind: TypeKind = {
  noun: "chain",
  title: "Chain types",
  base: "/chains",
  load: loadChainTypes,
  sorts: sharedSorts,
};

export const jobKind: TypeKind = {
  noun: "job",
  title: "Job types",
  base: "/jobs",
  load: loadJobTypes,
  sorts: [
    ...sharedSorts,
    {
      value: "waiting",
      label: "Waiting",
      key: (entry) => countOf(entry, ["blocked", "pending"]),
    },
  ],
};

const TypeList = (props: {
  kind: TypeKind;
  entries: TypeEntry<AnyStatus>[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  query?: string;
  onClearQuery?: () => void;
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
      <Match when={props.entries?.length === 0 && !props.query}>
        <EmptyState title={`No ${props.kind.noun} types found`} />
      </Match>
      <Match when={props.entries?.length === 0}>
        <EmptyState title={`No types match '${props.query}'`}>
          <button
            type="button"
            class={buttonClass.secondary}
            onClick={() => props.onClearQuery?.()}
          >
            Clear
          </button>
        </EmptyState>
      </Match>
      <Match when={props.entries}>
        {(entries) => (
          <ul class="divide-y divide-border overflow-hidden rounded-xs border border-border">
            <For each={entries()}>
              {(entry) => (
                <TypeRow
                  typeName={entry.typeName}
                  counts={entry.counts}
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

/** The type list without filter and sort controls, shown on a list page opened without a type. */
export const TypePicker = (props: { kind: TypeKind }) => {
  const types = createLoader(
    () => true,
    async (_, signal) => props.kind.load(signal),
  );
  useRefresh(types.refetch);
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

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const TypesPage = (props: { kind: TypeKind }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = () => (searchParams.search ?? "") as string;
  const sort = () => (searchParams.sort ?? "name") as string;
  let filterInput!: HTMLInputElement;

  const types = createLoader(
    () => true,
    async (_, signal) => props.kind.load(signal),
  );
  useRefresh(types.refetch);

  const onSlash = (event: KeyboardEvent) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target) || document.querySelector("dialog[open]")) return;
    event.preventDefault();
    filterInput.focus();
  };
  document.addEventListener("keydown", onSlash);
  onCleanup(() => {
    document.removeEventListener("keydown", onSlash);
  });

  const visible = createMemo(() => {
    const all = types.data();
    if (!all) return undefined;
    const query = search().trim().toLowerCase();
    const filtered = query
      ? all.filter((entry) => entry.typeName.toLowerCase().includes(query))
      : all;
    const sorter = props.kind.sorts.find((option) => option.value === sort());
    const byName = (a: TypeEntry<AnyStatus>, b: TypeEntry<AnyStatus>) =>
      a.typeName.localeCompare(b.typeName);
    return [...filtered].sort(
      sorter ? (a, b) => sorter.key(b) - sorter.key(a) || byName(a, b) : byName,
    );
  });

  return (
    <div>
      <div class="mb-5">
        <h1 class="text-base font-semibold">
          {props.kind.title}{" "}
          <span class="text-sm font-normal text-fg-muted tabular-nums">
            {types.data()?.length ?? ""}
          </span>
        </h1>
      </div>
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <label class="relative min-w-0 flex-1 basis-56">
          <span class="sr-only">Filter types</span>
          <input
            ref={(el) => {
              filterInput = el;
            }}
            type="search"
            class="h-9 w-full rounded-xs border border-border-strong bg-surface px-3 pr-8 text-sm placeholder:text-fg-subtle"
            placeholder="Filter types"
            value={search()}
            onInput={(event) => {
              setSearchParams(
                { search: event.currentTarget.value || undefined },
                { replace: true },
              );
            }}
          />
          <kbd class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-xs border border-border px-1 text-[11px] text-fg-subtle">
            /
          </kbd>
        </label>
        <label class="flex items-center gap-2 text-sm text-fg-muted">
          Sort
          <select
            class="h-9 rounded-xs border border-border-strong bg-surface px-2 text-sm text-fg"
            value={sort()}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSearchParams({ sort: value === "name" ? undefined : value }, { replace: true });
            }}
          >
            <option value="name">Name</option>
            <For each={props.kind.sorts}>
              {(option) => <option value={option.value}>{option.label}</option>}
            </For>
          </select>
        </label>
      </div>
      <TypeList
        kind={props.kind}
        entries={visible()}
        loading={types.loading()}
        error={types.error()}
        onRetry={types.retry}
        query={search().trim()}
        onClearQuery={() => {
          setSearchParams({ search: undefined }, { replace: true });
        }}
      />
    </div>
  );
};

export const ChainTypes = () => <TypesPage kind={chainKind} />;

export const JobTypes = () => <TypesPage kind={jobKind} />;
