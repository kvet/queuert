import { Box, RowLink } from "@queuert/ui/components";
import { For, type JSX, Show } from "solid-js";

import { siteLink } from "./siteLink.ts";

export type KeyValueItem = {
  label: JSX.Element;
  value: JSX.Element;
  note?: JSX.Element;
  href?: string;
};

const valueClass = (item: KeyValueItem) =>
  `min-w-0 wrap-break-word ${item.href === undefined ? "text-fg" : "text-accent-fg"}`;

/** Inline code inside a value reads as plain mono text, not a chip. */
const plainCode = "[&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-xs";

/**
 * The last tile stretches over the empty cells of its row (two columns from `sm`, three from
 * `lg`), so the grid never ends in a stair-step hole.
 */
const lastTileSpan = (count: number) => {
  const sm = count % 2 === 1 ? "sm:col-span-2" : "";
  const lg =
    count % 3 === 1 ? "lg:col-span-3" : count % 3 === 2 ? "lg:col-span-2" : "lg:col-span-1";
  return `${sm} ${lg}`;
};

const ItemLink = (props: { item: KeyValueItem }) => (
  <Show when={props.item.href}>
    {(href) => <RowLink href={href()} label={`Go to ${href()}`} link={siteLink(href())} />}
  </Show>
);

/**
 * Short facts ("at a glance") render as a grid of label-over-value tiles, two or three per row.
 * A list where any item carries a `note` keeps one row per item, so the note has room.
 */
export const KeyValueList = (props: {
  title?: JSX.Element;
  actions?: JSX.Element;
  items: KeyValueItem[];
  class?: string;
}) => {
  // Read once: pages pass `items` inline, so every read of the prop would build its JSX again
  // and break hydration.
  const items = props.items;
  const withNotes = items.some((item) => item.note !== undefined);
  return (
    <Box
      title={props.title}
      actions={props.actions}
      class={`my-6 ${props.class ?? ""}`}
      bodyClass=""
    >
      <Show
        when={withNotes}
        fallback={
          // The wrapper clips the grid's outer cell borders; the Box itself must not clip, or its
          // border title disappears.
          <div class="overflow-hidden rounded-b-xs">
            {/* Below `sm` each fact is one label-value row, so long identifiers keep their line. */}
            <ul class="row-list -mt-px grid grid-cols-1 sm:-ml-px sm:grid-cols-2 lg:grid-cols-3">
              <For each={items}>
                {(item, index) => (
                  <li
                    class={`relative flex min-w-0 items-baseline justify-between gap-4 border-t border-border px-4 py-2 hover:bg-surface-2/50 sm:block sm:border-l sm:py-2.5 ${
                      index() === items.length - 1 ? lastTileSpan(items.length) : ""
                    }`}
                  >
                    <ItemLink item={item} />
                    <div class="shrink-0 font-mono text-[11px] tracking-wider text-fg-subtle uppercase">
                      {item.label}
                    </div>
                    <div
                      class={`min-w-0 text-right text-[13px] leading-5 sm:mt-0.5 sm:text-left ${plainCode} ${valueClass(item)}`}
                    >
                      {item.value}
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </div>
        }
      >
        <ul class="row-list divide-y divide-border">
          <For each={items}>
            {(item) => (
              <li class="relative grid gap-x-6 gap-y-0.5 px-4 py-2 leading-6 hover:bg-surface-2/50 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline">
                <ItemLink item={item} />
                <div class="min-w-0 text-[13px] text-fg-subtle sm:text-sm sm:text-fg-muted">
                  {item.label}
                </div>
                <div class={`font-medium ${valueClass(item)}`}>{item.value}</div>
                <Show when={item.note}>
                  <div class="min-w-0 text-xs leading-5 text-fg-muted sm:col-start-2 [&_code]:text-xs">
                    {item.note}
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Box>
  );
};
