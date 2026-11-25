import { For } from "solid-js";

import { benchmarkMachine, benchmarkSummary, benchmarkSummaryColumns } from "../data/benchmarks.ts";
import { siteHref } from "../docs/href.ts";

const formatCount = (value: number) => Math.round(value).toLocaleString("en-US");

const columns = "sm:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]";

/** Each state adapter's creation and completion throughput from the processing-capacity results. */
export const BenchmarkHighlights = () => (
  <div class="not-prose">
    <div class="rounded-xs border border-border bg-bg text-[13px]">
      <div
        class={`hidden gap-x-3 border-b border-border px-3 py-2 text-fg-muted sm:grid ${columns}`}
      >
        <span>State adapter</span>
        <For each={benchmarkSummaryColumns}>
          {(column) => (
            <span class="text-right">
              <span class="text-fg">{column.label}</span> {column.detail}
              <span class="block font-mono text-[11px] text-fg-subtle">{column.unit}</span>
            </span>
          )}
        </For>
      </div>
      <For each={benchmarkSummary}>
        {(row) => (
          <div
            class={`grid grid-cols-2 gap-x-3 gap-y-1 border-b border-border px-3 py-2 last:border-b-0 ${columns}`}
          >
            <span class="col-span-2 font-medium text-fg sm:col-span-1 sm:font-normal">
              {row.label}
            </span>
            <For each={row.values}>
              {(value, index) => (
                <span class="flex items-baseline justify-between gap-2 sm:block sm:text-right">
                  <span class="text-[11px] text-fg-subtle sm:hidden">
                    {benchmarkSummaryColumns[index()].label}{" "}
                    {benchmarkSummaryColumns[index()].detail} ·{" "}
                    {benchmarkSummaryColumns[index()].unit}
                  </span>
                  <span class="font-mono text-fg tabular-nums">{formatCount(value)}</span>
                </span>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
    <p class="mt-3 text-[13px] text-fg-muted">
      Chains per second created, jobs per second completed by one worker with 16 slots and a no-op
      handler. Measured on {benchmarkMachine.map((item) => item.value).join(", ")}, with databases
      in containers.{" "}
      <a
        href={siteHref("/benchmarks/processing-capacity/")}
        class="text-fg-muted underline hover:text-fg"
      >
        Every adapter and slot count
      </a>
      .
    </p>
  </div>
);
