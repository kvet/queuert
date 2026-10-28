import { CheckIcon, CopyIcon } from "@queuert/ui/components";
import { Show, createSignal, onCleanup } from "solid-js";

export const CopyButton = (props: { text: string; label?: string; class?: string }) => {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(timer);
  });

  return (
    <button
      type="button"
      class={`inline-flex items-center gap-1 rounded-xs px-1 text-fg-subtle hover:text-fg ${props.class ?? ""}`}
      aria-label={copied() ? "Copied" : (props.label ?? "Copy")}
      title={copied() ? "Copied" : (props.label ?? "Copy")}
      onClick={() => {
        void navigator.clipboard.writeText(props.text).then(() => {
          setCopied(true);
          clearTimeout(timer);
          timer = setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Show when={copied()} fallback={<CopyIcon size={13} />}>
        <CheckIcon size={13} class="text-status-running-dot" />
      </Show>
    </button>
  );
};
