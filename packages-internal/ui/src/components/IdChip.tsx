import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { shortId } from "../lib/ids.ts";

const chipClass =
  "min-w-0 truncate rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg-muted";

export const IdChip = (props: {
  id: string;
  href?: string;
  prefix?: string;
  full?: boolean;
  copy?: JSX.Element;
}) => {
  const text = () =>
    `${props.prefix ? `${props.prefix} ` : ""}${props.full ? props.id : shortId(props.id)}`;

  return (
    <span class={["inline-flex items-center gap-0.5", props.full ? "min-w-0" : "shrink-0"]}>
      <Show
        when={props.href}
        fallback={
          <span class={chipClass} title={props.id}>
            {text()}
          </span>
        }
      >
        {(href) => (
          <a
            href={href()}
            class={[chipClass, "relative z-10 hover:text-accent-fg hover:underline"]}
            title={props.id}
          >
            {text()}
          </a>
        )}
      </Show>
      {props.copy}
    </span>
  );
};
