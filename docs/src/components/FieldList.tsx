import { Box, Chip, type ChipTone, Row, SubLine } from "@queuert/ui/components";
import { For, type JSX, Show } from "solid-js";

type FieldChip = string | { label: JSX.Element; tone?: ChipTone; mono?: boolean };

export type FieldItem = {
  name: string;
  id?: string;
  chips?: FieldChip[];
  meta?: JSX.Element;
  description: JSX.Element;
  extra?: string[] | { code: string };
};

const FieldChips = (props: { chips: FieldChip[] }) => (
  <For each={props.chips}>
    {(chip) =>
      typeof chip === "string" ? (
        <>
          {" "}
          <Chip>{chip}</Chip>
        </>
      ) : (
        <>
          {" "}
          <Chip tone={chip.tone} mono={chip.mono}>
            {chip.label}
          </Chip>
        </>
      )
    }
  </For>
);

const FieldRow = (props: { item: FieldItem; idPrefix?: string }) => {
  const id = () =>
    props.item.id ??
    (props.idPrefix === undefined ? undefined : `${props.idPrefix}-${props.item.name}`);
  const extra = () => props.item.extra;
  return (
    <Row id={id()} class="scroll-mt-20">
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-6">
        <Show
          when={id()}
          fallback={<span class="font-medium break-all text-fg">{props.item.name}</span>}
        >
          {(anchor) => (
            <a
              href={`#${anchor()}`}
              class="unstyled font-medium break-all text-fg no-underline hover:text-accent-fg"
            >
              {props.item.name}
            </a>
          )}
        </Show>
        <Show when={props.item.chips}>{(chips) => <FieldChips chips={chips()} />}</Show>
      </div>
      <div class="text-xs text-fg-subtle">{props.item.meta}</div>
      <SubLine tone="muted" class="leading-5 [&_code]:text-xs">
        {props.item.description}
      </SubLine>
      <Show when={extra()}>
        {(value) => {
          const current = value();
          return Array.isArray(current) ? (
            <SubLine class="flex flex-wrap gap-1.5 pt-0.5">
              <For each={current}>
                {(label) => (
                  <>
                    {" "}
                    <Chip mono>{label}</Chip>
                  </>
                )}
              </For>
            </SubLine>
          ) : (
            <SubLine class="pt-0.5">
              <code class="wrap-break-word text-xs">{current.code}</code>
            </SubLine>
          );
        }}
      </Show>
    </Row>
  );
};

export const FieldList = (props: {
  title?: JSX.Element;
  actions?: JSX.Element;
  items: FieldItem[];
  idPrefix?: string;
  class?: string;
}) => (
  <Box title={props.title} actions={props.actions} class={`my-6 ${props.class ?? ""}`} bodyClass="">
    <ul class="row-list divide-y divide-border">
      <For each={props.items}>{(item) => <FieldRow item={item} idPrefix={props.idPrefix} />}</For>
    </ul>
  </Box>
);
