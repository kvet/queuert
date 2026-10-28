import { Box, Chip, Row, SubLine } from "@queuert/ui/components";
import { A } from "@solidjs/router";
import { For, type JSX, Show } from "solid-js";

import {
  type Example,
  type ExampleCategory,
  type ExamplePageSlug,
  exampleCommands,
  exampleFileUrl,
  exampleHref,
  examplePageHref,
  examplePages,
  exampleUrl,
  examples,
  findExample,
} from "../data/examples.ts";
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

const ExampleRow = (props: { example: Example; listGuide?: string; showGuide?: boolean }) => (
  <Row href={exampleUrl(props.example.name)} label={`${props.example.name} on GitHub`}>
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-6">
      <span class="font-medium break-all text-fg">{props.example.name}</span>{" "}
      <ExampleChips example={props.example} />
    </div>
    <span class="flex items-center gap-1 text-xs text-fg-subtle">
      GitHub <ExternalLinkIcon size={12} />
    </span>
    <SubLine tone="muted" class="leading-5">
      {props.example.description}
      <Show
        when={
          props.showGuide && props.example.guide?.href !== props.listGuide
            ? props.example.guide
            : undefined
        }
      >
        {(guide) => (
          <>
            {" "}
            <A href={guide().href} class={`${linkClass} whitespace-nowrap`}>
              {guide().title} guide →
            </A>
          </>
        )}
      </Show>
    </SubLine>
  </Row>
);

const commonGuide = (items: Example[]) => {
  const guides = items.flatMap((example) => (example.guide ? [example.guide] : []));
  return guides.find(
    (guide) =>
      guides.filter((candidate) => candidate.href === guide.href).length > items.length / 2,
  );
};

export const ExampleList = (props: { category: ExampleCategory; title: JSX.Element }) => {
  const items = examples.filter((example) => example.category === props.category);
  const listGuide = commonGuide(items);
  return (
    <Box
      title={props.title}
      actions={
        listGuide && (
          <A href={listGuide.href} class="unstyled text-accent-fg hover:underline">
            {listGuide.title} guide →
          </A>
        )
      }
      class="my-6"
      bodyClass=""
    >
      <ul class="row-list divide-y divide-border">
        <For each={items}>
          {(example) => <ExampleRow example={example} listGuide={listGuide?.href} showGuide />}
        </For>
      </ul>
    </Box>
  );
};

export const ExampleRows = (props: { names: string[]; title: JSX.Element }) => {
  const items = props.names.map(findExample);
  const listGuide = commonGuide(items);
  return (
    <Box
      title={props.title}
      actions={
        listGuide && (
          <A href={listGuide.href} class="unstyled text-accent-fg hover:underline">
            {listGuide.title} guide →
          </A>
        )
      }
      class="my-8"
      bodyClass=""
    >
      <ul class="row-list divide-y divide-border">
        <For each={items}>
          {(example) => (
            <Row id={example.name} class="scroll-mt-20 py-3!">
              <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-6">
                <a
                  href={`#${example.name}`}
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
                      <A href={guide().href} class={`${linkClass} whitespace-nowrap`}>
                        {guide().title} guide →
                      </A>
                    </>
                  )}
                </Show>
              </SubLine>
              <SubLine class="flex flex-col gap-1.5 pt-1">
                <For each={exampleCommands(example)}>
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

export const ExampleDetail = (props: { name: string }) => {
  const example = findExample(props.name);
  const needs = [
    ...(example.runtime === "Bun" ? ["Bun"] : []),
    ...example.services.map((service) => `Docker (${service} via testcontainers)`),
    ...(example.requires ? [example.requires] : []),
  ];
  return (
    <>
      <p>{example.description}</p>
      <Show when={example.scenarios}>
        {(scenarios) => (
          <ol>
            <For each={scenarios()}>{(scenario) => <li>{scenario}</li>}</For>
          </ol>
        )}
      </Show>
      <Box
        title={example.name}
        actions={<GitHubLink name={example.name} />}
        class="my-6"
        bodyClass=""
      >
        <dl class="m-0 divide-y divide-border text-sm">
          <div class="grid gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[6rem_minmax(0,1fr)]">
            <dt class="text-fg-subtle">Run</dt>
            <dd class="m-0 flex min-w-0 flex-col gap-1.5">
              <For each={exampleCommands(example)}>
                {(command) => <Command command={command.command} label={command.label} />}
              </For>
            </dd>
          </div>
          <Show when={needs.length > 0}>
            <div class="grid gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[6rem_minmax(0,1fr)]">
              <dt class="text-fg-subtle">Needs</dt>
              <dd class="m-0 text-fg">{needs.join(", ")}</dd>
            </div>
          </Show>
          <div class="grid gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[6rem_minmax(0,1fr)]">
            <dt class="text-fg-subtle">Files</dt>
            <dd class="m-0 min-w-0">
              <FileLinks example={example} />
            </dd>
          </div>
          <Show when={example.guide}>
            {(guide) => (
              <div class="grid gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[6rem_minmax(0,1fr)]">
                <dt class="text-fg-subtle">Guide</dt>
                <dd class="m-0">
                  <A href={guide().href} class={linkClass}>
                    {guide().title} →
                  </A>
                </dd>
              </div>
            )}
          </Show>
        </dl>
      </Box>
    </>
  );
};

export const ExamplePageCards = (props: { slugs: ExamplePageSlug[] }) => (
  <ul class="row-list my-6 grid gap-4 sm:grid-cols-2">
    <For each={props.slugs.map((slug) => examplePages.find((page) => page.slug === slug)!)}>
      {(page) => {
        const items = examples.filter((example) => example.page === page.slug);
        return (
          <li
            id={page.slug}
            class="relative scroll-mt-20 rounded-xs border border-border p-4 hover:border-border-strong"
          >
            <div class="flex items-baseline justify-between gap-3">
              <A
                href={examplePageHref(page.slug)}
                class="unstyled font-medium text-fg no-underline after:absolute after:inset-0 hover:text-accent-fg"
              >
                {page.title}
              </A>
              <span class="shrink-0 text-xs text-fg-subtle">{items.length} examples</span>
            </div>
            <p class="m-0 mt-1 text-sm leading-6 text-fg-muted">{page.summary}</p>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <For each={items}>
                {(example) => (
                  <Chip
                    mono
                    href={exampleHref(example)}
                    link={A}
                    class="unstyled relative z-10 no-underline"
                  >
                    {example.name}
                  </Chip>
                )}
              </For>
            </div>
          </li>
        );
      }}
    </For>
  </ul>
);
