import { Box } from "@queuert/ui/components";
import { For, type JSX, Show, onMount } from "solid-js";

import { type Backend, shownInStack, stack } from "../stack.ts";
import { revealOnView } from "./reveal.ts";

type BenchRow = {
  label: string;
  values: number[];
  /** A short note shown after the label, on the same line when it fits. */
  meta?: string;
  /** Tags the row so the reader's saved stack can hide it; untagged rows always show. */
  backend?: Backend;
};

export type BenchGroup = { label?: JSX.Element; rows: BenchRow[] };

/** A series name, or a name tagged with the backend it measures (one series per backend). */
export type BenchSeries = string | { label: string; backend: Backend };

const seriesLabel = (series: BenchSeries) => (typeof series === "string" ? series : series.label);
const seriesBackend = (series: BenchSeries) =>
  typeof series === "string" ? undefined : series.backend;

const seriesShades = [
  ["bg-accent"],
  ["bg-accent/50", "bg-accent"],
  ["bg-accent/40", "bg-accent/70", "bg-accent"],
  ["bg-accent/35", "bg-accent/55", "bg-accent/80", "bg-accent"],
  ["bg-accent/30", "bg-accent/45", "bg-accent/60", "bg-accent/80", "bg-accent"],
  ["bg-accent/25", "bg-accent/40", "bg-accent/55", "bg-accent/70", "bg-accent/85", "bg-accent"],
  [
    "bg-accent/25",
    "bg-accent/35",
    "bg-accent/50",
    "bg-accent/60",
    "bg-accent/75",
    "bg-accent/90",
    "bg-accent",
  ],
];

export const BenchChart = (props: {
  title: JSX.Element;
  unit: string;
  series: BenchSeries[];
  groups: BenchGroup[];
  approximate?: boolean;
  decimals?: number;
  scalePerGroup?: boolean;
}) => {
  /**
   * Bars scale to the rows and series the reader's stack shows, so a narrowed chart stays
   * readable; with `scalePerGroup`, each group (measured under its own conditions) has its own.
   */
  const max = (scaled: BenchGroup) =>
    Math.max(
      ...(props.scalePerGroup ? [scaled] : props.groups).flatMap((group) =>
        group.rows
          .filter((row) => shownInStack(row.backend, stack()))
          .flatMap((row) =>
            row.values.filter((_, index) =>
              shownInStack(seriesBackend(props.series[index]), stack()),
            ),
          ),
      ),
    );
  const shades = () => seriesShades[props.series.length - 1] ?? seriesShades[0];
  const format = (value: number) =>
    `${props.approximate ? "~" : ""}${value.toLocaleString("en-US", {
      minimumFractionDigits: props.decimals ?? 0,
      maximumFractionDigits: props.decimals ?? 0,
    })}`;
  let list: HTMLUListElement | undefined = undefined;
  onMount(() => {
    revealOnView(list);
  });
  const seriesWidth = () =>
    `${Math.max(...props.series.map((series) => seriesLabel(series).length), 1) + 1}ch`;
  const groupShown = (group: BenchGroup) =>
    group.rows.some((row) => shownInStack(row.backend, stack()));
  const seriesShown = () =>
    props.series.some((series) => shownInStack(seriesBackend(series), stack()));

  return (
    <Box
      title={props.title}
      actions={<span class="text-fg-subtle">{props.unit}</span>}
      class="my-6"
      bodyClass=""
    >
      <Show when={props.series.length > 1}>
        <div class="flex flex-wrap gap-x-4 gap-y-1 border-b border-border px-4 pt-2 pb-2 text-xs text-fg-muted">
          <For each={props.series}>
            {(series, index) => (
              <span class="inline-flex items-center gap-1.5" data-backend={seriesBackend(series)}>
                <span class={`inline-block h-2 w-3 rounded-xs ${shades()[index()]}`} />{" "}
                {seriesLabel(series)}
              </span>
            )}
          </For>
        </div>
      </Show>
      <ul ref={list} class="row-list pt-1 pb-1.5">
        <Show when={!seriesShown()}>
          <li class="px-4 py-3 text-[13px] text-fg-subtle">
            Nothing measured here for the backends you picked.
          </li>
        </Show>
        <For each={props.groups}>
          {(group) => (
            <>
              <Show when={group.label}>
                <li class="px-4 pt-2 pb-0.5 text-[11px] font-semibold font-mono tracking-wider text-fg-subtle uppercase not-first:mt-1.5 not-first:border-t not-first:border-border">
                  {group.label}
                </li>
              </Show>
              <Show when={seriesShown() && !groupShown(group)}>
                <li class="px-4 py-2 text-[13px] text-fg-subtle">
                  Nothing measured here for the backends you picked.
                </li>
              </Show>
              <For each={group.rows}>
                {(row) => (
                  <li
                    data-backend={row.backend}
                    class={`grid gap-x-4 gap-y-1 px-4 hover:bg-surface-2/50 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center ${
                      props.series.length === 1
                        ? "grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center py-0.5"
                        : "py-2"
                    }`}
                  >
                    <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] leading-5">
                      <span class="font-medium break-all text-fg">{row.label}</span>
                      <Show when={row.meta}>
                        <span class="text-xs text-fg-subtle">{row.meta}</span>
                      </Show>
                    </div>{" "}
                    <div class="flex min-w-0 flex-col gap-0.5 text-xs leading-5">
                      <For each={row.values}>
                        {(value, index) => (
                          <div
                            class="flex items-center gap-2"
                            data-backend={seriesBackend(props.series[index()])}
                          >
                            <Show when={props.series.length > 1}>
                              <span
                                class="shrink-0 text-fg-subtle"
                                style={{ width: seriesWidth() }}
                              >
                                {seriesLabel(props.series[index()])}
                              </span>{" "}
                            </Show>
                            <div class="flex min-w-0 flex-1 items-center gap-2">
                              <span
                                class={`reveal-bar h-2 shrink-0 rounded-r-xs ${shades()[index()]}`}
                                style={{
                                  width: `max(2px, ${(value / max(group)) * 74}%)`,
                                  "--reveal-delay": `${index() * 120}ms`,
                                }}
                              />{" "}
                              <span
                                class="reveal-fade shrink-0 text-fg tabular-nums"
                                style={{ "--reveal-delay": `${380 + index() * 120}ms` }}
                              >
                                {format(value)}
                              </span>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </li>
                )}
              </For>
            </>
          )}
        </For>
      </ul>
    </Box>
  );
};
