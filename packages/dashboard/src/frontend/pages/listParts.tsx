import { useSearchParams } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/solid-query";
import type { Page } from "queuert";
import { For, Show, createEffect, createMemo } from "solid-js";

import { loadedAnnouncement, loadedItems, shouldLoadNextPage } from "../domain/pages.ts";
import { createWindowVirtualizer } from "../state/createWindowVirtualizer.ts";
import { LiveRegion, QueryBoundary, SkeletonCard, buttonClass } from "../ui/kit.tsx";
import { Select } from "../ui/Select.tsx";
import { type TypeKind, TypePicker } from "./Types.tsx";

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

const ListCard = (props: { children: JSX.Element }) => (
  <div class="overflow-hidden rounded-xs border border-border">{props.children}</div>
);

export type PagedQuery<TItem> = UseInfiniteQueryResult<InfiniteData<Page<TItem>>>;

export const LoadMoreFooter = (props: {
  query: PagedQuery<unknown>;
  shownCount: number;
  class?: string;
}) => {
  const loadMoreLabel = () => {
    if (props.query.isFetchingNextPage) return "Loading…";
    if (props.query.isFetchNextPageError) return "Retry";
    return "Load more";
  };

  return (
    <Show when={props.query.hasNextPage}>
      <div
        class={[
          "flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-fg-muted",
          props.class,
        ]}
      >
        <span>Showing {props.shownCount.toLocaleString()} · more load as you scroll</span>
        <button
          type="button"
          class={buttonClass.secondary}
          disabled={props.query.isFetchingNextPage}
          onClick={() => {
            void props.query.fetchNextPage();
          }}
        >
          {loadMoreLabel()}
        </button>
      </div>
    </Show>
  );
};

const AUTO_LOAD_DISTANCE = 10;

export const VirtualList = <TItem extends { id: string }>(props: {
  query: PagedQuery<TItem>;
  class?: string;
  children: (item: TItem) => JSX.Element;
}) => {
  const items = createMemo(() => loadedItems(props.query.data.pages));
  const virtual = createWindowVirtualizer({ count: () => items().length, estimateSize: 56 });

  createEffect(
    () =>
      (virtual.items().at(-1)?.index ?? -1) >= items().length - AUTO_LOAD_DISTANCE &&
      shouldLoadNextPage(props.query),
    (shouldLoad) => {
      if (shouldLoad) void props.query.fetchNextPage();
    },
  );

  return (
    <>
      <ul
        ref={virtual.listRef}
        class={["divide-y divide-border", props.class]}
        style={{
          "padding-top": `${virtual.paddingTop()}px`,
          "padding-bottom": `${virtual.paddingBottom()}px`,
        }}
      >
        <For each={virtual.items()} keyed={(item) => item.key}>
          {(item) => (
            <Show when={items()[item().index]} keyed>
              {(row) => props.children(row)}
            </Show>
          )}
        </For>
      </ul>
      <LoadMoreFooter query={props.query} shownCount={items().length} />
      <LiveRegion text={loadedAnnouncement(props.query.data.pages)} />
    </>
  );
};

export const PagedListBody = <TItem extends { id: string }>(props: {
  thing: "chains" | "jobs" | "workers";
  query: PagedQuery<TItem>;
  empty: JSX.Element;
  children: (item: TItem) => JSX.Element;
}) => (
  <QueryBoundary thing={props.thing} fallback={<SkeletonCard />}>
    <Show when={props.query.data.pages[0].items.length > 0} fallback={props.empty}>
      <ListCard>
        <VirtualList query={props.query}>{props.children}</VirtualList>
      </ListCard>
    </Show>
  </QueryBoundary>
);
