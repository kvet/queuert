import { Box, type IconProps } from "@queuert/ui/components";
import { Meta, Title } from "@solidjs/meta";
import { A } from "@solidjs/router";
import { For, type JSX, Show } from "solid-js";

import { CopyButton } from "../components/CopyButton.tsx";
import { Arrow, Diagram, Flow, Node, Rows } from "../components/diagrams/flow/Diagram.tsx";
import {
  ArrowRightIcon,
  BoltIcon,
  ChainIcon,
  ClockIcon,
  DatabaseIcon,
  GitHubIcon,
  KeyIcon,
  MergeIcon,
  ScaleIcon,
  ShieldIcon,
  TransactionIcon,
} from "../components/icons.tsx";
import { CodeTour } from "../components/landing/CodeTour.tsx";
import { LiveChain } from "../components/landing/LiveChain.tsx";
import { LinkCard } from "../components/mdx/Cards.tsx";
// oxlint-disable-next-line import/default -- served by the queuert:highlight plugin in plugins/content.ts
import defineSnippet from "../snippets/define.ts?highlight";
// oxlint-disable-next-line import/default -- served by the queuert:highlight plugin in plugins/content.ts
import enqueueSnippet from "../snippets/enqueue.ts?highlight";
// oxlint-disable-next-line import/default -- served by the queuert:highlight plugin in plugins/content.ts
import processSnippet from "../snippets/process.ts?highlight";

const github = "https://github.com/kvet/queuert";

const features: {
  title: string;
  body: string;
  icon: (props: IconProps) => JSX.Element;
}[] = [
  {
    title: "Transactional, both ends",
    body: "Enqueue commits inside your DB transaction; completion and the next continueWith commit with your domain writes. No outbox, no idempotency-key ritual.",
    icon: TransactionIcon,
  },
  {
    title: "Typed job chains",
    body: "Inputs, outputs, continuations and blockers infer end-to-end via defineJobTypes. Refactoring is compiler-checked.",
    icon: ChainIcon,
  },
  {
    title: "Lives in your database",
    body: "Postgres or SQLite. No Redis required, no workflow server, no separate persistence tier to operate.",
    icon: DatabaseIcon,
  },
  {
    title: "Sub-second wakeup",
    body: "An optional notify adapter (LISTEN/NOTIFY, Redis or NATS) wakes workers right after the commit. Without one, workers poll.",
    icon: BoltIcon,
  },
  {
    title: "Fan-in via blockers",
    body: "“Wait for these N chains, then run X” is a typed primitive, not glue code.",
    icon: MergeIcon,
  },
  {
    title: "Schedule for later",
    body: "Start a chain at a time or after a delay. A handler can reschedule its job, and failed attempts retry with backoff.",
    icon: ClockIcon,
  },
  {
    title: "Deduplication",
    body: "Pass a deduplication key to createChain. A matching chain is returned instead of a new one, until it completes or for good.",
    icon: KeyIcon,
  },
  {
    title: "Lean and battle-tested",
    body: "Zero runtime dependencies. Thousands of tests and a conformance suite every adapter must pass.",
    icon: ShieldIcon,
  },
  {
    title: "MIT licensed",
    body: "No vendor lock-in. No enterprise tier. Own your stack.",
    icon: ScaleIcon,
  },
];

const integrations: {
  title: string;
  items: (string | { label: string; href: string })[];
  href: string;
  customAdapter: boolean;
}[] = [
  {
    title: "Databases",
    items: ["PostgreSQL", "SQLite", "in-process"],
    href: "/integrations/state-adapters/",
    customAdapter: true,
  },
  {
    title: "ORMs",
    items: ["Kysely", "Drizzle", "Prisma", "Knex"],
    href: "/integrations/state-adapters/",
    customAdapter: false,
  },
  {
    title: "Drivers",
    items: ["pg", "postgres.js", "node:sqlite", "better-sqlite3", "Bun.SQL", "bun:sqlite"],
    href: "/integrations/state-adapters/",
    customAdapter: false,
  },
  {
    title: "Notifications",
    items: ["Redis", "LISTEN/NOTIFY", "NATS", "in-process"],
    href: "/integrations/notify-adapters/",
    customAdapter: true,
  },
  {
    title: "Validation",
    items: ["Zod", "ArkType", "Valibot", "TypeBox"],
    href: "/integrations/validation-adapters/",
    customAdapter: true,
  },
  {
    title: "Observability",
    items: ["OpenTelemetry", { label: "Dashboard", href: "/integrations/dashboard/" }],
    href: "/integrations/observability/",
    customAdapter: true,
  },
];

