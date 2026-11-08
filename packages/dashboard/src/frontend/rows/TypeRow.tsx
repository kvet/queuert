import { Chip, RowLink, WarningIcon } from "@queuert/ui/components";
import type { AnyStatus } from "@queuert/ui/lib";
import { A } from "@solidjs/router";
import { For, Match, Show, Switch } from "solid-js";

import { type CappedCount, formatCount } from "../domain/counts.ts";
import type { TypeWorkers } from "../domain/workers.ts";

const WorkersChip = (props: { typeName: string; workers: TypeWorkers }) => (
  <Switch>
    <Match when={props.workers.stranded}>
      <Chip
        href={`/workers?typeName=${encodeURIComponent(props.typeName)}`}
        link={A}
        tone="danger"
        class="shrink-0"
      >
        <WarningIcon size={12} class="shrink-0 text-error-dot" />
        no live workers
      </Chip>
    </Match>
    <Match when={props.workers.live > 0}>
      <Chip
        href={`/workers?typeName=${encodeURIComponent(props.typeName)}`}
        link={A}
        class="shrink-0 tabular-nums hover:text-fg"
      >
        <span class="font-medium text-fg">{props.workers.live}</span>
        {props.workers.live === 1 ? "worker" : "workers"}
        <Show when={props.workers.expired > 0}>
          <span>· {props.workers.expired} expired</span>
        </Show>
      </Chip>
    </Match>
    <Match when={props.workers.expired > 0}>
      <Chip
        href={`/workers?typeName=${encodeURIComponent(props.typeName)}`}
        link={A}
        class="shrink-0 tabular-nums hover:text-fg"
      >
        <span class="font-medium text-fg">{props.workers.expired}</span>
        {props.workers.expired === 1 ? "expired worker" : "expired workers"}
      </Chip>
    </Match>
  </Switch>
);

export const TypeRow = (props: {
  typeName: string;
  counts: { status: AnyStatus; count: CappedCount }[];
  href: (status?: AnyStatus) => string;
  workers?: TypeWorkers;
}) => (
  <li class="relative px-4 py-3 hover:bg-surface-2/50">
    <RowLink href={props.href()} label={`Open ${props.typeName}`} link={A} />
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div class="flex min-w-0 flex-1 basis-48 items-center gap-2">
        <span class="font-mono min-w-0 truncate font-medium" title={props.typeName}>
          {props.typeName}
        </span>
        <Show when={props.workers}>
          {(workers) => <WorkersChip typeName={props.typeName} workers={workers()} />}
        </Show>
      </div>
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
