import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import type { AnyStatus } from "../lib/status.ts";
import { StatusDot } from "./StatusPill.tsx";

const chipTones = {
  default: "border-border text-fg-muted",
  strong: "border-border-strong text-fg",
  accent: "border-accent/40 text-accent-fg",
  caution: "border-status-pending-dot/50 text-status-pending-fg",
  danger: "border-error-border text-error-fg",
} as const;

export type ChipTone = keyof typeof chipTones;

export const Chip = (props: {
  tone?: ChipTone;
  status?: AnyStatus;
  statusLabel?: string;
  mono?: boolean;
  href?: string;
  title?: string;
  class?: string;
  children: JSX.Element;
}) => {
  const classes = () => [
    "inline-flex max-w-full items-center gap-1.5 rounded-xs border px-2 py-0.5 text-xs",
    chipTones[props.tone ?? "default"],
    { "font-mono": props.mono === true },
    props.class,
  ];
  const content = () => (
    <>
      <Show when={props.status}>
        {(status) => <StatusDot status={status()} label={props.statusLabel} />}
      </Show>
      {props.children}
    </>
  );
  return (
    <Show
      when={props.href}
      fallback={
        <span class={classes()} title={props.title}>
          {content()}
        </span>
      }
    >
      {(href) => (
        <a
          href={href()}
          class={["relative z-10 hover:border-border-strong", classes()]}
          title={props.title}
        >
          {content()}
        </a>
      )}
    </Show>
  );
};
