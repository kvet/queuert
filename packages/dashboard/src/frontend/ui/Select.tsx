import { ChevronDownIcon } from "@queuert/ui/components";
import { For, Show } from "solid-js";

const variantClass = {
  field: "border border-border-strong bg-surface pl-2.5 text-fg hover:bg-surface-2",
  ghost: "pl-2 text-fg-muted hover:bg-surface-2 hover:text-fg",
} as const;

const heightClass = { sm: "h-8", md: "h-9", fill: "h-full" } as const;

export const Select = <TValue extends string>(props: {
  label: string;
  value: TValue | undefined;
  options: readonly { value: TValue; label: string }[];
  onChange: (value: TValue) => void;
  placeholder?: string;
  variant?: keyof typeof variantClass;
  height?: keyof typeof heightClass;
  class?: string;
}) => (
  <span
    class={`select-wrap relative inline-flex min-w-0 items-center ${props.height === "fill" ? "h-full" : ""}`}
  >
    <select
      class={`select max-w-full min-w-0 cursor-pointer truncate rounded-xs pr-7 text-sm ${
        variantClass[props.variant ?? "field"]
      } ${heightClass[props.height ?? "sm"]} ${props.class ?? ""}`}
      aria-label={props.label}
      onChange={(event) => {
        props.onChange(event.currentTarget.value as TValue);
      }}
    >
      <Show when={props.placeholder}>
        {(placeholder) => (
          <option value="" disabled hidden selected>
            {placeholder()}
          </option>
        )}
      </Show>
      <For each={props.options}>
        {(option) => (
          <option
            value={option.value}
            selected={!props.placeholder && option.value === props.value}
          >
            {option.label}
          </option>
        )}
      </For>
    </select>
    <ChevronDownIcon
      size={14}
      class="select-chevron pointer-events-none absolute right-2 text-fg-muted"
    />
  </span>
);
