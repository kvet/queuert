import { Box, Chip, Row, SubLine } from "@queuert/ui/components";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import {
  type Example,
  exampleCommands,
  exampleFileUrl,
  exampleSlug,
  exampleUrl,
  findExample,
} from "../data/examples.ts";
import { siteHref } from "../docs/href.ts";
import { CopyButton } from "./CopyButton.tsx";
import { ExternalLinkIcon } from "./icons.tsx";

const linkClass = "unstyled relative z-10 text-accent-fg hover:underline";

const GitHubLink = (props: { name: string }) => (
  <a
    href={exampleUrl(props.name)}
    target="_blank"
    rel="noopener"
    class="unstyled relative z-10 inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg"
    aria-label={`${props.name} on GitHub (opens in a new tab)`}
  >
    GitHub <ExternalLinkIcon size={12} />
  </a>
);

const ExampleChips = (props: { example: Example }) => (
  <>
    <Chip mono>{props.example.label}</Chip>
    <Show when={props.example.runtime === "Bun"}>
      {" "}
      <Chip tone="strong">Bun</Chip>
    </Show>
    <For each={props.example.services}>
      {(service) => (
        <>
          {" "}
          <Chip title="Started in Docker with testcontainers">Docker · {service}</Chip>
        </>
      )}
    </For>
  </>
);

const Command = (props: { command: string; label?: string }) => (
  <span class="relative z-10 flex min-w-0 items-start gap-1.5">
    <Show when={props.label}>
      <span class="shrink-0 text-fg-subtle">{props.label}</span>
    </Show>
    <code class="min-w-0 text-[13px] wrap-anywhere text-fg">
      <span class="text-fg-subtle select-none">$ </span>
      {props.command}
    </code>
    <CopyButton text={props.command} label="Copy command" class="mt-0.5 shrink-0" />
  </span>
);

const FileLinks = (props: { example: Example }) => (
  <span class="flex flex-wrap gap-x-3 gap-y-1">
    <For each={props.example.files}>
      {(file) => (
        <a
          href={exampleFileUrl(props.example.name, file)}
          target="_blank"
          rel="noopener"
          class={`${linkClass} inline-flex items-center gap-1 font-mono text-xs`}
        >
          {file}
          <ExternalLinkIcon size={11} />
        </a>
      )}
    </For>
  </span>
);

const guideLabel = (title: string) =>
  title.endsWith("adapter") ? `${title} →` : `${title} guide →`;

const commonGuide = (items: Example[]) => {
  const guides = items.flatMap((example) => (example.guide ? [example.guide] : []));
  return guides.find(
    (guide) =>
      guides.filter((candidate) => candidate.href === guide.href).length > items.length / 2,
  );
};

/** `page` is the href of the page the rows sit on; guide links to it are left out. `commandsShownFor` names an example whose commands the page already shows. */
export const ExampleRows = (props: {
  names: string[];
  title: JSX.Element;
  page?: string;
  commandsShownFor?: string;
}) => {
  const items = props.names
    .map(findExample)
    .map((example) =>
      example.guide?.href === props.page ? { ...example, guide: undefined } : example,
    );
  const listGuide = commonGuide(items);
  return (
    <Box
      title={<span class="normal-case">{props.title}</span>}
      actions={
        listGuide && (
          <a href={siteHref(listGuide.href)} class="unstyled text-accent-fg hover:underline">
            {guideLabel(listGuide.title)}
          </a>
        )
      }
      class="my-8"
      bodyClass=""
    >
      <ul class="row-list divide-y divide-border">
        <For each={items}>
          {(example) => (
            <Row id={exampleSlug(example.name)} class="scroll-mt-20 py-3!">
              <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-6">
                <a
                  href={`#${exampleSlug(example.name)}`}
                  class="font-mono unstyled font-medium break-all text-fg no-underline hover:text-accent-fg"
                >
                  {example.name}
                </a>{" "}
                <ExampleChips example={example} />
              </div>
              <GitHubLink name={example.name} />
              <SubLine tone="muted" class="leading-6">
                {example.description}
                <Show when={example.guide?.href !== listGuide?.href ? example.guide : undefined}>
                  {(guide) => (
                    <>
                      {" "}
                      <a href={siteHref(guide().href)} class={`${linkClass} whitespace-nowrap`}>
                        {guideLabel(guide().title)}
                      </a>
                    </>
                  )}
                </Show>
              </SubLine>
              <SubLine class="flex flex-col gap-1.5 pt-1">
                <For each={example.name === props.commandsShownFor ? [] : exampleCommands(example)}>
                  {(command) => <Command command={command.command} label={command.label} />}
                </For>
                <FileLinks example={example} />
              </SubLine>
            </Row>
          )}
        </For>
      </ul>
    </Box>
  );
};
