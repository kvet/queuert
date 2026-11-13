import { Box } from "@queuert/ui/components";
import { For, Show } from "solid-js";

import { type Backend, backends, setStack, stack } from "../stack.ts";

const labelOf = (id: Backend) => backends.find((backend) => backend.id === id)?.label ?? id;

/**
 * Narrows every benchmark chart to the backends the reader picks. The pick is saved in this
 * browser and shared by every benchmark page; picking none shows every backend.
 */
export const StackFilter = (props: { backends: Backend[] }) => {
  const toggle = (id: Backend) => {
    setStack(stack().includes(id) ? stack().filter((picked) => picked !== id) : [...stack(), id]);
  };

  return (
    <Box
      title="Your stack"
      class="my-6"
      bodyClass="flex flex-col gap-2 px-4 pt-3 pb-3"
      actions={
        <Show when={stack().length > 0}>
          <button
            type="button"
            class="text-fg-subtle hover:text-fg"
            onClick={() => {
              setStack([]);
            }}
          >
            Show all
          </button>
        </Show>
      }
    >
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Backends to show">
        <For each={props.backends}>
          {(id) => (
            <button
              type="button"
              aria-pressed={stack().includes(id)}
              class="rounded-xs border border-border px-2 py-0.5 text-xs text-fg-muted hover:border-border-strong hover:text-fg aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-bg"
              onClick={() => {
                toggle(id);
              }}
            >
              {labelOf(id)}
            </button>
          )}
        </For>
      </div>
      <p class="m-0 text-[13px] text-fg-subtle">
        <Show
          when={stack().length > 0}
          fallback="Showing every backend. Pick the ones you use to hide the rest on every benchmark page; the pick is saved in this browser."
        >
          Showing {stack().map(labelOf).join(", ")}. Saved in this browser for every benchmark page.
        </Show>
      </p>
    </Box>
  );
};
