import { Box } from "@queuert/ui/components";
import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { siteHref } from "../../docs/href.ts";

/**
 * The first block of an adapter page: the package, the clients it supports, how it isolates
 * concurrent work, and the notify adapters that pair with it.
 */
export const AtAGlance = (props: {
  package: string;
  clients: string;
  isolation: JSX.Element;
  isolationLabel?: string;
  pairsWith: { label: string; href: string }[];
}) => (
  <Box title="At a glance" class="my-6">
    <dl class="row-list m-0 px-4 py-2">
      <div class="flex flex-col gap-0.5 py-1.5 text-[13px] leading-5 sm:flex-row sm:items-baseline sm:gap-4">
        <dt class="w-28 shrink-0 text-fg-subtle">Package</dt>
        <dd class="m-0 min-w-0 font-mono text-xs wrap-break-word text-fg">{props.package}</dd>
      </div>
      <div class="flex flex-col gap-0.5 py-1.5 text-[13px] leading-5 sm:flex-row sm:items-baseline sm:gap-4">
        <dt class="w-28 shrink-0 text-fg-subtle">Clients</dt>
        <dd class="m-0 min-w-0 text-fg">{props.clients}</dd>
      </div>
      <div class="flex flex-col gap-0.5 py-1.5 text-[13px] leading-5 sm:flex-row sm:items-baseline sm:gap-4">
        <dt class="w-28 shrink-0 text-fg-subtle">{props.isolationLabel ?? "Isolation"}</dt>
        <dd class="m-0 min-w-0 text-fg">{props.isolation}</dd>
      </div>
      <div class="flex flex-col gap-0.5 py-1.5 text-[13px] leading-5 sm:flex-row sm:items-baseline sm:gap-4">
        <dt class="w-28 shrink-0 text-fg-subtle">Pairs with</dt>
        <dd class="m-0 min-w-0 text-fg">
          <For each={props.pairsWith}>
            {(item, index) => (
              <>
                {index() > 0 ? " · " : ""}
                <a href={siteHref(item.href)}>{item.label}</a>
              </>
            )}
          </For>
        </dd>
      </div>
    </dl>
  </Box>
);
