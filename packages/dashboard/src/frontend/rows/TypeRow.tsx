import { Chip, RowLink } from "@queuert/ui/components";
import { type AnyStatus } from "@queuert/ui/lib";
import { A } from "@solidjs/router";
import { For, Show } from "solid-js";

import { type CappedCount, formatCount } from "../domain/counts.js";

export const TypeRow = (props: {
  typeName: string;
  counts: { status: AnyStatus; count: CappedCount }[];
  href: (status?: AnyStatus) => string;
}) => (
  <li class="relative px-4 py-3 hover:bg-surface-2/50">
    <RowLink href={props.href()} label={`Open ${props.typeName}`} link={A} />
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span class="font-mono min-w-0 flex-1 basis-48 truncate font-medium" title={props.typeName}>
        {props.typeName}
      </span>
      <div class="flex flex-wrap items-center gap-1.5">
        <For each={props.counts}>
          {(statusCount) => (
            <Show when={statusCount.count.count > 0}>
              <Chip
                href={props.href(statusCount.status)}
                link={A}
                status={statusCount.status}
                class="tabular-nums hover:text-fg"
              >
                <span class="font-medium text-fg">{formatCount(statusCount.count)}</span>
                {statusCount.status}
              </Chip>
            </Show>
          )}
        </For>
      </div>
    </div>
  </li>
);
