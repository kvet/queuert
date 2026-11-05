import { Box, Chip, type ChipTone } from "@queuert/ui/components";
import { A } from "@solidjs/router";
import { For, type JSX, Show } from "solid-js";

export type OptionCard = {
  name: string;
  status?: { label: string; tone: ChipTone };
  pick: JSX.Element;
  facts: { label: string; value: string }[];
  action: { label: string; href: string };
};

/**
 * One box per option (a backend, driver or ORM): when to pick it, then the same facts on every
 * card, then where to go next. An odd last card spans both columns.
 */
export const OptionCards = (props: { items: OptionCard[] }) => (
  <div class="my-8 grid gap-x-4 gap-y-6 sm:grid-cols-2">
    <For each={props.items}>
      {(option, index) => (
        <Box
          title={option.name}
          actions={
            <Show when={option.status}>
              {(status) => <Chip tone={status().tone}>{status().label}</Chip>}
            </Show>
          }
          class={`flex flex-col ${
            props.items.length % 2 === 1 && index() === props.items.length - 1
              ? "sm:col-span-2"
              : ""
          }`}
          bodyClass="flex flex-1 flex-col"
        >
          <p class="m-0 px-4 pt-3 pb-3 text-[13px] leading-5 text-fg-muted">{option.pick}</p>
          <ul class="row-list m-0 flex-1 border-t border-dashed border-border px-4 py-2">
            <For each={option.facts}>
              {(fact) => (
                <li class="flex items-baseline justify-between gap-3 py-1 text-[13px] leading-5">
                  <span class="shrink-0 text-fg-subtle">{fact.label}</span>
                  <span class="min-w-0 text-right font-mono text-xs wrap-break-word text-fg">
                    {fact.value}
                  </span>
                </li>
              )}
            </For>
          </ul>
          <div class="border-t border-border px-4 py-2 text-[13px]">
            <A href={option.action.href} class="unstyled text-accent-fg hover:underline">
              {option.action.label} →
            </A>
          </div>
        </Box>
      )}
    </For>
  </div>
);
