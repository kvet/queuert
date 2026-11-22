import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

export const iconButtonClass =
  "inline-flex size-8 items-center justify-center rounded-xs text-fg-muted hover:bg-surface-2 hover:text-fg";

export const TopBarFrame = (props: { below?: JSX.Element; children: JSX.Element }) => (
  <header class="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-md">
    <div class="mx-auto flex h-14 max-w-360 items-center gap-1 px-4 sm:gap-2 sm:px-6">
      {props.children}
    </div>
    {props.below}
  </header>
);

export const TopBarNavLink = (props: { href: string; active: boolean; children: JSX.Element }) => (
  <a
    href={props.href}
    class={[
      "relative rounded-xs px-2.5 py-1.5 text-sm hover:text-fg",
      props.active ? "text-fg" : "text-fg-muted",
    ]}
    aria-current={props.active ? "page" : undefined}
  >
    {props.children}
    <Show when={props.active}>
      <span class="absolute inset-x-2.5 -bottom-2.75 h-px bg-brand" aria-hidden="true" />
    </Show>
  </a>
);
