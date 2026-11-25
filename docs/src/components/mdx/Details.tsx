import type { JSX } from "@solidjs/web";
import { Show, onSettled } from "solid-js";

const hashTarget = (): HTMLElement | null => {
  const id = decodeURIComponent(window.location.hash.slice(1));
  return id === "" ? null : document.getElementById(id);
};

export const Details = (props: {
  summary: JSX.Element;
  hint?: JSX.Element;
  children: JSX.Element;
}) => {
  let fold: HTMLDetailsElement | undefined;

  onSettled(() => {
    const reveal = () => {
      const target = hashTarget();
      if (target === null || fold === undefined || !fold.contains(target) || fold.open) return;
      fold.open = true;
      target.scrollIntoView();
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => {
      window.removeEventListener("hashchange", reveal);
    };
  });

  return (
    <details
      ref={(element: HTMLDetailsElement) => {
        fold = element;
      }}
      data-details
      class="group my-6 rounded-xs border border-border [&[open]>summary]:border-b [&[open]>summary]:border-border"
    >
      <summary class="flex cursor-pointer list-none items-baseline gap-3 px-4 py-2.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          class="shrink-0 font-mono text-xs text-fg-muted transition-transform group-open:rotate-90"
        >
          &#9656;
        </span>
        <span class="min-w-0 flex-1 text-[15px] font-medium text-fg">{props.summary}</span>
        <Show when={props.hint !== undefined}>
          <span class="shrink-0 font-mono text-xs text-fg-muted">{props.hint}</span>
        </Show>
      </summary>
      <div class="px-4 pt-3 pb-3 [&>*+*]:mt-3">{props.children}</div>
    </details>
  );
};
