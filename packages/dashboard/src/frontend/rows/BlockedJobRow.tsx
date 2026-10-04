import { A } from "@solidjs/router";

import { type UnknownJob } from "../api.js";
import { shortId } from "../domain/ids.js";
import { IdChip } from "../ui/IdChip.js";
import { StatusPill } from "../ui/StatusPill.js";
import { Time } from "../ui/Time.js";

/** A job in another chain that declared this chain as a blocker. Links to the job, not its chain. */
export const BlockedJobRow = (props: { job: UnknownJob }) => (
  <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5">
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <StatusPill status={props.job.status} />
      <A
        href={`/jobs/${props.job.id}`}
        class="min-w-0 truncate text-sm font-medium hover:underline"
        title={props.job.typeName}
      >
        {props.job.typeName}
      </A>
      <IdChip id={props.job.id} prefix="job" href={`/jobs/${props.job.id}`} />
      <A
        href={`/chains/${props.job.chainId}`}
        class="min-w-0 truncate text-xs text-accent-fg hover:underline"
        title={`${props.job.chainTypeName} · ${props.job.chainId}`}
      >
        #{props.job.chainIndex + 1} of {props.job.chainTypeName} · {shortId(props.job.chainId)}
      </A>
    </div>
    <span class="text-xs text-fg-muted">
      <Time date={props.job.createdAt} />
    </span>
  </li>
);
