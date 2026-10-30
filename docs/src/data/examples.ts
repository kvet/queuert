export type ExampleCategory =
  | "state"
  | "notify"
  | "patterns"
  | "logging"
  | "validation"
  | "observability";

export type ExamplePageSlug =
  | "state-adapters"
  | "notify-adapters"
  | "validation"
  | "logging-observability"
  | "building-chains"
  | "scheduling"
  | "reliability"
  | "app-structure"
  | "operations";

export type ExampleService = "PostgreSQL" | "Redis" | "Redis Cluster" | "NATS";

export type Example = {
  name: string;
  category: ExampleCategory;
  page: ExamplePageSlug;
  label: string;
  description: string;
  runtime: "Node.js" | "Bun";
  services: ExampleService[];
  files: string[];
  scenarios?: string[];
  commands?: { label: string; script: string }[];
  requires?: string;
  guide?: { title: string; href: string };
};

export const examplePages: { slug: ExamplePageSlug; title: string; summary: string }[] = [
  {
    slug: "state-adapters",
    title: "State Adapters",
    summary: "One example per PostgreSQL and SQLite driver or ORM.",
  },
  {
    slug: "notify-adapters",
    title: "Notify Adapters",
    summary: "Redis, Redis Cluster, PostgreSQL LISTEN/NOTIFY and NATS.",
  },
  {
    slug: "validation",
    title: "Validation",
    summary: "Validation adapters backed by Zod, Valibot, TypeBox and ArkType.",
  },
  {
    slug: "logging-observability",
    title: "Logging & Observability",
    summary: "Console, Pino and Winston logging, OpenTelemetry, and the dashboard.",
  },
  {
    slug: "building-chains",
    title: "Building Chains",
    summary: "Chain patterns, blockers, awaiting and workerless completion.",
  },
  {
    slug: "scheduling",
    title: "Scheduling",
    summary: "Recurring jobs, deduplication and rescheduling.",
  },
  {
    slug: "reliability",
    title: "Reliability",
    summary: "Error recovery, error handling, timeouts, long-running jobs and abort signals.",
  },
  {
    slug: "app-structure",
    title: "App Structure",
    summary: "Feature slices and attempt middleware.",
  },
  {
    slug: "operations",
    title: "Operations",
    summary: "Multiple workers, prioritization, queries, chain deletion and cleanup.",
  },
];

const stateAdapters = { title: "State Adapters", href: "/integrations/state-adapters/" };
const notifyAdapters = { title: "Notify Adapters", href: "/integrations/notify-adapters/" };
const validationAdapters = {
  title: "Validation Adapters",
  href: "/integrations/validation-adapters/",
};
const logging = { title: "Logging", href: "/advanced/logging/" };

const providerFiles = ["src/provider.ts", "src/index.ts"];

