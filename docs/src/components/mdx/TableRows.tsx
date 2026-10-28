import { Box } from "@queuert/ui/components";
import { type JSX, Show } from "solid-js";

export const TableRows = (props: { columns: string; children: JSX.Element }) => (
  <Box class="my-6" bodyClass="" data-table-rows={props.columns}>
    <ul class="row-list divide-y divide-border">{props.children}</ul>
  </Box>
);

export const TableRow = (props: { children: JSX.Element }) => (
  <li class="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-2 text-[13px] leading-6">
    {props.children}
  </li>
);

export const TableCell = (props: {
  label: string;
  role: "name" | "field" | "description";
  children?: JSX.Element;
}) => (
  <Show
    when={props.role !== "name"}
    fallback={<div class="font-medium text-fg [&_code]:whitespace-nowrap">{props.children}</div>}
  >
    <div
      class={`min-w-0 text-fg-muted [&_code]:text-xs ${props.role === "description" ? "basis-full" : ""}`}
    >
      <Show when={props.role === "field"}>
        <span class="mr-2 font-mono text-[11px] tracking-wider text-fg-subtle uppercase">
          {props.label}
        </span>
      </Show>
      {props.children}
    </div>
  </Show>
);
