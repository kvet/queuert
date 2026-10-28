import { type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

export type LinkComponent = (props: {
  href: string;
  class?: string;
  title?: string;
  "aria-label"?: string;
  "aria-current"?: "page";
  "data-active"?: "";
  children?: JSX.Element;
}) => JSX.Element;

export const rowClass =
  "relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2 hover:bg-surface-2/50";

export const RowLink = (props: { href: string; label: string; link?: LinkComponent }) => (
  <Dynamic
    component={props.link ?? "a"}
    href={props.href}
    class="absolute inset-0 rounded-[inherit] focus-visible:outline-offset-[-2px]"
    aria-label={props.label}
  />
);

export const Row = (props: {
  href?: string;
  label?: string;
  link?: LinkComponent;
  id?: string;
  class?: string;
  children: JSX.Element;
}) => (
  <li id={props.id} class={`${rowClass} ${props.class ?? ""}`}>
    <Show when={props.href}>
      {(href) => <RowLink href={href()} label={props.label ?? href()} link={props.link} />}
    </Show>
    {props.children}
  </li>
);

const subLineTones = {
  subtle: "text-fg-subtle",
  muted: "text-fg-muted",
} as const;

export const SubLine = (props: {
  tone?: keyof typeof subLineTones;
  class?: string;
  children: JSX.Element;
}) => (
  <div
    class={`col-span-2 min-w-0 text-xs ${subLineTones[props.tone ?? "subtle"]} ${props.class ?? ""}`}
  >
    {props.children}
  </div>
);
