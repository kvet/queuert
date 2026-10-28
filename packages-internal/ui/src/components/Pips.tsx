import { For, Show } from "solid-js";

const maxPips = 10;

export const Pips = (props: { count: number }) => {
  const shown = () => Math.min(props.count, maxPips);
  return (
    <span
      class="inline-flex shrink-0 items-center gap-0.5"
      role="img"
      aria-label={`${props.count} ${props.count === 1 ? "attempt" : "attempts"}`}
    >
      <For each={Array.from({ length: shown() })}>
        {() => <span class="size-1.5 rounded-[1px] bg-fg-subtle/70" />}
      </For>
      <Show when={props.count > maxPips}>
        <span class="ml-0.5 text-[10px] text-fg-subtle">+{props.count - maxPips}</span>
      </Show>
    </span>
  );
};
