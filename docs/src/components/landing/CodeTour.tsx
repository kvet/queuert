import { For, type JSX, children, createSignal, createUniqueId } from "solid-js";

type CodeTourStepProps = { label: string; caption: string; children: JSX.Element };

const isCodeTourStep = (item: unknown): item is CodeTourStepProps =>
  typeof item === "object" && item !== null && "label" in item && "caption" in item;

/** One step of a `CodeTour`; its child is the `<ExampleCode>` shown when the step is selected. */
export const CodeTourStep = (props: CodeTourStepProps) => props as unknown as JSX.Element;

export const CodeTour = (props: { children: JSX.Element }) => {
  const resolved = children(() => props.children);
  const steps = () => (resolved.toArray() as unknown[]).filter(isCodeTourStep);
  const [selected, setSelected] = createSignal(0);
  const id = createUniqueId();

  return (
    <div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <ol class="flex flex-col gap-2" role="tablist" aria-label="Code tour">
        <For each={steps()}>
          {(item, index) => (
            <li>
              <button
                type="button"
                role="tab"
                id={`${id}-tab-${index()}`}
                aria-controls={`${id}-panel-${index()}`}
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
      {/* Every step sits in the same grid cell, so the box keeps the tallest step's height. */}
      <div class="grid min-w-0 self-start">
        <For each={steps()}>
          {(item, index) => (
            <div
              role="tabpanel"
              id={`${id}-panel-${index()}`}
              aria-labelledby={`${id}-tab-${index()}`}
              class={`col-start-1 row-start-1 min-w-0 [&>*]:my-0 ${
                selected() === index() ? "animate-fade-in" : "invisible"
              }`}
            >
              {item.children}
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
