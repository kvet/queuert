import { Box } from "@queuert/ui/components";
import { type JSX } from "solid-js";

import { ArrowRightIcon } from "../icons.tsx";

export const CardGrid = (props: { children: JSX.Element }) => (
  <div class="my-8 grid gap-x-4 gap-y-6 sm:grid-cols-2">{props.children}</div>
);

export const Card = (props: { title: string; children: JSX.Element }) => (
  <Box title={props.title} class="mt-0!" bodyClass="px-4 pt-3 pb-4 text-fg-muted">
    {props.children}
  </Box>
);

export const LinkCard = (props: { title: string; href: string; description?: string }) => (
  <a
    href={props.href}
    class="unstyled group mt-0! flex items-start justify-between gap-4 rounded-xs border border-border px-4 py-3 no-underline hover:border-border-strong hover:bg-surface"
  >
    <span class="flex flex-col gap-1">
      <span class="font-semibold text-fg group-hover:text-accent-fg">{props.title}</span>
      <span class="text-[13px] text-fg-muted">{props.description}</span>
    </span>
    <ArrowRightIcon
      size={14}
      class="mt-1 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent-fg"
    />
  </a>
);
