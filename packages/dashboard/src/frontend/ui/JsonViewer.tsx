import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js";

import { ChevronRightIcon } from "./icons.js";
import { CopyButton } from "./IdChip.js";
import { Card } from "./kit.js";

const COLLAPSE_DEPTH = 2;
const COLLAPSE_SIZE = 20;

const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] =>
  typeof value === "object" && value !== null;

const entriesOf = (value: Record<string, unknown> | unknown[]): [string, unknown][] =>
  Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value);

const pretty = (value: unknown): string => JSON.stringify(value, null, 2) ?? String(value);

const Scalar = (props: { value: unknown }) => (
  <Switch fallback={<span class="text-fg-subtle">{String(props.value)}</span>}>
    <Match when={typeof props.value === "string"}>
      <span class="break-all text-syntax-string">{JSON.stringify(props.value)}</span>
    </Match>
    <Match when={typeof props.value === "number" || typeof props.value === "bigint"}>
      <span class="text-syntax-number">{String(props.value)}</span>
    </Match>
  </Switch>
);

const JsonNode = (props: { name?: string; value: unknown; depth: number; last: boolean }) => {
  const container = () => (isContainer(props.value) ? props.value : undefined);
  const size = () => {
    const value = container();
    return value ? entriesOf(value).length : 0;
  };
  const [open, setOpen] = createSignal(props.depth < COLLAPSE_DEPTH && size() <= COLLAPSE_SIZE);
  const brackets = () => (Array.isArray(props.value) ? ["[", "]"] : ["{", "}"]);
  const summary = () => {
    const noun = Array.isArray(props.value) ? "item" : "key";
    return `${size()} ${noun}${size() === 1 ? "" : "s"}`;
  };
  const comma = () => (props.last ? "" : ",");
  const label = () =>
    props.name === undefined ? null : (
      <>
        <span class="text-syntax-key">{JSON.stringify(props.name)}</span>
        {": "}
      </>
    );

  return (
    <div class="pl-4">
      <Show
        when={container()}
        fallback={
          <div class="-ml-4 pl-4">
            {label()}
            <Scalar value={props.value} />
            {comma()}
          </div>
        }
      >
        {(value) => (
          <>
            <div class="-ml-4 flex items-start">
              <button
                type="button"
                class="mt-0.5 mr-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-xs text-fg-subtle hover:text-fg"
                aria-expanded={open()}
                aria-label={open() ? "Collapse" : "Expand"}
                onClick={() => setOpen((isOpen) => !isOpen)}
              >
                <ChevronRightIcon size={11} class={open() ? "rotate-90" : ""} />
              </button>
              <span>
                {label()}
                {brackets()[0]}
                <Show when={!open()}>
                  <button
                    type="button"
                    class="mx-1 rounded-xs bg-surface-2 px-1 text-fg-subtle hover:text-fg"
                    onClick={() => setOpen(true)}
                  >
                    {summary()}
                  </button>
                  {brackets()[1]}
                  {comma()}
                </Show>
              </span>
            </div>
            <Show when={open()}>
              <For each={entriesOf(value())}>
                {([key, child], index) => (
                  <JsonNode
                    name={Array.isArray(value()) ? undefined : key}
                    value={child}
                    depth={props.depth + 1}
                    last={index() === size() - 1}
                  />
                )}
              </For>
              <div class="-ml-4 pl-4">
                {brackets()[1]}
                {comma()}
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

/**
 * Collapsible JSON tree with a Raw view and Copy (pretty JSON), boxed as its own titled `Card`.
 * Deep nodes and large arrays or objects start collapsed with a size summary; the panel caps at
 * 480px with an Expand control.
 */
export const JsonViewer = (props: { data: unknown; title: string; label: string }) => {
  const [mode, setMode] = createSignal<"tree" | "raw">("tree");
  const [expanded, setExpanded] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);
  let scroller!: HTMLDivElement;

  onMount(() => {
    const observer = new ResizeObserver(() => {
      setOverflowing(scroller.scrollHeight > scroller.clientHeight + 1);
    });
    // The capped scroller keeps its size as content grows, so observe the content too.
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  return (
    <Card
      title={props.title}
      bodyClass=""
      actions={
        <>
          <div class="flex" role="group" aria-label={`${props.label} view`}>
            <For each={["tree", "raw"] as const}>
              {(option) => (
                <button
                  type="button"
                  class={`rounded-xs px-1.5 ${mode() === option ? "bg-fg text-bg" : "text-fg-muted hover:text-fg"}`}
                  aria-pressed={mode() === option}
                  onClick={() => setMode(option)}
                >
                  {option}
                </button>
              )}
            </For>
          </div>
          <CopyButton text={pretty(props.data)} label={`Copy ${props.label} as JSON`} />
        </>
      }
    >
      <div
        ref={(element) => {
          scroller = element;
        }}
        class={`overflow-auto px-4 py-2 font-mono text-xs leading-5 ${expanded() ? "" : "max-h-[480px]"}`}
      >
        <div>
          <Show
            when={mode() === "tree"}
            fallback={<pre class="whitespace-pre-wrap break-all">{pretty(props.data)}</pre>}
          >
            <JsonNode value={props.data} depth={0} last />
          </Show>
        </div>
      </div>
      <Show when={overflowing() || expanded()}>
        <button
          type="button"
          class="w-full border-t border-border py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
          onClick={() => setExpanded((isExpanded) => !isExpanded)}
        >
          {expanded() ? "Collapse" : "Expand"}
        </button>
      </Show>
    </Card>
  );
};
