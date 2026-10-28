import { Row, SubLine, StatusPill } from "@queuert/ui/components";
import { A } from "@solidjs/router";
import { Show } from "solid-js";

import { type UnknownChain } from "../api.js";
import { jsonPreview } from "../domain/json.js";
import { IdChip } from "../ui/IdChip.js";
import { Time } from "../ui/Time.js";

const DataPreview = (props: { label: string; value: unknown }) => (
  <Show when={props.value != null}>
    <span class="min-w-0 truncate font-mono" title={jsonPreview(props.value)}>
      <span class="text-fg-muted">{props.label} </span>
      {jsonPreview(props.value)}
    </span>
  </Show>
);

export const DataLine = (props: { input: unknown; output?: unknown }) => (
  <Show when={props.input != null || props.output != null}>
    <SubLine class="flex gap-6">
      <DataPreview label="in" value={props.input} />
      <DataPreview label="out" value={props.output} />
    </SubLine>
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
    <Row href={`/chains/${props.chain.id}`} label={`Open chain ${props.chain.id}`} link={A}>
      <div class="flex min-w-0 items-center gap-2">
        <StatusPill status={props.chain.status} />
        <Show when={props.showType}>
          <span class="font-mono truncate font-medium" title={props.chain.typeName}>
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
    </Row>
  );
};
