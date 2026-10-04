import { Show } from "solid-js";

import { type UnknownChain } from "../api.js";
import { jsonPreview } from "../domain/json.js";
import { IdChip } from "../ui/IdChip.js";
import { RowLink } from "../ui/kit.js";
import { StatusPill } from "../ui/StatusPill.js";
import { Time } from "../ui/Time.js";

export const rowClass =
  "relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2 hover:bg-surface-2/50";

const DataPreview = (props: { label: string; value: unknown }) => (
  <Show when={props.value != null}>
    <span class="min-w-0 truncate" title={jsonPreview(props.value)}>
      <span class="text-fg-muted">{props.label} </span>
      {jsonPreview(props.value)}
    </span>
  </Show>
);

/** The second line of a list row: one-line input and, once there is one, output previews. */
export const DataLine = (props: { input: unknown; output?: unknown }) => (
  <Show when={props.input != null || props.output != null}>
    <div class="col-span-2 flex min-w-0 gap-6 text-xs text-fg-subtle">
      <DataPreview label="in" value={props.input} />
      <DataPreview label="out" value={props.output} />
    </div>
  </Show>
);

export const ChainRow = (props: {
  chain: UnknownChain;
  sortKey: "createdAt" | "completedAt";
  showType?: boolean;
}) => {
  const sortTime = () =>
    props.sortKey === "completedAt" && props.chain.status === "completed"
      ? props.chain.completedAt
      : props.chain.createdAt;

  return (
    <li class={rowClass}>
      <RowLink href={`/chains/${props.chain.id}`} label={`Open chain ${props.chain.id}`} />
      <div class="flex min-w-0 items-center gap-2">
        <StatusPill status={props.chain.status} />
        <Show when={props.showType}>
          <span class="truncate font-medium" title={props.chain.typeName}>
            {props.chain.typeName}
          </span>
        </Show>
        <IdChip id={props.chain.id} />
      </div>
      <Time date={sortTime()} class="text-xs text-fg-muted" />
      <DataLine
        input={props.chain.input}
        output={props.chain.status === "completed" ? props.chain.output : undefined}
      />
    </li>
  );
};