const comparisons = [
  {
    title: "vs. pg-boss",
    slug: "pg-boss",
    description: "A Postgres job queue. Different shape of tool.",
  },
  {
    title: "vs. BullMQ",
    slug: "bullmq",
    description: "A Redis job queue. Different storage tier.",
  },
  {
    title: "vs. Temporal",
    slug: "temporal",
    description: "A workflow platform. Both model multi-step durable work.",
  },
  { title: "vs. Inngest", slug: "inngest", description: "An event-driven workflow platform." },
];

const footerLinks: { label: string; href: string; external?: boolean }[] = [
  { label: "Docs", href: "/getting-started/introduction/" },
  { label: "API", href: "/api/" },
  { label: "Changelog", href: "/changelog/" },
  { label: "GitHub", href: github, external: true },
  { label: "npm", href: "https://www.npmjs.com/package/queuert", external: true },
];

const Section = (props: { id: string; eyebrow: string; title: string; children: JSX.Element }) => (
  <section id={props.id} class="mx-auto max-w-300 px-4 py-20 sm:px-6 lg:py-28">
    <p class="text-xs font-semibold font-mono tracking-wider text-brand uppercase">
      {props.eyebrow}
    </p>
    <h2 class="mt-2 max-w-2xl text-lg font-semibold sm:text-xl">{props.title}</h2>
    <div class="mt-10">{props.children}</div>
  </section>
);

const FeatureCard = (props: (typeof features)[number]) => (
  <div class="flex flex-col rounded-xs border border-border bg-bg p-4">
    <span class="grid size-8 place-items-center rounded-xs border border-border bg-surface text-brand">
      <props.icon size={16} />
    </span>
    <span class="mt-4 font-semibold text-fg">{props.title}</span>
    <span class="mt-1.5 text-[13px] leading-6 text-fg-muted">{props.body}</span>
  </div>
);

