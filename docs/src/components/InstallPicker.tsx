import { Box, Chip, ChoiceChips, ToggleChips } from "@queuert/ui/components";
import type { JSX } from "@solidjs/web";
import { For, Show, createSignal } from "solid-js";

import {
  type InstallOption,
  extraInstallOptions,
  installCommand,
  packageManagers,
  stateInstallOptions,
} from "../data/installation.tsx";
import { Code } from "./mdx/Code.tsx";
import { createSyncedTabs, selectSyncedTab } from "./mdx/Tabs.tsx";

/** One pick per option; the synced tab store keeps it across pages and visits. */
const Choice = (props: {
  label: string;
  options: { label: string; experimental?: () => JSX.Element }[];
  selected: string;
  onSelect: (label: string) => void;
}) => (
  <ChoiceChips
    label={props.label}
    options={props.options.map((option) => ({
      value: option.label,
      label: option.label,
      badge: option.experimental === undefined ? undefined : "exp",
    }))}
    value={props.selected}
    onChange={props.onSelect}
  />
);

const Field = (props: { label: string; children: JSX.Element }) => (
  <div class="flex flex-col gap-2 py-3 [&+&]:border-t [&+&]:border-border">
    <div class="font-mono text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
      {props.label}
    </div>
    {props.children}
  </div>
);

/**
 * Every option's note stays in the page (hidden unless picked) so search and `llms-full.txt`
 * still carry all of them.
 */
const Notes = (props: { options: InstallOption[]; selected: InstallOption }) => (
  <For each={props.options}>
    {(option) => (
      <div hidden={option !== props.selected} class="text-[13px] leading-6 text-fg-muted">
        <p class="m-0">{option.note()}</p>
        <Show when={option.experimental !== undefined}>
          <p class="m-0 mt-1 flex flex-wrap items-center gap-1.5">
            <Chip mono>Experimental</Chip>
            <span>
              {option.experimental?.()} is experimental: its API may change in a minor release.
            </span>
          </p>
        </Show>
      </div>
    )}
  </For>
);

const allNotifyOptions = [...new Set(stateInstallOptions.flatMap((state) => state.notify))];

const pick = <T extends { label: string }>(options: T[], label: string | undefined): T =>
  options.find((option) => option.label === label) ?? options[0];

/** Highlights the command the way Shiki's bash grammar does: the program, then string words. */
const commandHtml = (command: string) => {
  const [manager, ...words] = command.split(" ");
  return `<pre class="shiki queuert" style="background-color:var(--shiki-background);color:var(--shiki-foreground)"><code><span class="line"><span style="color:var(--shiki-token-function)">${manager}</span>${words
    .map((word) => `<span style="color:var(--shiki-token-string)"> ${word}</span>`)
    .join("")}</span></code></pre>`;
};

/** Builds the single install command for the reader's state adapter, notify adapter and extras. */
export const InstallPicker = () => {
  const picked = createSyncedTabs();
  const state = () => pick(stateInstallOptions, picked("state"));
  const notify = () => pick(state().notify, picked("notify"));
  const manager = () => pick(packageManagers, picked("pkg"));
  const [extras, setExtras] = createSignal<string[]>([]);

  const command = () =>
    installCommand(manager().install, [
      ...state().packages,
      ...notify().packages,
      ...extraInstallOptions
        .filter((extra) => extras().includes(extra.label))
        .flatMap((extra) => extra.packages),
    ]);

  return (
    <>
      <Box title="Your stack" class="my-6" bodyClass="px-4">
        <Field label="State adapter">
          <Choice
            label="State adapter"
            options={stateInstallOptions}
            selected={state().label}
            onSelect={(label) => {
              selectSyncedTab("state", label);
            }}
          />
          <Notes options={stateInstallOptions} selected={state()} />
        </Field>
        <Field label="Notify adapter (optional, for reduced latency)">
          <Choice
            label="Notify adapter"
            options={state().notify}
            selected={notify().label}
            onSelect={(label) => {
              selectSyncedTab("notify", label);
            }}
          />
          <Notes options={allNotifyOptions} selected={notify()} />
        </Field>
        <Field label="Extras (optional)">
          <ToggleChips
            label="Extras"
            options={extraInstallOptions.map((extra) => ({
              value: extra.label,
              label: extra.label,
              title: extra.note,
            }))}
            value={extras()}
            onChange={setExtras}
          />
          <p class="m-0 text-[13px] leading-6 text-fg-muted">
            <For each={extraInstallOptions}>
              {(extra, index) => (
                <>
                  {index() > 0 ? "; " : ""}
                  <code>{extra.packages[0]}</code>: {extra.note}
                </>
              )}
            </For>
            . Covered in <a href="/queuert/integrations/observability/">Observability</a>.
          </p>
        </Field>
        <Field label="Package manager">
          <Choice
            label="Package manager"
            options={packageManagers}
            selected={manager().label}
            onSelect={(label) => {
              selectSyncedTab("pkg", label);
            }}
          />
        </Field>
      </Box>
      <Code lang="bash" code={command()} html={commandHtml(command())} />
    </>
  );
};
