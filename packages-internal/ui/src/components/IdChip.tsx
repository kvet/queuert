import { type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { shortId } from "../lib/ids.js";
import { type LinkComponent } from "./Row.js";

export const IdChip = (props: {
  id: string;
  href?: string;
  link?: LinkComponent;
  prefix?: string;
  full?: boolean;
  copy?: JSX.Element;
}) => {
  const text = () =>
    `${props.prefix ? `${props.prefix} ` : ""}${props.full ? props.id : shortId(props.id)}`;
  const chipClass =
    "min-w-0 truncate rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg-muted";

  return (
    <span class={`inline-flex items-center gap-0.5 ${props.full ? "min-w-0" : "shrink-0"}`}>
      <Show
        when={props.href}
        fallback={
          <span class={chipClass} title={props.id}>
            {text()}
          </span>
        }
      >
        {(href) => (
          <Dynamic
            component={props.link ?? "a"}
            href={href()}
            class={`${chipClass} relative z-10 hover:text-accent-fg hover:underline`}
            title={props.id}
          >
            {text()}
          </Dynamic>
        )}
      </Show>
      {props.copy}
    </span>
  );
};
