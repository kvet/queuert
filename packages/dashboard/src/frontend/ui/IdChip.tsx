import { CheckIcon, CopyIcon, IdChip as BaseIdChip } from "@queuert/ui/components";
import { A } from "@solidjs/router";
import { Show, createSignal, onCleanup } from "solid-js";

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
        <CheckIcon size={13} class="text-accent-fg" />
      </Show>
    </button>
  );
};

export const IdChip = (props: { id: string; href?: string; prefix?: string; full?: boolean }) => (
  <BaseIdChip
    id={props.id}
    href={props.href}
    link={A}
    prefix={props.prefix}
    full={props.full}
    copy={<CopyButton text={props.id} label="Copy full ID" />}
  />
);
