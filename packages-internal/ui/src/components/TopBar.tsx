import { type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { type LinkComponent } from "./Row.js";

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

export const TopBarNavLink = (props: {
  href: string;
  active: boolean;
  link?: LinkComponent;
  children: JSX.Element;
}) => (
  <Dynamic
    component={props.link ?? "a"}
    href={props.href}
    class="relative rounded-xs px-2.5 py-1.5 text-sm text-fg-muted hover:text-fg data-active:text-fg"
    data-active={props.active ? "" : undefined}
    aria-current={props.active ? "page" : undefined}
  >
    {props.children}
    <Show when={props.active}>
      <span class="absolute inset-x-2.5 -bottom-2.75 h-px bg-brand" aria-hidden="true" />
    </Show>
  </Dynamic>
);
