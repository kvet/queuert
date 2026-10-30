import { Chip, RowLink, WarningIcon } from "@queuert/ui/components";
import { type AnyStatus } from "@queuert/ui/lib";
import { A } from "@solidjs/router";
import { For, Show } from "solid-js";

import { type CappedCount, formatCount } from "../domain/counts.js";

export const TypeRow = (props: {
  typeName: string;
  counts: { status: AnyStatus; count: CappedCount }[];
  href: (status?: AnyStatus) => string;
  workers?: { liveCount: number; stranded: boolean };
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
        <Show when={props.workers}>
          {(workers) => (
            <A
              href={`/workers?typeName=${encodeURIComponent(props.typeName)}`}
              class="relative z-10 inline-flex items-center gap-1 text-xs text-fg-muted tabular-nums hover:text-fg"
            >
              <Show when={workers().stranded}>
                <span
                  class="inline-flex shrink-0 items-center"
                  role="img"
                  aria-label="No live worker processes this type"
                  title="No live worker processes this type"
                >
                  <WarningIcon size={13} class="text-error-dot" />
                </span>
              </Show>
              {workers().liveCount} {workers().liveCount === 1 ? "worker" : "workers"}
            </A>
          )}
        </Show>
      </div>
    </div>
  </li>
);
