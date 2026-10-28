const variants = {
  note: "bg-status-running-bg text-status-running-fg",
  tip: "bg-status-blocked-bg text-status-blocked-fg",
  caution: "bg-status-pending-bg text-status-pending-fg",
  danger: "bg-error-bg text-error-fg",
  default: "bg-status-completed-bg text-status-completed-fg",
} as const;

export const Badge = (props: { text: string; variant?: keyof typeof variants }) => (
  <span
    data-badge
    class={`inline-flex items-center rounded-xs px-1.5 py-px align-[1px] text-xs font-medium ${variants[props.variant ?? "default"]}`}
  >
    {props.text}
  </span>
);
