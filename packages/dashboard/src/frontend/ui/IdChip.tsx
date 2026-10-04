import { A } from "@solidjs/router";
import { Show, createSignal, onCleanup } from "solid-js";

import { shortId } from "../domain/ids.js";
import { CheckIcon, CopyIcon } from "./icons.js";

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export const CopyButton = (props: { text: string; label: string; class?: string }) => {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(timer);
  });

  return (
    <button
      type="button"
      class={`relative z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-subtle hover:bg-surface-2 hover:text-fg ${props.class ?? ""}`}
      title={copied() ? "Copied" : props.label}
      aria-label={props.label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyText(props.text).then((succeeded) => {
          if (!succeeded) return;
          setCopied(true);
          clearTimeout(timer);
          timer = setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Show when={copied()} fallback={<CopyIcon size={13} />}>
        <CheckIcon size={13} class="text-status-completed-fg" />
      </Show>
    </button>
  );
};

/**
 * Mono short ID with the full ID in `title` and a copy button that copies the full ID. As a link,
 * the chip itself is the link and the copy button is a sibling, so it never triggers navigation.
 */
export const IdChip = (props: { id: string; href?: string; prefix?: string; full?: boolean }) => {
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
          <A
            href={href()}
            class={`${chipClass} relative z-10 hover:text-accent-fg hover:underline`}
            title={props.id}
          >
            {text()}
          </A>
        )}
      </Show>
      <CopyButton text={props.id} label="Copy full ID" />
    </span>
  );
};
