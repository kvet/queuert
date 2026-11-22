import { type AnyStatus, statusClasses } from "../lib/status.ts";

export const StatusDot = (props: { status: AnyStatus; label?: string; class?: string }) => (
  <span
    class={[
      "inline-block size-2 shrink-0 rounded-xs",
      statusClasses[props.status].dot,
      { "animate-pulse-ring": props.status === "running" },
      props.class,
    ]}
    role={props.label ? "img" : undefined}
    aria-label={props.label}
    aria-hidden={props.label ? undefined : "true"}
  />
);

export const StatusPill = (props: { status: AnyStatus }) => (
  <span
    class={[
      "inline-flex shrink-0 items-center gap-1.5 rounded-xs px-2 py-0.5 font-mono text-xs font-medium",
      statusClasses[props.status].pill,
    ]}
  >
    <StatusDot status={props.status} />
    {props.status}
  </span>
);
