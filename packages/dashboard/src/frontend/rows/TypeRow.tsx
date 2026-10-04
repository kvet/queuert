import { A } from "@solidjs/router";
import { For, Show } from "solid-js";

import { type CappedCount, formatCount, formatSum, sumCounts } from "../domain/counts.js";
import { RowLink } from "../ui/kit.js";
import { type AnyStatus } from "../ui/status.js";
import { StatusDot } from "../ui/StatusPill.js";

/**
 * One-line type summary: name + total and per-status count chips (each links to the list filtered
 * by that status). The row itself opens the unfiltered list.
 */
export const TypeRow = (props: {
  typeName: string;
  counts: { status: AnyStatus; count: CappedCount }[];
  href: (status?: AnyStatus) => string;
}) => {
  const total = () => sumCounts(props.counts.map(({ count }) => count));

  return (
    <li class="relative px-4 py-3 hover:bg-surface-2/50">
      <RowLink href={props.href()} label={`Open ${props.typeName}`} />
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div class="flex min-w-0 flex-1 basis-48 items-baseline gap-2">
          <span class="truncate font-medium" title={props.typeName}>
            {props.typeName}
          </span>
          <span class="shrink-0 text-sm text-fg-muted tabular-nums">{formatSum(total())}</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <For each={props.counts}>
            {(statusCount) => (
              <Show when={statusCount.count.count > 0}>
                <A
                  href={props.href(statusCount.status)}
                  class="relative z-10 inline-flex items-center gap-1.5 rounded-xs border border-border px-2 py-0.5 text-xs text-fg-muted tabular-nums hover:border-border-strong hover:text-fg"
                >
                  <StatusDot status={statusCount.status} />
                  <span class="font-medium text-fg">{formatCount(statusCount.count)}</span>
                  {statusCount.status}
                </A>
              </Show>
            )}
          </For>
        </div>
      </div>
    </li>
  );
};
