import type { JSX } from "@solidjs/web";
import { Show, createSignal, onSettled } from "solid-js";

const collapsedLines = 14;

export const CappedCode = (props: { children: JSX.Element }) => {
  let root: HTMLDivElement | undefined;
  const [lines, setLines] = createSignal(0);
  const [expanded, setExpanded] = createSignal(false);

  onSettled(() => {
    setLines(root?.querySelectorAll(".line").length ?? 0);
  });

  return (
    <div
      ref={(element: HTMLDivElement) => {
        root = element;
      }}
      class={expanded() ? "" : "[&_pre]:max-h-[22.5rem]"}
    >
      {props.children}
      <Show when={lines() > collapsedLines}>
        <button
          type="button"
          class="-mt-3 mb-5 cursor-pointer border-0 bg-transparent p-0 text-xs text-accent-fg hover:underline"
          aria-expanded={expanded() ? "true" : "false"}
          onClick={() => {
            setExpanded(!expanded());
          }}
        >
          {expanded() ? "Show fewer lines" : `Show all ${lines()} lines`}
        </button>
      </Show>
    </div>
  );
};
