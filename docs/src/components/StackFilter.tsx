import { Box, ToggleChips } from "@queuert/ui/components";
import { Show } from "solid-js";

import { type Backend, backends, createPickedStack, setStack } from "../stack.ts";

const labelOf = (id: Backend) => backends.find((backend) => backend.id === id)?.label ?? id;

/**
 * Narrows every benchmark chart to the backends the reader picks. The pick is saved in this
 * browser and shared by every benchmark page; picking none shows every backend.
 */
export const StackFilter = (props: { backends: Backend[] }) => {
  const picked = createPickedStack();

  return (
    <Box
      title="Your stack"
      class="my-6"
      bodyClass="flex flex-col gap-2 px-4 pt-3 pb-3"
      actions={
        <Show when={picked().length > 0}>
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
      <ToggleChips
        label="Backends to show"
        options={props.backends.map((id) => ({ value: id, label: labelOf(id) }))}
        value={picked()}
        onChange={setStack}
      />
      <p class="m-0 text-[13px] text-fg-subtle">
        <Show
          when={picked().length > 0}
          fallback="Showing every backend. Pick the ones you use to hide the rest on every benchmark page; the pick is saved in this browser."
        >
          Showing {picked().map(labelOf).join(", ")}. Saved in this browser for every benchmark
          page.
        </Show>
      </p>
    </Box>
  );
};
