import { A } from "@solidjs/router";
import { Show } from "solid-js";

import { type UnknownJob } from "../api.js";
import { shortId } from "../domain/ids.js";
import { WarningIcon } from "../ui/icons.js";
import { IdChip } from "../ui/IdChip.js";
import { RowLink } from "../ui/kit.js";
import { StatusPill } from "../ui/StatusPill.js";
import { Time } from "../ui/Time.js";
import { DataLine, rowClass } from "./ChainRow.js";

export type JobSortKey = "createdAt" | "scheduledAt" | "attemptAt" | "attemptUntil" | "completedAt";

const sortTime = (job: UnknownJob, key: JobSortKey): Date | null => {
  if (key === "scheduledAt") return job.scheduledAt;
  if (key === "attemptAt" && job.status === "running") return job.attemptAt;
  if (key === "attemptUntil" && job.status === "running") return job.attemptUntil;
  if (key === "completedAt" && job.status === "completed") return job.completedAt;
  return job.createdAt;
};

/** Identity and chain on line 1, input/output previews on line 2; details live on the job page. */
export const JobRow = (props: { job: UnknownJob; sortKey: JobSortKey; showType?: boolean }) => {
  const time = () => sortTime(props.job, props.sortKey);
  const output = () =>
    props.job.status === "completed" && props.job.continuedToId === null
      ? props.job.output
      : undefined;
  const failing = () =>
    props.job.status !== "completed" && props.job.lastAttemptError != null
      ? props.job.lastAttemptError
      : undefined;

  return (
    <li class={rowClass}>
      <RowLink href={`/jobs/${props.job.id}`} label={`Open job ${props.job.id}`} />
      <div class="flex min-w-0 items-center gap-2">
        <StatusPill status={props.job.status} />
        <Show when={props.showType}>
          <span class="truncate font-medium" title={props.job.typeName}>
            {props.job.typeName}
          </span>
        </Show>
        <IdChip id={props.job.id} />
        <A
          href={`/chains/${props.job.chainId}`}
          class="relative z-10 min-w-0 truncate text-xs text-accent-fg hover:underline"
          title={`${props.job.chainTypeName} · ${props.job.chainId}`}
        >
          #{props.job.chainIndex + 1} of {props.job.chainTypeName} · {shortId(props.job.chainId)}
        </A>
        <Show when={failing()}>
          {(error) => (
            <span
              class="inline-flex shrink-0 items-center"
              role="img"
              aria-label="Last attempt failed"
              title={error()}
            >
              <WarningIcon size={13} class="text-error-dot" />
            </span>
          )}
        </Show>
      </div>
      <span class="text-xs text-fg-muted">
        <Show when={time()} fallback="—">
          {(date) => <Time date={date()} />}
        </Show>
      </span>
      <DataLine input={props.job.input} output={output()} />
    </li>
  );
};
