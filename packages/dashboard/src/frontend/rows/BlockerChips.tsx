import { A } from "@solidjs/router";
import { For, Show, createSignal } from "solid-js";

import { type UnknownChain } from "../api.js";
import { shortId } from "../domain/ids.js";
import { StatusDot } from "../ui/StatusPill.js";

const VISIBLE = 6;

/** Blocker chains as chips linking to each chain: the first six, then "+n more" expands inline. */
export const BlockerChips = (props: { blockers: UnknownChain[] }) => {
  const [showAll, setShowAll] = createSignal(false);
  const shown = () => (showAll() ? props.blockers : props.blockers.slice(0, VISIBLE));

  return (
    <span class="flex flex-wrap items-center gap-1.5">
      <For each={shown()}>
        {(blocker) => (
          <A
            href={`/chains/${blocker.id}`}
            class="relative z-10 inline-flex max-w-full items-center gap-1.5 rounded-xs border border-border bg-surface px-2 py-0.5 text-xs hover:border-border-strong"
            title={`${blocker.typeName} (${blocker.status})`}
          >
            <StatusDot status={blocker.status} label={blocker.status} />
            <span class="truncate">{blocker.typeName}</span>
            <span class="font-mono text-fg-subtle">{shortId(blocker.id)}</span>
          </A>
        )}
      </For>
      <Show when={!showAll() && props.blockers.length > VISIBLE}>
        <button
          type="button"
          class="relative z-10 rounded-xs px-2 py-0.5 text-xs text-accent-fg hover:underline"
          onClick={() => setShowAll(true)}
        >
          +{props.blockers.length - VISIBLE} more
        </button>
      </Show>
    </span>
  );
};

export const blockerProgress = (blockers: UnknownChain[]): string =>
  `${blockers.filter((blocker) => blocker.status === "completed").length} / ${blockers.length} chains completed`;
