import { Box } from "@queuert/ui/components";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { BenchmarkHighlights } from "../components/BenchmarkHighlights.tsx";
import { CopyButton } from "../components/CopyButton.tsx";
import {
  Arrow,
  Diagram,
  Flow,
  Node,
  Rows,
  Transition,
} from "../components/diagrams/flow/Diagram.tsx";
import { ExampleCode } from "../components/ExampleCode.tsx";
import { ArrowRightIcon, GitHubIcon } from "../components/icons.tsx";
import { FirstChain } from "../components/landing/FirstChain.tsx";
import { HeroSquares } from "../components/landing/HeroSquares.tsx";
import { PageMeta } from "../components/PageMeta.tsx";
import { siteHref } from "../docs/href.ts";
import { siteDescription } from "../docs/site.ts";

const github = "https://github.com/kvet/queuert";

const integrations: {
  title: string;
  items: (string | { label: string; href: string })[];
  href: string;
  custom?: "adapter" | "provider";
}[] = [
  {
    title: "Databases",
    items: [
      { label: "PostgreSQL", href: "/integrations/state-adapters/postgres/" },
      { label: "SQLite", href: "/integrations/state-adapters/sqlite/" },
      { label: "MySQL / MariaDB", href: "/integrations/state-adapters/mysql/" },
      { label: "Redis", href: "/integrations/state-adapters/redis/" },
      { label: "in-process", href: "/integrations/state-adapters/in-process/" },
    ],
    href: "/integrations/state-adapters/",
    custom: "adapter",
  },
  {
    title: "ORMs",
    items: ["Kysely", "Drizzle", "Prisma", "Knex", "MikroORM"],
    href: "/integrations/state-adapters/",
    custom: "provider",
  },
  {
    title: "Drivers",
    items: [
      "pg",
      "postgres.js",
      "Bun SQL",
      "better-sqlite3",
      "node:sqlite",
      "bun:sqlite",
      "mysql2",
      "mariadb",
    ],
    href: "/integrations/state-adapters/",
    custom: "provider",
  },
  {
    title: "Notifications",
    items: [
      { label: "LISTEN/NOTIFY", href: "/integrations/notify-adapters/postgres/" },
      { label: "Redis", href: "/integrations/notify-adapters/redis/" },
      { label: "NATS", href: "/integrations/notify-adapters/nats/" },
      { label: "IPC", href: "/integrations/notify-adapters/ipc/" },
      { label: "in-process", href: "/integrations/notify-adapters/#default" },
    ],
    href: "/integrations/notify-adapters/",
    custom: "adapter",
  },
  {
    title: "Validation",
    items: ["Zod", "ArkType", "Valibot", "TypeBox"],
    href: "/integrations/validation/",
    custom: "adapter",
  },
  {
    title: "Observability",
    items: [
      { label: "OpenTelemetry", href: "/integrations/opentelemetry/" },
      { label: "Logging", href: "/integrations/logging/" },
      { label: "Dashboard", href: "/integrations/dashboard/" },
    ],
    href: "/integrations/observability/",
    custom: "adapter",
  },
];

const Section = (props: { id: string; eyebrow: string; title: string; children: JSX.Element }) => (
  <section id={props.id} class="mx-auto max-w-300 px-4 py-8 sm:px-6 lg:py-10">
    <p class="text-xs font-semibold font-mono tracking-wider text-brand-fg uppercase">
      {props.eyebrow}
    </p>
    <h2 class="mt-2 max-w-2xl text-lg font-semibold sm:text-xl">{props.title}</h2>
    <div class="mt-6">{props.children}</div>
  </section>
);

