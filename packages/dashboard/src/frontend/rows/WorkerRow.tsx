import { Row, WarningIcon } from "@queuert/ui/components";
import { A } from "@solidjs/router";
import { type Worker } from "queuert";
import { Show } from "solid-js";

import { isLeaseLost } from "../domain/workers.js";
import { now } from "../state/clock.js";
import { IdChip } from "../ui/IdChip.js";
import { Time } from "../ui/Time.js";

export const WorkerRow = (props: { worker: Worker }) => (
  <Row
    href={`/workers/${encodeURIComponent(props.worker.id)}`}
    label={`Open worker ${props.worker.id}`}
    link={A}
  >
    <div class="flex min-w-0 items-center gap-2">
      <span class="truncate font-medium" title={props.worker.name ?? undefined}>
        {props.worker.name ?? "Unnamed worker"}
      </span>
      <IdChip id={props.worker.id} />
      <Show when={isLeaseLost(props.worker, new Date(now()))}>
        <span
          class="inline-flex shrink-0 items-center"
          role="img"
          aria-label="Lease lost"
          title="Lease lost"
        >
          <WarningIcon size={13} class="text-error-dot" />
        </span>
      </Show>
      <span class="shrink-0 text-xs text-fg-muted tabular-nums">
        {props.worker.runningJobCount} / {props.worker.concurrency} running
      </span>
    </div>
    <Time date={props.worker.startedAt} class="text-xs text-fg-muted" />
    <p
      class="col-span-2 truncate font-mono text-xs text-fg-muted"
      title={props.worker.typeNames.join(", ")}
    >
      {props.worker.typeNames.join(", ")}
    </p>
  </Row>
);
