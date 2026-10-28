import { Box, Row, SubLine } from "@queuert/ui/components";
import { For, type JSX, Show } from "solid-js";

import { siteLink } from "./siteLink.ts";

export type KeyValueItem = {
  label: JSX.Element;
  value: JSX.Element;
  note?: JSX.Element;
  href?: string;
};

export const KeyValueList = (props: {
  title?: JSX.Element;
  actions?: JSX.Element;
  items: KeyValueItem[];
  class?: string;
}) => (
  <Box title={props.title} actions={props.actions} class={`my-6 ${props.class ?? ""}`} bodyClass="">
    <ul class="row-list divide-y divide-border">
      <For each={props.items}>
        {(item) => (
          <Row
            href={item.href}
            label={item.href === undefined ? undefined : `Go to ${item.href}`}
            link={item.href === undefined ? undefined : siteLink(item.href)}
            class="leading-6"
          >
            <div class="min-w-0 text-fg-muted">{item.label}</div>
            <div
              class={`max-w-[60vw] justify-self-end text-right font-medium wrap-break-word sm:max-w-sm ${
                item.href === undefined ? "text-fg" : "text-accent-fg"
              }`}
            >
              {item.value}
            </div>
            <Show when={item.note}>
              <SubLine tone="muted" class="leading-5 [&_code]:text-xs">
                {item.note}
              </SubLine>
            </Show>
          </Row>
        )}
      </For>
    </ul>
  </Box>
);
