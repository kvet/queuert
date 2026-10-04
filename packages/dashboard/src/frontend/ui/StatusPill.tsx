import { type AnyStatus, statusClasses } from "./status.js";

/**
 * A status dot. Always pair it with text (or give it a label) — colour alone never carries status.
 */
export const StatusDot = (props: { status: AnyStatus; label?: string; class?: string }) => {
  return (
    <span
      class={`inline-block size-2 shrink-0 rounded-xs ${statusClasses[props.status].dot} ${
        props.status === "running" ? "animate-pulse-ring" : ""
      } ${props.class ?? ""}`}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    />
  );
};

export const StatusPill = (props: { status: AnyStatus }) => {
  return (
    <span
      class={`inline-flex shrink-0 items-center gap-1.5 rounded-xs px-2 py-0.5 text-xs font-medium ${statusClasses[props.status].pill}`}
    >
      <StatusDot status={props.status} />
      {props.status}
    </span>
  );
};
