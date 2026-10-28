import { Box, Chip } from "@queuert/ui/components";
import { For, Show } from "solid-js";

type BenchRow = {
  label: string;
  values: number[];
  chips?: string[];
  meta?: string;
};

export type BenchGroup = { label?: string; rows: BenchRow[] };

const seriesShades = [
  ["bg-accent"],
  ["bg-accent/50", "bg-accent"],
  ["bg-accent/40", "bg-accent/70", "bg-accent"],
  ["bg-accent/35", "bg-accent/55", "bg-accent/80", "bg-accent"],
];

export const BenchChart = (props: {
  title: string;
  unit: string;
  series: string[];
  groups: BenchGroup[];
  approximate?: boolean;
  decimals?: number;
}) => {
  const max = () =>
    Math.max(...props.groups.flatMap((group) => group.rows.flatMap((row) => row.values)));
  const shades = () => seriesShades[props.series.length - 1] ?? seriesShades[0];
  const format = (value: number) =>
    `${props.approximate ? "~" : ""}${value.toLocaleString("en-US", {
      minimumFractionDigits: props.decimals ?? 0,
      maximumFractionDigits: props.decimals ?? 0,
    })}`;
  const seriesWidth = () => `${Math.max(...props.series.map((name) => name.length), 1) + 1}ch`;

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
            {(name, index) => (
              <span class="inline-flex items-center gap-1.5">
                <span class={`inline-block h-2 w-3 rounded-xs ${shades()[index()]}`} /> {name}
              </span>
            )}
          </For>
        </div>
      </Show>
      <ul class="row-list divide-y divide-border">
        <For each={props.groups}>
          {(group) => (
            <>
              <Show when={group.label}>
                <li class="bg-surface-2/50 px-4 py-1 text-xs font-semibold font-mono tracking-wider text-fg-subtle uppercase">
                  {group.label}
                </li>
              </Show>
              <For each={group.rows}>
                {(row) => (
                  <li class="grid gap-x-4 gap-y-1 px-4 py-2 hover:bg-surface-2/50 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center">
                    <div class="min-w-0 text-[13px] leading-5">
                      <span class="font-medium break-all text-fg">{row.label}</span>
                      <Show when={row.chips ?? row.meta}>
                        <span class="flex flex-wrap items-center gap-1.5 pt-1 text-fg-subtle">
                          <For each={row.chips ?? []}>
                            {(chip) => (
                              <>
                                {" "}
                                <Chip mono>{chip}</Chip>
                              </>
                            )}
                          </For>{" "}
                          <span>{row.meta}</span>
                        </span>
                      </Show>
                    </div>{" "}
                    <div class="flex min-w-0 flex-col gap-0.5 text-xs leading-5">
                      <For each={row.values}>
                        {(value, index) => (
                          <div class="flex items-center gap-2">
                            <Show when={props.series.length > 1}>
                              <span
                                class="shrink-0 text-fg-subtle"
                                style={{ width: seriesWidth() }}
                              >
                                {props.series[index()]}
                              </span>{" "}
                            </Show>
                            <div class="flex min-w-0 flex-1 items-center gap-2">
                              <span
                                class={`h-2 shrink-0 rounded-r-xs ${shades()[index()]}`}
                                style={{
                                  width: `max(2px, ${(value / max()) * 74}%)`,
                                }}
                              />{" "}
                              <span class="shrink-0 text-fg tabular-nums">{format(value)}</span>
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
