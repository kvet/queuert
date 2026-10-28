import { Box } from "@queuert/ui/components";
import { type JSX, Show } from "solid-js";

export const ApiFields = (props: { title?: string; children: JSX.Element }) => (
  <Box title={props.title} class="api-box my-5" bodyClass="">
    <ul class="api-fields divide-y divide-border">{props.children}</ul>
  </Box>
);

export const ApiField = (props: {
  name: string;
  id?: string;
  parent?: string;
  optional?: string;
  children?: JSX.Element;
}) => {
  const depth = () => (props.parent === undefined ? 0 : props.parent.split(".").length - 1);
  return (
    <li
      id={props.id}
      class="api-field flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 pr-4"
      style={{ "padding-left": `${1 + depth() * 1.25}rem` }}
    >
      <div class="font-mono font-medium whitespace-nowrap text-fg">
        <Show when={props.parent}>
          <span class="font-normal text-fg-subtle">{props.parent}</span>
        </Show>
        {props.name}
        <Show when={props.optional}>
          <span class="font-normal text-fg-subtle" title="Optional">
            ?
          </span>
        </Show>
      </div>
      {props.children}
    </li>
  );
};

export const ApiFieldType = (props: { children: JSX.Element }) => (
  <div class="api-field-type min-w-0 flex-1 basis-48 text-[13px] text-fg-muted">
    {props.children}
  </div>
);

export const ApiFieldDefault = (props: { children: JSX.Element }) => (
  <div class="api-field-default inline-block max-w-full rounded-xs border border-border px-2 py-0.5 text-xs text-fg-muted">
    <span class="mr-1.5 text-fg-subtle">default</span>
    {props.children}
  </div>
);

export const ApiFieldDescription = (props: { children: JSX.Element }) => (
  <div class="api-field-description basis-full text-[13px] leading-6 text-fg-muted">
    {props.children}
  </div>
);

export const ApiSection = (props: { title?: string; variant?: string; children: JSX.Element }) => (
  <Box
    title={props.title}
    class={`api-box my-5 ${props.variant === "type" ? "api-type-section" : "api-section"}`}
    bodyClass="px-4 py-3"
  >
    {props.children}
  </Box>
);
