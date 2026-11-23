import { ToggleGroup } from "@kobalte/core/toggle-group";
import { For, Show } from "solid-js";

const variants = {
  chip: {
    group: "flex flex-wrap gap-1.5",
    item: "rounded-xs border border-border px-2 py-0.5 text-xs text-fg-muted hover:border-border-strong hover:text-fg data-pressed:border-fg data-pressed:bg-fg data-pressed:text-bg",
  },
  segment: {
    group: "flex",
    item: "rounded-xs px-1.5 text-fg-muted hover:text-fg data-pressed:bg-fg data-pressed:text-bg",
  },
} as const;

type ToggleChipOption = { value: string; label: string; badge?: string; title?: string };

const Items = (props: { options: readonly ToggleChipOption[]; variant: keyof typeof variants }) => (
  <For each={props.options} keyed={(option) => option.value}>
    {(option) => (
      <ToggleGroup.Item
        value={option().value}
        title={option().title}
        class={variants[props.variant].item}
      >
        {option().label}
        <Show when={option().badge}>
          {(badge) => (
            <span class="ml-1.5 font-mono text-[10px] tracking-wider uppercase opacity-70">
              {badge()}
            </span>
          )}
        </Show>
      </ToggleGroup.Item>
    )}
  </For>
);

/** Buttons that pick exactly one option; arrow keys move between them. */
export const ChoiceChips = <TValue extends string>(props: {
  label: string;
  options: readonly (ToggleChipOption & { value: TValue })[];
  value: TValue;
  onChange: (value: TValue) => void;
  variant?: keyof typeof variants;
}) => (
  <ToggleGroup
    class={variants[props.variant ?? "chip"].group}
    aria-label={props.label}
    value={props.value}
    onChange={(value) => {
      if (value !== null) props.onChange(value as TValue);
    }}
  >
    <Items options={props.options} variant={props.variant ?? "chip"} />
  </ToggleGroup>
);

/** Buttons that each switch an option on or off; arrow keys move between them. */
export const ToggleChips = <TValue extends string>(props: {
  label: string;
  options: readonly (ToggleChipOption & { value: TValue })[];
  value: readonly TValue[];
  onChange: (value: TValue[]) => void;
  variant?: keyof typeof variants;
}) => (
  <ToggleGroup
    multiple
    class={variants[props.variant ?? "chip"].group}
    aria-label={props.label}
    value={[...props.value]}
    onChange={(value) => {
      props.onChange(value as TValue[]);
    }}
  >
    <Items options={props.options} variant={props.variant ?? "chip"} />
  </ToggleGroup>
);