const Home = () => (
  <main>
    <Title>Queuert · Durable, typed job chains in your database</Title>
    <Meta
      name="description"
      content="Durable, typed job chains that commit with your database transactions."
    />

    <div class="border-b border-border">
      <div class="mx-auto grid max-w-300 grid-cols-1 items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:py-24">
        <div>
          <p class="font-mono inline-flex items-center gap-2 rounded-xs border border-border bg-surface px-2 py-1 text-xs text-fg-muted">
            <span class="inline-block size-2 rounded-xs bg-brand" />
            Postgres · SQLite · zero runtime deps
          </p>
          <h1 class="mt-6 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            Durable job chains that commit with your <span class="text-brand">transactions</span>.
          </h1>
          <p class="mt-5 max-w-xl text-base leading-7 text-fg-muted">
            A job-chain library that lives in your database. Chains compose like Promises, but
            persist. No Redis required, no separate server.
          </p>
          <div class="mt-8 flex flex-wrap items-center gap-3">
            <A
              href="/getting-started/introduction/"
              class="inline-flex h-10 items-center gap-2 rounded-xs bg-fg px-4 font-medium text-bg hover:opacity-90"
            >
              Get started
              <ArrowRightIcon size={14} />
            </A>
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
        <LiveChain />
      </div>
    </div>

    <Section
      id="architecture"
      eyebrow="How it works"
      title="A thin library over the database you already run."
    >
      <Diagram
        label="Architecture: the client enqueues and workers acquire and complete jobs through your database; an optional pub/sub carries notifications from the client to workers"
        stack="none"
      >
        <Flow align="stretch">
          <Node tone="blue" sub="app process">
            Client
          </Node>
          <Rows columns="minmax(7rem, auto) minmax(13rem, 16rem) minmax(7rem, auto)">
            <Flow>
              <Arrow label="enqueue" sub="state adapter" />
              <Node sub="Postgres · SQLite · your own">Your database</Node>
              <Arrow label="acquire · complete" sub="state adapter" reverse />
            </Flow>
            <Flow>
              <Arrow label="notify" tone="amber" dashed />
              <Node tone="amber" variant="ghost" sub="Postgres LISTEN · Redis · NATS · in-process">
                Your pub/sub (optional)
              </Node>
              <Arrow label="wake" tone="amber" dashed />
            </Flow>
          </Rows>
          <Node tone="green" sub="worker process">
            Worker
          </Node>
        </Flow>
      </Diagram>
      <A
        href="/advanced/adapters/"
        class="mt-4 inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg"
      >
        How the adapters fit together
        <ArrowRightIcon size={12} />
      </A>
    </Section>

    <Section
      id="tour"
      eyebrow="See it in action"
      title="Typed from the first enqueue to the last step."
    >
      <CodeTour
        steps={[
          {
            label: "Define",
            caption: "Each step's input, output and continuation are inferred.",
            snippet: defineSnippet,
          },
          {
            label: "Enqueue",
            caption: "Start the chain inside your transaction. Roll back, and it never existed.",
            snippet: enqueueSnippet,
          },
          {
            label: "Process",
            caption:
              "Complete in the same transaction as your writes, and continue with the next step.",
            snippet: processSnippet,
          },
        ]}
      />
    </Section>

    <Section id="why" eyebrow="Why Queuert" title="The guarantees are structural, not ceremonial.">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <For each={features}>{(feature) => <FeatureCard {...feature} />}</For>
      </div>
    </Section>

    <Section id="integrations" eyebrow="Integrations" title="Bring the stack you already run.">
      <div class="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        <For each={integrations}>
          {(group) => (
            <Box
              title={group.title}
              actions={
                <A
                  href={group.href}
                  class="inline-flex items-center gap-1 text-fg-subtle hover:text-fg"
                >
                  docs
                  <ArrowRightIcon size={12} />
                </A>
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
                    <A
                      href={item.href}
                      class="font-mono rounded-xs bg-surface-2 px-2 py-0.5 text-xs text-fg-muted hover:text-fg"
                    >
                      {item.label}
                    </A>
                  )
                }
              </For>
              <Show when={group.customAdapter}>
                <span class="font-mono rounded-xs border border-dashed border-border-strong px-2 py-0.5 text-xs text-fg-subtle">
                  + custom adapter
                </span>
              </Show>
            </Box>
          )}
        </For>
      </div>
    </Section>

    <Section
      id="compare"
      eyebrow="Already using something else?"
      title="How Queuert relates to the tools you know."
    >
      <div class="grid gap-4 sm:grid-cols-2">
        <For each={comparisons}>
          {(comparison) => (
            <LinkCard
              title={comparison.title}
              href={`${import.meta.env.BASE_URL}comparison/${comparison.slug}/`}
              description={comparison.description}
            />
          )}
        </For>
      </div>
    </Section>

    <footer class="border-t border-border">
      <div class="mx-auto flex max-w-300 flex-col gap-4 px-4 py-8 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>MIT licensed · built with SolidStart</span>
        <nav aria-label="Footer" class="flex flex-wrap gap-x-5 gap-y-2">
          <For each={footerLinks}>
            {(link) =>
              link.external ? (
                <a href={link.href} target="_blank" rel="noopener" class="hover:text-fg">
                  {link.label}
                </a>
              ) : (
                <A href={link.href} class="hover:text-fg">
                  {link.label}
                </A>
              )
            }
          </For>
        </nav>
      </div>
    </footer>
  </main>
);

export default Home;
