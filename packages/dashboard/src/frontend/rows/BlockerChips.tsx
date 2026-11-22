import { Chip } from "@queuert/ui/components";
import { shortId } from "@queuert/ui/lib";
import { For, Show, createSignal } from "solid-js";

import type { UnknownChain } from "../../shared/types.ts";
import { appHref } from "../base.ts";

const VISIBLE = 6;

export const BlockerChips = (props: { blockers: UnknownChain[] }) => {
  const [showAll, setShowAll] = createSignal(false);
  const shown = () => (showAll() ? props.blockers : props.blockers.slice(0, VISIBLE));

  return (
    <span class="flex flex-wrap items-center gap-1.5">
      <For each={shown()}>
        {(blocker) => (
          <Chip
            href={appHref(`/chains/${blocker.id}`)}
            status={blocker.status}
            statusLabel={blocker.status}
            class="bg-surface"
            title={`${blocker.typeName} (${blocker.status})`}
          >
            <span class="truncate font-mono">{blocker.typeName}</span>
            <span class="font-mono text-fg-subtle">{shortId(blocker.id)}</span>
          </Chip>
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