export const examples: Example[] = [
  {
    name: "state-postgres-pg",
    category: "state",
    page: "state-adapters",
    label: "pg (node-postgres)",
    description:
      "PostgreSQL state storage via @queuert/postgres with the pg (node-postgres) driver — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-postgres-postgres-js",
    category: "state",
    page: "state-adapters",
    label: "postgres.js",
    description:
      "PostgreSQL state storage via @queuert/postgres with postgres.js — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-postgres-drizzle",
    category: "state",
    page: "state-adapters",
    label: "Drizzle ORM",
    description:
      "PostgreSQL state storage via @queuert/postgres with Drizzle ORM — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-postgres-kysely",
    category: "state",
    page: "state-adapters",
    label: "Kysely",
    description:
      "PostgreSQL state storage via @queuert/postgres with Kysely — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-postgres-prisma",
    category: "state",
    page: "state-adapters",
    label: "Prisma",
    description:
      "PostgreSQL state storage via @queuert/postgres with Prisma ORM — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/provider.ts", "src/index.ts", "prisma/schema.prisma"],
    guide: stateAdapters,
  },
  {
    name: "state-postgres-knex",
    category: "state",
    page: "state-adapters",
    label: "Knex",
    description:
      "PostgreSQL state storage via @queuert/postgres with Knex — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-postgres-bun-sql",
    category: "state",
    page: "state-adapters",
    label: "Bun.SQL",
    description:
      "PostgreSQL state storage via @queuert/postgres using Bun's built-in SQL client — job creation and completion inside application transactions, no external PostgreSQL dependencies.",
    runtime: "Bun",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-postgres-multi-worker",
    category: "state",
    page: "operations",
    label: "multiple workers",
    description:
      "Three worker processes (forked from the main process) share the same PostgreSQL database and compete for jobs — the main process creates orders and their chains in one transaction, and each order is processed by whichever worker acquires its job first.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts", "src/worker.ts"],
    guide: { title: "Horizontal Scaling", href: "/guides/horizontal-scaling/" },
  },
  {
    name: "state-sqlite-better-sqlite3",
    category: "state",
    page: "state-adapters",
    label: "better-sqlite3",
    description:
      "SQLite state storage via @queuert/sqlite with the better-sqlite3 driver — job creation and completion inside application transactions, with createAsyncRwLock() for write serialization: the handler holds the same lock around the transaction it passes to complete.",
    runtime: "Node.js",
    services: [],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-sqlite-node-sqlite",
    category: "state",
    page: "state-adapters",
    label: "node:sqlite",
    description:
      "SQLite state storage via @queuert/sqlite using Node's built-in node:sqlite module — no external SQLite dependencies. The handler holds the provider's createAsyncRwLock() write lock around the transaction it passes to complete.",
    runtime: "Node.js",
    services: [],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-sqlite-drizzle",
    category: "state",
    page: "state-adapters",
    label: "Drizzle ORM",
    description:
      "SQLite state storage via @queuert/sqlite with Drizzle ORM — job creation and completion inside application transactions, with createAsyncRwLock() for write serialization: the handler holds the same lock around the transaction it passes to complete.",
    runtime: "Node.js",
    services: [],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-sqlite-kysely",
    category: "state",
    page: "state-adapters",
    label: "Kysely",
    description:
      "SQLite state storage via @queuert/sqlite with Kysely — job creation and completion inside application transactions. Kysely's better-sqlite3 dialect uses a size-1 connection pool that already serializes writers, so no external lock is needed, for client calls or for the transaction a handler passes to complete.",
    runtime: "Node.js",
    services: [],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-sqlite-prisma",
    category: "state",
    page: "state-adapters",
    label: "Prisma",
    description:
      "SQLite state storage via @queuert/sqlite with Prisma ORM — job creation and completion inside application transactions, with createAsyncRwLock() for write serialization: the handler holds the same lock around the transaction it passes to complete.",
    runtime: "Node.js",
    services: [],
    files: ["src/provider.ts", "src/index.ts", "prisma/schema.prisma"],
    guide: stateAdapters,
  },
  {
    name: "state-sqlite-knex",
    category: "state",
    page: "state-adapters",
    label: "Knex",
    description:
      "SQLite state storage via @queuert/sqlite with Knex — job creation and completion inside application transactions. Knex's better-sqlite3 dialect uses a size-1 connection pool that already serializes writers, so no external lock is needed, for client calls or for the transaction a handler passes to complete.",
    runtime: "Node.js",
    services: [],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-sqlite-bun-sqlite",
    category: "state",
    page: "state-adapters",
    label: "bun:sqlite",
    description:
      "SQLite state storage via @queuert/sqlite using Bun's built-in bun:sqlite module — no external SQLite dependencies. The handler holds the provider's createAsyncRwLock() write lock around the transaction it passes to complete.",
    runtime: "Bun",
    services: [],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "state-sqlite-bun-sql",
    category: "state",
    page: "state-adapters",
    label: "Bun.SQL",
    description:
      "SQLite state storage via @queuert/sqlite using Bun's built-in SQL client in its sqlite:// mode — no external SQLite dependencies. The handler holds the provider's createAsyncRwLock() write lock around the transaction it passes to complete.",
    runtime: "Bun",
    services: [],
    files: providerFiles,
    guide: stateAdapters,
  },
  {
    name: "notify-redis-ioredis",
    category: "notify",
    page: "notify-adapters",
    label: "Redis · ioredis",
    description: "Redis pub/sub notifications via @queuert/redis with the ioredis client.",
    runtime: "Node.js",
    services: ["Redis"],
    files: providerFiles,
    guide: notifyAdapters,
  },
  {
    name: "notify-redis-redis",
    category: "notify",
    page: "notify-adapters",
    label: "Redis · node-redis",
    description: "Redis pub/sub notifications via @queuert/redis with the node-redis client.",
    runtime: "Node.js",
    services: ["Redis"],
    files: providerFiles,
    guide: notifyAdapters,
  },
  {
    name: "notify-redis-cluster-ioredis",
    category: "notify",
    page: "notify-adapters",
    label: "Redis Cluster · ioredis",
    description: "Redis notifications against a Redis Cluster through an ioredis cluster client.",
    runtime: "Node.js",
    services: ["Redis Cluster"],
    files: providerFiles,
    guide: notifyAdapters,
  },
  {
    name: "notify-redis-cluster-node-redis",
    category: "notify",
    page: "notify-adapters",
    label: "Redis Cluster · node-redis",
    description: "Redis notifications against a Redis Cluster through a node-redis cluster client.",
    runtime: "Node.js",
    services: ["Redis Cluster"],
    files: providerFiles,
    guide: notifyAdapters,
  },
  {
    name: "notify-redis-bun",
    category: "notify",
    page: "notify-adapters",
    label: "Redis · Bun",
    description:
      "Redis pub/sub notifications via @queuert/redis using Bun's built-in RedisClient — no external Redis dependencies.",
    runtime: "Bun",
    services: ["Redis"],
    files: providerFiles,
    guide: notifyAdapters,
  },
  {
    name: "notify-postgres-pg",
    category: "notify",
    page: "notify-adapters",
    label: "LISTEN/NOTIFY · pg",
    description:
      "PostgreSQL LISTEN/NOTIFY via @queuert/postgres with the pg (node-postgres) client.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: notifyAdapters,
  },
  {
    name: "notify-postgres-postgres-js",
    category: "notify",
    page: "notify-adapters",
    label: "LISTEN/NOTIFY · postgres.js",
    description: "PostgreSQL LISTEN/NOTIFY via @queuert/postgres with the postgres-js client.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: notifyAdapters,
  },
  {
    name: "notify-postgres-bun-sql",
    category: "notify",
    page: "notify-adapters",
    label: "LISTEN/NOTIFY · Bun.SQL",
    description:
      "PostgreSQL LISTEN/NOTIFY via @queuert/postgres using Bun's built-in SQL client — no external PostgreSQL dependencies.",
    runtime: "Bun",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: notifyAdapters,
  },
  {
    name: "notify-nats-nats",
    category: "notify",
    page: "notify-adapters",
    label: "NATS",
    description: "NATS core pub/sub notifications.",
    runtime: "Node.js",
    services: ["NATS"],
    files: ["src/index.ts"],
    guide: notifyAdapters,
  },
  {
    name: "showcase-chain-patterns",
    category: "patterns",
    page: "building-chains",
    label: "continueWith",
    description: "Chain execution patterns through a subscription lifecycle.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: ["Linear", "Branched", "Loops", "Go-to"],
    guide: { title: "Chain Patterns", href: "/guides/chain-patterns/" },
  },
  {
    name: "showcase-blockers",
    category: "patterns",
    page: "building-chains",
    label: "blockers",
    description: "Jobs that depend on other chains completing before they start.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: ["Fan-out/fan-in", "Fixed slots", "Blocker by ID"],
    guide: { title: "Job Blockers", href: "/guides/job-blockers/" },
  },
  {
    name: "showcase-chain-awaiting",
    category: "patterns",
    page: "building-chains",
    label: "awaitChain",
    description: "Waiting for chain completion using polling and notification.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: ["Basic awaiting", "Parallel awaiting", "Timeout handling", "Abort signal"],
    guide: { title: "Awaiting Chains", href: "/guides/chain-awaiting/" },
  },
  {
    name: "showcase-workerless",
    category: "patterns",
    page: "building-chains",
    label: "completeChain",
    description: "Completing jobs externally without a worker, via completeChain.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: [
      "Approval workflow: an external API completes the job.",
      "Deferred start with early completion: a scheduled timeout that an early action can preempt.",
    ],
    guide: { title: "Completing Without a Worker", href: "/guides/workerless-completion/" },
  },
  {
    name: "showcase-scheduling",
    category: "patterns",
    page: "scheduling",
    label: "schedule",
    description: "Recurring job patterns without external cron.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: [
      "Recurring jobs that start a new chain with a scheduled delay.",
      "Deduplication of recurring job instances.",
      "Triggering a future-scheduled job early with rescheduleJob.",
      "Rescheduling from a handler with complete({ reschedule }).",
    ],
    guide: { title: "Scheduling", href: "/guides/scheduling/" },
  },
  {
    name: "showcase-slices",
    category: "patterns",
    page: "app-structure",
    label: "feature slices",
    description:
      "Job types and processors organized in feature slices and merged into one client and worker, with cross-slice blockers.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: [
      "src/slice-orders-definitions.ts",
      "src/slice-orders-processors.ts",
      "src/slice-notifications-definitions.ts",
      "src/slice-notifications-processors.ts",
      "src/client.ts",
      "src/index.ts",
    ],
    scenarios: [
      "Independent slices: each slice's chains run in isolation.",
      "Fire-and-forget: an order processor starts a notification chain from the other slice.",
      "Cross-slice blockers: external references let one slice declare blockers from another.",
    ],
    guide: { title: "Feature Slices", href: "/guides/slices/" },
  },
  {
    name: "showcase-middleware",
    category: "patterns",
    page: "app-structure",
    label: "attemptMiddleware",
    description:
      "A multi-tenant billing worker whose cross-cutting concerns live in AttemptMiddleware rather than in each handler: an attempt-scoped log, the tenant row loaded before the handler runs, and a meter() that records billable units in the handler's transaction.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: [
      "Happy path: logging, tenant loading and metering wrap each handler.",
      "Failed attempt: the first send-receipt attempt fails after metering inside its complete transaction; the usage record rolls back and the unit committed earlier is deduplicated instead of billed twice.",
    ],
    guide: { title: "Job Attempt Middleware", href: "/guides/middleware/" },
  },
  {
    name: "showcase-error-recovery",
    category: "patterns",
    page: "reliability",
    label: "error recovery",
    description: "Queuert's engine-level error recovery guarantees.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: [
      "CHECK constraint violation in the handler's transaction: rolls back together with complete.",
      "A throw after complete inside the transaction: everything rolls back.",
      "A throw after the transaction committed: the completion is kept.",
      "A failed external call before the transaction opens.",
      "lastAttemptError inspection on retry.",
    ],
    guide: { title: "Job Processing Reliability", href: "/guides/processing-reliability/" },
  },
  {
    name: "showcase-error-handling",
    category: "patterns",
    page: "reliability",
    label: "errors",
    description: "Error handling patterns in chains.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: [
      "Discriminated unions",
      "Compensation pattern",
      "Automatic backoff on thrown errors with lastAttemptError",
    ],
    guide: { title: "Error Handling", href: "/guides/error-handling/" },
  },
  {
    name: "showcase-timeouts",
    category: "patterns",
    page: "reliability",
    label: "attemptConfig",
    description: "Timeout patterns for job processing.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: [
      "Cooperative timeout via AbortController composed with the job signal.",
      "The attempt timeout via attemptConfig, which a crashed or stalled worker stops extending so the job is reclaimed.",
    ],
    guide: { title: "Timeouts", href: "/guides/timeouts/" },
  },
  {
    name: "showcase-long-running-jobs",
    category: "patterns",
    page: "reliability",
    label: "heartbeat",
    description:
      "A report job whose work takes longer than its attempt timeout. The work runs outside any transaction and receives signal, the worker's heartbeat keeps extending the attempt while it runs, and the handler then writes the report and calls complete in its own transaction.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    guide: { title: "Timeouts", href: "/guides/timeouts/" },
  },
  {
    name: "showcase-signals",
    category: "patterns",
    page: "reliability",
    label: "signal",
    description: "Abort signal patterns for job processing.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: [
      "Graceful shutdown: the handler stops on signal and completes with partial results.",
      "External completion via completeChain: the running handler stops and the worker discards its attempt.",
    ],
    guide: { title: "In-Process Worker", href: "/advanced/in-process-worker/" },
  },
  {
    name: "showcase-multiworker-prioritization",
    category: "patterns",
    page: "operations",
    label: "partitioned workers",
    description:
      "Reserving worker capacity for an urgent workload by partitioning job types across workers. Queuert has no built-in priority field — prioritization is a consequence of giving an urgent workload its own worker whose slots cannot be consumed by bulk work.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: [
      "Reserved capacity: the urgent worker is isolated from the bulk backlog.",
      "Cross-worker chain handoff.",
    ],
    guide: { title: "Prioritization", href: "/guides/prioritization/" },
  },
  {
    name: "showcase-queries",
    category: "patterns",
    page: "operations",
    label: "queries",
    description: "Read-only query methods for inspecting chains and jobs.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: [
      "Single lookups with type narrowing",
      "Batch lookups",
      "Type discovery",
      "Per-status type counts",
      "Paginated lists",
      "Jobs within a chain ordered by chain index",
      "Blocker queries from both directions",
    ],
    guide: { title: "Job & Chain Queries", href: "/guides/queries/" },
  },
  {
    name: "showcase-chain-deletion",
    category: "patterns",
    page: "operations",
    label: "deleteChains",
    description: "Deleting chains with blocker safety checks.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    scenarios: [
      "Simple deletion, and idempotent re-deletion with deleteChain",
      "Blocker safety",
      "Co-deletion",
    ],
    guide: { title: "Chain Deletion", href: "/guides/chain-deletion/" },
  },
  {
    name: "showcase-cleanup",
    category: "patterns",
    page: "operations",
    label: "cleanup job",
    description:
      "Automatic cleanup of completed chains implemented as a Queuert job type — batched deletion with cursor pagination, and idempotent rescheduling via deduplication.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts"],
    guide: { title: "Cleanup", href: "/guides/cleanup/" },
  },
  {
    name: "log-console",
    category: "logging",
    page: "logging-observability",
    label: "createConsoleLog",
    description: "Queuert's built-in createConsoleLog() for simple console output.",
    runtime: "Node.js",
    services: [],
    files: ["src/index.ts"],
    guide: logging,
  },
  {
    name: "log-pino",
    category: "logging",
    page: "logging-observability",
    label: "Pino",
    description:
      "Pino integration for structured logging, with per-job contextual loggers injected via attemptMiddleware.",
    runtime: "Node.js",
    services: [],
    files: ["src/log.ts", "src/index.ts"],
    guide: logging,
  },
  {
    name: "log-winston",
    category: "logging",
    page: "logging-observability",
    label: "Winston",
    description:
      "Winston integration for structured logging, with per-job contextual loggers injected via attemptMiddleware.",
    runtime: "Node.js",
    services: [],
    files: ["src/log.ts", "src/index.ts"],
    guide: logging,
  },
  {
    name: "validation-zod",
    category: "validation",
    page: "validation",
    label: "Zod",
    description:
      "Custom validation adapter backed by Zod — covers nominal (by type name) and structural (by input shape) reference validation.",
    runtime: "Node.js",
    services: [],
    files: ["src/zod-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation-valibot",
    category: "validation",
    page: "validation",
    label: "Valibot",
    description:
      "Custom validation adapter backed by Valibot — covers nominal (by type name) and structural (by input shape) reference validation.",
    runtime: "Node.js",
    services: [],
    files: ["src/valibot-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation-typebox",
    category: "validation",
    page: "validation",
    label: "TypeBox",
    description:
      "Custom validation adapter backed by TypeBox — covers nominal (by type name) and structural (by input shape) reference validation.",
    runtime: "Node.js",
    services: [],
    files: ["src/typebox-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation-arktype",
    category: "validation",
    page: "validation",
    label: "ArkType",
    description:
      "Custom validation adapter backed by ArkType — covers nominal (by type name) and structural (by input shape) reference validation.",
    runtime: "Node.js",
    services: [],
    files: ["src/arktype-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "observability-otel",
    category: "observability",
    page: "logging-observability",
    label: "@queuert/otel",
    description: "@queuert/otel wiring for distributed tracing and metrics, viewed in otel-tui.",
    runtime: "Node.js",
    services: [],
    files: ["src/observability.ts", "src/index.ts"],
    scenarios: [
      "A single job, a chain of continuations, and a fan-out/fan-in with blockers.",
      "Work in the handler's own transactions, a retried job, and a workerless completion.",
    ],
    commands: [
      { label: "Terminal 1: OTLP receiver", script: "tui" },
      { label: "Terminal 2: example", script: "start" },
    ],
    requires: "otel-tui",
    guide: { title: "Observability", href: "/integrations/observability/" },
  },
  {
    name: "dashboard",
    category: "observability",
    page: "logging-observability",
    label: "@queuert/dashboard",
    description:
      "@queuert/dashboard embedded as a fetch handler with Node's built-in HTTP server. Run the populator to generate chains, jobs and workers, browse them through the web UI.",
    runtime: "Node.js",
    services: [],
    files: ["src/dashboard.ts", "src/populator.ts", "src/common.ts"],
    commands: [
      { label: "Terminal 1: dashboard", script: "dashboard" },
      { label: "Terminal 2: populator", script: "start" },
    ],
    guide: { title: "Dashboard", href: "/integrations/dashboard/" },
  },
];

export const exampleUrl = (name: string) =>
  `https://github.com/kvet/queuert/tree/main/examples/${name}`;

export const exampleFileUrl = (name: string, file: string) =>
  `https://github.com/kvet/queuert/blob/main/examples/${name}/${file}`;

export const exampleHref = (example: Example) => `/examples/${example.page}/#${example.name}`;

export const examplePageHref = (slug: ExamplePageSlug) => `/examples/${slug}/`;

export const exampleCommands = (example: Example): { label?: string; command: string }[] =>
  (example.commands ?? [{ script: "start" }]).map((command) => ({
    label: "label" in command ? command.label : undefined,
    command: `pnpm --filter example-${example.name} ${command.script}`,
  }));

export const findExample = (name: string): Example => {
  const example = examples.find((candidate) => candidate.name === name);
  if (example === undefined) throw new Error(`Unknown example "${name}"`);
  return example;
};
