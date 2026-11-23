import { Box, ChevronRightIcon, ChoiceChips } from "@queuert/ui/components";
import { For, Match, Show, Switch, createSignal, onSettled } from "solid-js";

import { CopyButton } from "./IdChip.tsx";

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
  const [open, setOpen] = createSignal(
    () => props.depth < COLLAPSE_DEPTH && size() <= COLLAPSE_SIZE,
  );
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
                aria-expanded={open() ? "true" : "false"}
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

export const JsonViewer = (props: { data: unknown; title: string; label: string }) => {
  const [mode, setMode] = createSignal<"tree" | "raw">("tree");
  const [expanded, setExpanded] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);
  let scroller!: HTMLDivElement;

  onSettled(() => {
    const observer = new ResizeObserver(() => {
      setOverflowing(scroller.scrollHeight > scroller.clientHeight + 1);
    });
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => {
      observer.disconnect();
    };
  });

  return (
    <Box
      title={props.title}
      bodyClass=""
      actions={
        <>
          <ChoiceChips
            label={`${props.label} view`}
            variant="segment"
            options={[
              { value: "tree", label: "tree" },
              { value: "raw", label: "raw" },
            ]}
            value={mode()}
            onChange={setMode}
          />
          <CopyButton text={pretty(props.data)} label={`Copy ${props.label} as JSON`} />
        </>
      }
    >
      <div
        ref={(element) => {
          scroller = element;
        }}
        class={[
          "overflow-auto px-4 py-2 font-mono text-xs leading-5",
          { "max-h-[480px]": !expanded() },
        ]}
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
    </Box>
  );
};
