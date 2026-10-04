import { For, Show } from "solid-js";

import { WarningIcon } from "./icons.js";

const MAX_PIPS = 10;

/**
 * One neutral square per attempt started. Never red: only the latest error is stored, so we never
 * know which attempt failed.
 */
export const Pips = (props: { count: number }) => {
  const shown = () => Math.min(props.count, MAX_PIPS);
  return (
    <span
      class="inline-flex shrink-0 items-center gap-0.5"
      role="img"
      aria-label={`${props.count} ${props.count === 1 ? "attempt" : "attempts"}`}
    >
      <For each={Array.from({ length: shown() })}>
        {() => <span class="size-1.5 rounded-[1px] bg-fg-subtle/70" />}
      </For>
      <Show when={props.count > MAX_PIPS}>
        <span class="ml-0.5 text-[10px] text-fg-subtle">+{props.count - MAX_PIPS}</span>
      </Show>
    </span>
  );
};

/** The only error indicator: a small red warning icon and text. */
export const ErrorMark = (props: { text: string }) => {
  return (
    <span class="inline-flex shrink-0 items-center gap-1 font-medium text-error-fg">
      <WarningIcon size={13} class="text-error-dot" />
      {props.text}
    </span>
  );
};
