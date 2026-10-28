import { type JSX, Show, children, splitProps } from "solid-js";

const borderTones = {
  default: "border-border",
  note: "border-status-running-dot/50",
  tip: "border-status-blocked-dot/50",
  caution: "border-status-pending-dot/50",
  danger: "border-error-border",
} as const;

const titleTones = {
  default: "text-fg-muted",
  note: "text-status-running-fg",
  tip: "text-status-blocked-fg",
  caution: "text-status-pending-fg",
  danger: "text-error-fg",
} as const;

export type BoxTone = keyof typeof borderTones;

export const Box = (props: {
  title?: JSX.Element;
  actions?: JSX.Element;
  tone?: BoxTone;
  class?: string;
  bodyClass?: string;
  children: JSX.Element;
  [data: `data-${string}`]: string | undefined;
}) => {
  const [, dataAttributes] = splitProps(props, [
    "title",
    "actions",
    "tone",
    "class",
    "bodyClass",
    "children",
  ]);
  const tone = () => props.tone ?? "default";
  const title = children(() => props.title);
  const actions = children(() => props.actions);
  return (
    <section
      {...dataAttributes}
      class={`relative rounded-xs border ${borderTones[tone()]} ${title() ? "pt-2" : ""} ${props.class ?? ""}`}
    >
      <Show when={title() !== undefined || actions() !== undefined}>
        <header
          data-box-header
          class="absolute inset-x-3 top-0 flex -translate-y-1/2 items-center justify-between gap-3"
        >
          <h2
            class={`m-0 min-w-0 truncate bg-bg px-1.5 font-mono text-xs font-semibold tracking-wider uppercase ${titleTones[tone()]}`}
          >
            {title()}
          </h2>
          <Show when={actions()}>
            <div class="m-0 flex shrink-0 items-center gap-1 bg-bg px-1 text-xs">{actions()}</div>
          </Show>
        </header>
      </Show>
      <div class={props.bodyClass ?? "p-4"}>{props.children}</div>
    </section>
  );
};
