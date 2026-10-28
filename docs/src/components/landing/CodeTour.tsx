import { Box } from "@queuert/ui/components";
import { For, Show, createSignal } from "solid-js";

import { CopyButton } from "../CopyButton.tsx";

export const CodeTour = (props: {
  steps: { label: string; caption: string; snippet: { code: string; html: string } }[];
}) => {
  const [selected, setSelected] = createSignal(0);
  const step = () => props.steps[selected()];

  return (
    <div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <ol class="flex flex-col gap-2" role="tablist" aria-label="Code tour">
        <For each={props.steps}>
          {(item, index) => (
            <li>
              <button
                type="button"
                role="tab"
                aria-selected={selected() === index()}
                class="group flex w-full gap-3 rounded-xs border border-transparent px-3 py-3 text-left hover:bg-surface-2 aria-selected:border-border aria-selected:bg-surface"
                onClick={() => setSelected(index())}
              >
                <span class="grid size-6 shrink-0 place-items-center rounded-xs bg-surface-2 text-xs font-semibold group-aria-selected:bg-fg group-aria-selected:text-bg">
                  {index() + 1}
                </span>
                <span class="flex flex-col gap-1">
                  <span class="font-semibold">{item.label}</span>
                  <span class="text-[13px] leading-5 text-fg-muted">{item.caption}</span>
                </span>
              </button>
            </li>
          )}
        </For>
      </ol>
      <Box
        title={`${selected() + 1} · ${step().label}`}
        actions={<CopyButton text={step().snippet.code} label="Copy code" />}
        class="min-w-0 self-start"
        bodyClass="code-html min-h-88"
      >
        <Show when={step()} keyed>
          {(current) => <div class="animate-fade-in" innerHTML={current.snippet.html} />}
        </Show>
      </Box>
    </div>
  );
};
