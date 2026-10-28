import { useSearchParams } from "@solidjs/router";
import { For, type JSX, Match, Show, Switch } from "solid-js";

import { type createPagedList } from "../state/createPagedList.js";
import { ErrorState, LiveRegion, SkeletonRows, buttonClass } from "../ui/kit.js";
import { Select } from "../ui/Select.js";
import { type TypeKind, TypePicker } from "./Types.js";

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
