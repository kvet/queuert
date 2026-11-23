import { Tabs } from "@kobalte/core/tabs";
import type { JSX } from "@solidjs/web";
import { For, children, createSignal } from "solid-js";

type CodeTourStepProps = { label: string; caption: string; children: JSX.Element };

const isCodeTourStep = (item: unknown): item is CodeTourStepProps =>
  typeof item === "object" && item !== null && "label" in item && "caption" in item;

/** One step of a `CodeTour`; its child is the `<ExampleCode>` shown when the step is selected. */
export const CodeTourStep = (props: CodeTourStepProps) => props as unknown as JSX.Element;

export const CodeTour = (props: { children: JSX.Element }) => {
  const resolved = children(() => props.children);
  const steps = () => (resolved.toArray() as unknown[]).filter(isCodeTourStep);
  const [selected, setSelected] = createSignal("0");

  return (
    <Tabs
      orientation="vertical"
      value={selected()}
      onChange={setSelected}
      class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
    >
      <Tabs.List as="ol" class="flex flex-col gap-2" aria-label="Code tour">
        <For each={steps()}>
          {(item, index) => (
            <li role="presentation">
              <Tabs.Trigger
                value={String(index())}
                class="group flex w-full gap-3 rounded-xs border border-transparent px-3 py-3 text-left hover:bg-surface-2 data-selected:border-border data-selected:bg-surface"
              >
                <span class="grid size-6 shrink-0 place-items-center rounded-xs bg-surface-2 text-xs font-semibold group-data-selected:bg-fg group-data-selected:text-bg">
                  {index() + 1}
                </span>
                <span class="flex flex-col gap-1">
                  <span class="font-semibold">{item.label}</span>
                  <span class="text-[13px] leading-5 text-fg-muted">{item.caption}</span>
                </span>
              </Tabs.Trigger>
            </li>
          )}
        </For>
      </Tabs.List>
      <div class="grid min-w-0 self-start">
        <For each={steps()}>
          {(item, index) => (
            <Tabs.Content
              value={String(index())}
              forceMount
              class={[
                "col-start-1 row-start-1 min-w-0 [&>*]:my-0",
                selected() === String(index()) ? "animate-fade-in" : "invisible",
              ]}
            >
              {item.children}
            </Tabs.Content>
          )}
        </For>
      </div>
    </Tabs>
  );
};