const Home = () => (
  <main>
    <PageMeta
      title="Queuert · Durable, typed job chains in your database"
      description={siteDescription}
      path="/"
    />

    <div class="relative overflow-hidden border-b border-border">
      <HeroSquares />
      <div class="relative mx-auto grid max-w-300 grid-cols-1 items-start gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12 lg:py-6">
        <div class="lg:pt-8">
          <p class="font-mono inline-flex items-center gap-2 rounded-xs border border-border bg-surface px-2 py-1 text-xs text-fg-muted">
            <span class="inline-block size-2 rounded-xs bg-brand" />
            PostgreSQL · SQLite · MySQL · Redis
          </p>
          <h1 class="mt-6 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            Durable job chains that commit with your <span class="text-brand">transactions</span>.
          </h1>
          <p class="mt-5 max-w-xl text-base leading-7 text-fg-muted">
            A job-chain library that lives in your database. Chains compose like Promises, but
            persist. No separate server.
          </p>
          <div class="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={siteHref("/learn/")}
              class="inline-flex h-10 items-center gap-2 rounded-xs bg-fg px-4 font-medium text-bg hover:opacity-90"
            >
              Start learning
              <ArrowRightIcon size={14} />
            </a>
            <a
              href={siteHref("/learn/use-it-in-your-app/")}
              class="inline-flex h-10 items-center gap-2 rounded-xs border border-border-strong bg-surface px-4 hover:bg-surface-2"
            >
              Install
            </a>
            <a
              href={github}
              target="_blank"
              rel="noopener"
              class="inline-flex h-10 items-center gap-2 rounded-xs border border-border-strong bg-surface px-4 hover:bg-surface-2"
            >
              <GitHubIcon size={15} />
              GitHub
            </a>
            <div class="font-mono inline-flex h-10 items-center gap-2 rounded-xs border border-dashed border-border-strong pr-2 pl-3 text-fg-muted">
              <span class="text-fg-subtle">$</span>
              <span class="text-fg">npm i queuert</span>
              <CopyButton text="npm i queuert" label="Copy install command" />
            </div>
          </div>
        </div>
        <FirstChain>
          <ExampleCode example="tutorial" file="src/hero.ts" title="index.ts" />
        </FirstChain>
      </div>
    </div>

    <Section id="architecture" eyebrow="How it works" title="Architecture">
      <Diagram label="Architecture: the client enqueues and workers acquire and complete jobs through your database; an optional pub/sub carries notifications from the client to workers">
        <Flow align="stretch">
          <Node sub="app process">client</Node>
          <Rows stack="columns" columns="minmax(7rem, auto) auto minmax(7rem, auto)">
            <Flow>
              <Arrow label="enqueue" sub="state adapter" />
              <Node
                sub={
                  <>
                    PostgreSQL · SQLite · MySQL · Redis · your own
                    <Transition from="pending" via="running" to="completed" />
                  </>
                }
              >
                your database
              </Node>
              <Arrow label="acquire · complete" sub="state adapter" reverse />
            </Flow>
            <Flow>
              <Arrow label="notify" dashed />
              <Node variant="ghost" sub="PostgreSQL · Redis · NATS · IPC · in-process">
                your pub/sub (optional)
              </Node>
              <Arrow label="wake" dashed />
            </Flow>
          </Rows>
          <Node sub="worker process">worker</Node>
        </Flow>
      </Diagram>
      <a
        href={siteHref("/integrations/")}
        class="mt-4 inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg"
      >
        How the adapters fit together
        <ArrowRightIcon size={12} />
      </a>
    </Section>

    <Section id="performance" eyebrow="Performance" title="Benchmarks">
      <BenchmarkHighlights />
      <p class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-fg-muted">
        <a
          href={siteHref("/comparison/#benchmarks")}
          class="inline-flex items-center gap-1.5 hover:text-fg"
        >
          All benchmarks
          <ArrowRightIcon size={12} />
        </a>
        <a href={siteHref("/comparison/")} class="inline-flex items-center gap-1.5 hover:text-fg">
          Compare with other tools
          <ArrowRightIcon size={12} />
        </a>
      </p>
    </Section>

    <Section id="integrations" eyebrow="Integrations" title="Supported tools">
      <div class="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        <For each={integrations}>
          {(group) => (
            <Box
              title={group.title}
              actions={
                <a
                  href={siteHref(group.href)}
                  class="inline-flex items-center gap-1 text-fg-subtle hover:text-fg"
                >
                  docs
                  <ArrowRightIcon size={12} />
                </a>
              }
              bodyClass="flex flex-wrap gap-1.5 px-4 pt-3 pb-4"
            >
              <For each={group.items}>
                {(item) =>
                  typeof item === "string" ? (
                    <span class="font-mono rounded-xs bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
                      {item}
                    </span>
                  ) : (
                    <a
                      href={siteHref(item.href)}
                      class="font-mono rounded-xs bg-surface-2 px-2 py-0.5 text-xs text-fg-muted hover:text-fg"
                    >
                      {item.label}
                    </a>
                  )
                }
              </For>
              <Show when={group.custom}>
                <span class="font-mono rounded-xs border border-dashed border-border-strong px-2 py-0.5 text-xs text-fg-subtle">
                  + custom {group.custom}
                </span>
              </Show>
            </Box>
          )}
        </For>
      </div>
    </Section>
  </main>
);

export default Home;
