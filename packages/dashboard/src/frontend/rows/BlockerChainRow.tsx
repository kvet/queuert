import { StatusPill } from "@queuert/ui/components";

import type { UnknownChain } from "../../shared/types.ts";
import { appHref } from "../base.ts";
import { IdChip } from "../ui/IdChip.tsx";
import { Time } from "../ui/Time.tsx";

export const BlockerChainRow = (props: { chain: UnknownChain }) => (
  <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5">
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <StatusPill status={props.chain.status} />
      <a
        href={appHref(`/chains/${props.chain.id}`)}
        class="font-mono min-w-0 truncate text-sm font-medium hover:underline"
        title={props.chain.typeName}
      >
        {props.chain.typeName}
      </a>
      <IdChip id={props.chain.id} prefix="chain" href={appHref(`/chains/${props.chain.id}`)} />
    </div>
    <span class="text-xs text-fg-muted">
      <Time date={props.chain.createdAt} />
    </span>
  </li>
);
