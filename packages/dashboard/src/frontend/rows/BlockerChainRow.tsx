import { A } from "@solidjs/router";

import { type UnknownChain } from "../api.js";
import { IdChip } from "../ui/IdChip.js";
import { StatusPill } from "../ui/StatusPill.js";
import { Time } from "../ui/Time.js";

/** A chain this job waits on; laid out like {@link BlockedJobRow}, its counterpart on chain detail. */
export const BlockerChainRow = (props: { chain: UnknownChain }) => (
  <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5">
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <StatusPill status={props.chain.status} />
      <A
        href={`/chains/${props.chain.id}`}
        class="min-w-0 truncate text-sm font-medium hover:underline"
        title={props.chain.typeName}
      >
        {props.chain.typeName}
      </A>
      <IdChip id={props.chain.id} prefix="chain" href={`/chains/${props.chain.id}`} />
    </div>
    <span class="text-xs text-fg-muted">
      <Time date={props.chain.createdAt} />
    </span>
  </li>
);
