import { Box, Chip } from "@queuert/ui/components";
import { For, type JSX, Show, createSignal } from "solid-js";

import {
  type InstallOption,
  extraInstallOptions,
  installCommand,
  packageManagers,
  stateInstallOptions,
} from "../data/installation.tsx";
import { Code } from "./mdx/Code.tsx";
import { selectSyncedTab, syncedTab } from "./mdx/Tabs.tsx";

/** One pick per option; the synced tab store keeps it across pages and visits. */
const Choice = (props: {
  label: string;
  options: { label: string; experimental?: JSX.Element }[];
  selected: string;
  onSelect: (label: string) => void;
}) => (
  <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label={props.label}>
    <For each={props.options}>
      {(option) => (
        <button
          type="button"
          role="radio"
          aria-checked={props.selected === option.label}
          class="rounded-xs border border-border px-2 py-0.5 text-xs text-fg-muted hover:border-border-strong hover:text-fg aria-checked:border-fg aria-checked:bg-fg aria-checked:text-bg"
          onClick={() => {
            props.onSelect(option.label);
          }}
        >
          {option.label}
          <Show when={option.experimental}>
            <span class="ml-1.5 font-mono text-[10px] tracking-wider uppercase opacity-70">
              exp
            </span>
          </Show>
        </button>
      )}
    </For>
  </div>
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
        <p class="m-0">{option.note}</p>
        <Show when={option.experimental}>
          {(experimental) => (
            <p class="m-0 mt-1 flex flex-wrap items-center gap-1.5">
              <Chip mono>Experimental</Chip>
              <span>{experimental()} is experimental: its API may change in a minor release.</span>
            </p>
          )}
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
  const state = () => pick(stateInstallOptions, syncedTab("state"));
  const notify = () => pick(state().notify, syncedTab("notify"));
  const manager = () => pick(packageManagers, syncedTab("pkg"));
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
          <div class="flex flex-wrap gap-1.5" role="group" aria-label="Extras">
            <For each={extraInstallOptions}>
              {(extra) => (
                <button
                  type="button"
                  aria-pressed={extras().includes(extra.label)}
                  title={extra.note}
                  class="rounded-xs border border-border px-2 py-0.5 text-xs text-fg-muted hover:border-border-strong hover:text-fg aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-bg"
                  onClick={() => {
                    setExtras((current) =>
                      current.includes(extra.label)
                        ? current.filter((label) => label !== extra.label)
                        : [...current, extra.label],
                    );
                  }}
                >
                  {extra.label}
                </button>
              )}
            </For>
          </div>
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
