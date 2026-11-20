export type ExampleService = "PostgreSQL" | "MySQL" | "Redis" | "Redis Cluster" | "NATS";

export type Example = {
  name: string;
  label: string;
  description: string;
  runtime: "Node.js" | "Bun";
  services: ExampleService[];
  files: string[];
  commands?: { label: string; script: string }[];
  guide?: { title: string; href: string };
};

const statePostgres = {
  title: "PostgreSQL State Adapter",
  href: "/integrations/state-adapters/postgres/",
};
const stateSqlite = { title: "SQLite State Adapter", href: "/integrations/state-adapters/sqlite/" };
const stateMysql = {
  title: "MySQL / MariaDB State Adapter",
  href: "/integrations/state-adapters/mysql/",
};
const stateRedis = { title: "Redis State Adapter", href: "/integrations/state-adapters/redis/" };
const notifyPostgres = {
  title: "PostgreSQL Notify Adapter",
  href: "/integrations/notify-adapters/postgres/",
};
const notifyRedis = { title: "Redis Notify Adapter", href: "/integrations/notify-adapters/redis/" };
const notifyNats = { title: "NATS Notify Adapter", href: "/integrations/notify-adapters/nats/" };
const notifyIpc = { title: "IPC Notify Adapter", href: "/integrations/notify-adapters/ipc/" };
const validationAdapters = {
  title: "Validation",
  href: "/integrations/validation/",
};
const logging = { title: "Logging", href: "/integrations/logging/" };

const providerFiles = ["src/provider.ts", "src/index.ts"];
const stateProviderFiles = [...providerFiles, "src/migrations.ts"];

export const examples: Example[] = [
  {
    name: "postgresql/state-pg",
    label: "pg (node-postgres)",
    description:
      "PostgreSQL state storage via @queuert/postgres with the pg (node-postgres) driver — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: stateProviderFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/state-postgres-js",
    label: "postgres.js",
    description:
      "PostgreSQL state storage via @queuert/postgres with postgres.js — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: stateProviderFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/state-drizzle",
    label: "Drizzle ORM",
    description:
      "PostgreSQL state storage via @queuert/postgres with Drizzle ORM — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: [...stateProviderFiles, "src/schema.ts"],
    guide: statePostgres,
  },
  {
    name: "postgresql/state-kysely",
    label: "Kysely",
    description:
      "PostgreSQL state storage via @queuert/postgres with Kysely — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: [...stateProviderFiles, "src/database.ts"],
    guide: statePostgres,
  },
  {
    name: "postgresql/state-mikro-orm",
    label: "MikroORM",
    description:
      "PostgreSQL state storage via @queuert/postgres with MikroORM — commit and rollback callbacks from MikroORM's transaction events, so calls take `{ em }` alone.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/state-prisma",
    label: "Prisma",
    description:
      "PostgreSQL state storage via @queuert/postgres with Prisma ORM — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/provider.ts", "src/index.ts", "src/migrations.ts", "prisma/schema.prisma"],
    guide: statePostgres,
  },
  {
    name: "postgresql/state-knex",
    label: "Knex",
    description:
      "PostgreSQL state storage via @queuert/postgres with Knex — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: stateProviderFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/state-bun-sql",
    label: "Bun.SQL",
    description:
      "PostgreSQL state storage via @queuert/postgres using Bun's built-in SQL client — job creation and completion inside application transactions, no external PostgreSQL dependencies.",
    runtime: "Bun",
    services: ["PostgreSQL"],
    files: stateProviderFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/multi-worker",
    label: "multiple workers",
    description:
      "Three worker processes (forked from the main process) share the same PostgreSQL database and compete for jobs — the main process creates orders and their chains in one transaction, and each order is processed by whichever worker acquires its job first.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts", "src/worker.ts"],
    guide: { title: "Horizontal Scaling", href: "/guides/horizontal-scaling/" },
  },
  {
    name: "sqlite/multi-worker",
    label: "multiple workers on SQLite",
    description:
      "Three worker processes (forked from the main process) share one SQLite database file in WAL mode and compete for jobs, waking each other through the IPC notify adapter — the main process creates orders and their chains in one better-sqlite3 transaction.",
    runtime: "Node.js",
    services: [],
    files: ["src/index.ts", "src/worker.ts"],
    guide: { title: "Horizontal Scaling", href: "/guides/horizontal-scaling/" },
  },
  {
    name: "sqlite/state-better-sqlite3",
    label: "better-sqlite3",
    description:
      "SQLite state storage via @queuert/sqlite with the better-sqlite3 driver through a synchronous SqliteStateProvider — job creation and completion inside better-sqlite3's own db.transaction, with no lock.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-node-sqlite",
    label: "node:sqlite",
    description:
      "SQLite state storage via @queuert/sqlite using Node's built-in node:sqlite module through a synchronous SqliteStateProvider — no external SQLite dependencies, and job creation and completion inside a BEGIN/COMMIT transaction with no lock.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-drizzle",
    label: "Drizzle ORM",
    description:
      "SQLite state storage via @queuert/sqlite with Drizzle ORM through a synchronous SqliteStateProvider — job creation and completion inside Drizzle's synchronous transaction over better-sqlite3, with no lock.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-kysely",
    label: "Kysely",
    description:
      "SQLite state storage via @queuert/sqlite with Kysely — job creation and completion inside application transactions. Kysely's better-sqlite3 dialect uses a size-1 connection pool that already serializes writers, so no external lock is needed, for client calls or for the transaction a handler passes to complete.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-mikro-orm",
    label: "MikroORM",
    description:
      "SQLite state storage via @queuert/sqlite with MikroORM — commit and rollback callbacks from MikroORM's transaction events, so calls take `{ em }` alone. MikroORM's SQLite driver holds its one better-sqlite3 connection for the whole transaction, so no external lock is needed.",
    runtime: "Node.js",
    services: [],
    files: providerFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-prisma",
    label: "Prisma",
    description:
      "SQLite state storage via @queuert/sqlite with Prisma ORM — job creation and completion inside application transactions, with createAsyncRwLock() for write serialization: the handler holds the same lock around the transaction it passes to complete.",
    runtime: "Node.js",
    services: [],
    files: ["src/provider.ts", "src/index.ts", "src/migrations.ts", "prisma/schema.prisma"],
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-knex",
    label: "Knex",
    description:
      "SQLite state storage via @queuert/sqlite with Knex — job creation and completion inside application transactions. Knex's better-sqlite3 dialect uses a size-1 connection pool that already serializes writers, so no external lock is needed, for client calls or for the transaction a handler passes to complete.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-bun-sqlite",
    label: "bun:sqlite",
    description:
      "SQLite state storage via @queuert/sqlite using Bun's built-in bun:sqlite module through a synchronous SqliteStateProvider — no external SQLite dependencies, and job creation and completion inside bun:sqlite's db.transaction with no lock.",
    runtime: "Bun",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-bun-sql",
    label: "Bun.SQL",
    description:
      "SQLite state storage via @queuert/sqlite using Bun's built-in SQL client in its sqlite:// mode — no external SQLite dependencies. The handler holds the provider's createAsyncRwLock() write lock around the transaction it passes to complete.",
    runtime: "Bun",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "mysql/state-mysql2",
    label: "mysql2",
    description:
      "MySQL state storage via @queuert/mysql with the mysql2 driver — job creation and completion inside application transactions, with the provider's transactions at READ COMMITTED.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: stateProviderFiles,
    guide: stateMysql,
  },
  {
    name: "mysql/state-mariadb",
    label: "mariadb",
    description:
      "MariaDB state storage via @queuert/mysql with the official mariadb connector — job creation and completion inside application transactions, with the provider's transactions at READ COMMITTED.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: stateProviderFiles,
    guide: stateMysql,
  },
  {
    name: "mysql/state-drizzle",
    label: "Drizzle ORM",
    description:
      "MySQL state storage via @queuert/mysql with Drizzle ORM — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: [...stateProviderFiles, "src/schema.ts"],
    guide: stateMysql,
  },
  {
    name: "mysql/state-kysely",
    label: "Kysely",
    description:
      "MySQL state storage via @queuert/mysql with Kysely — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: [...stateProviderFiles, "src/database.ts"],
    guide: stateMysql,
  },
  {
    name: "mysql/state-mikro-orm",
    label: "MikroORM",
    description:
      "MySQL state storage via @queuert/mysql with MikroORM — commit and rollback callbacks from MikroORM's transaction events, so calls take `{ em }` alone.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: providerFiles,
    guide: stateMysql,
  },
  {
    name: "mysql/state-prisma",
    label: "Prisma",
    description:
      "MySQL state storage via @queuert/mysql with Prisma ORM and its MariaDB driver adapter — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: ["src/provider.ts", "src/index.ts", "src/migrations.ts", "prisma/schema.prisma"],
    guide: stateMysql,
  },
  {
    name: "mysql/state-knex",
    label: "Knex",
    description:
      "MySQL state storage via @queuert/mysql with Knex — job creation and completion inside application transactions.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: stateProviderFiles,
    guide: stateMysql,
  },
  {
    name: "mysql/state-bun-sql",
    label: "Bun.SQL",
    description:
      "MySQL state storage via @queuert/mysql using Bun's built-in SQL client in its MySQL mode — job creation and completion inside application transactions, no external MySQL dependencies.",
    runtime: "Bun",
    services: ["MySQL"],
    files: stateProviderFiles,
    guide: stateMysql,
  },
  {
    name: "mysql/multi-worker",
    label: "multiple workers on MySQL",
    description:
      "Three worker processes (forked from the main process) share one MySQL database and compete for jobs, finding new work by polling because MySQL has no notify adapter — the main process creates orders and their chains in one transaction.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: ["src/index.ts", "src/worker.ts"],
    guide: { title: "Horizontal Scaling", href: "/guides/horizontal-scaling/" },
  },
  {
    name: "redis/state-ioredis",
    label: "ioredis",
    description:
      "Experimental Redis state storage via @queuert/redis with the ioredis client — a chain created in an optimistic transaction, with its side effect in onTransactionCommit because the callback may run more than once.",
    runtime: "Node.js",
    services: ["Redis"],
    files: providerFiles,
    guide: stateRedis,
  },
  {
    name: "redis/state-redis",
    label: "node-redis",
    description:
      "Experimental Redis state storage via @queuert/redis with the node-redis client — a chain created in an optimistic transaction, with its side effect in onTransactionCommit because the callback may run more than once.",
    runtime: "Node.js",
    services: ["Redis"],
    files: providerFiles,
    guide: stateRedis,
  },
  {
    name: "redis/multi-worker",
    label: "multiple workers on Redis",
    description:
      "Three worker processes (forked from the main process) share one Redis instance for state and compete for jobs, waking each other through the Redis notify adapter — the main process creates a chain per order in one optimistic transaction.",
    runtime: "Node.js",
    services: ["Redis"],
    files: ["src/index.ts", "src/worker.ts"],
    guide: { title: "Horizontal Scaling", href: "/guides/horizontal-scaling/" },
  },
  {
    name: "postgresql/notify-redis-ioredis",
    label: "Redis · ioredis",
    description: "Redis pub/sub notifications via @queuert/redis with the ioredis client.",
    runtime: "Node.js",
    services: ["PostgreSQL", "Redis"],
    files: providerFiles,
    guide: notifyRedis,
  },
  {
    name: "postgresql/notify-redis-redis",
    label: "Redis · node-redis",
    description: "Redis pub/sub notifications via @queuert/redis with the node-redis client.",
    runtime: "Node.js",
    services: ["PostgreSQL", "Redis"],
    files: providerFiles,
    guide: notifyRedis,
  },
  {
    name: "postgresql/notify-redis-cluster-ioredis",
    label: "Redis Cluster · ioredis",
    description: "Redis notifications against a Redis Cluster through an ioredis cluster client.",
    runtime: "Node.js",
    services: ["PostgreSQL", "Redis Cluster"],
    files: providerFiles,
    guide: notifyRedis,
  },
  {
    name: "postgresql/notify-redis-cluster-node-redis",
    label: "Redis Cluster · node-redis",
    description: "Redis notifications against a Redis Cluster through a node-redis cluster client.",
    runtime: "Node.js",
    services: ["PostgreSQL", "Redis Cluster"],
    files: providerFiles,
    guide: notifyRedis,
  },
  {
    name: "postgresql/notify-redis-bun",
    label: "Redis · Bun",
    description:
      "Redis pub/sub notifications via @queuert/redis using Bun's built-in RedisClient — no external Redis dependencies.",
    runtime: "Bun",
    services: ["PostgreSQL", "Redis"],
    files: providerFiles,
    guide: notifyRedis,
  },
  {
    name: "postgresql/notify-pg",
    label: "LISTEN/NOTIFY · pg",
    description:
      "PostgreSQL LISTEN/NOTIFY via @queuert/postgres with the pg (node-postgres) client.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: notifyPostgres,
  },
  {
    name: "postgresql/notify-postgres-js",
    label: "LISTEN/NOTIFY · postgres.js",
    description: "PostgreSQL LISTEN/NOTIFY via @queuert/postgres with the postgres-js client.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: notifyPostgres,
  },
  {
    name: "postgresql/notify-bun-sql",
    label: "LISTEN/NOTIFY · Bun.SQL",
    description:
      "PostgreSQL LISTEN/NOTIFY via @queuert/postgres using Bun's built-in SQL client — no external PostgreSQL dependencies.",
    runtime: "Bun",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: notifyPostgres,
  },
  {
    name: "postgresql/notify-nats",
    label: "NATS",
    description: "NATS core pub/sub notifications.",
    runtime: "Node.js",
    services: ["PostgreSQL", "NATS"],
    files: ["src/index.ts"],
    guide: notifyNats,
  },
  {
    name: "ipc/notify",
    label: "IPC",
    description:
      "IPC notifications via @queuert/ipc between a main process and a forked worker process sharing one SQLite database file through a synchronous SqliteStateProvider.",
    runtime: "Node.js",
    services: [],
    files: ["src/index.ts", "src/worker.ts"],
    guide: notifyIpc,
  },
  {
    name: "log/console",
    label: "createConsoleLog",
    description: "Queuert's built-in createConsoleLog() for simple console output.",
    runtime: "Node.js",
    services: [],
    files: ["src/index.ts"],
    guide: logging,
  },
  {
    name: "log/pino",
    label: "Pino",
    description:
      "Pino integration for structured logging, with per-job contextual loggers injected via attemptMiddleware.",
    runtime: "Node.js",
    services: [],
    files: ["src/log.ts", "src/index.ts"],
    guide: logging,
  },
  {
    name: "log/winston",
    label: "Winston",
    description:
      "Winston integration for structured logging, with per-job contextual loggers injected via attemptMiddleware.",
    runtime: "Node.js",
    services: [],
    files: ["src/log.ts", "src/index.ts"],
    guide: logging,
  },
  {
    name: "validation/zod",
    label: "Zod",
    description:
      "Custom validation adapter backed by Zod — covers nominal (by type name) and structural (by input shape) reference validation.",
    runtime: "Node.js",
    services: [],
    files: ["src/zod-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation/valibot",
    label: "Valibot",
    description:
      "Custom validation adapter backed by Valibot — covers nominal (by type name) and structural (by input shape) reference validation.",
    runtime: "Node.js",
    services: [],
    files: ["src/valibot-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation/typebox",
    label: "TypeBox",
    description:
      "Custom validation adapter backed by TypeBox — covers nominal (by type name) and structural (by input shape) reference validation.",
    runtime: "Node.js",
    services: [],
    files: ["src/typebox-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation/arktype",
    label: "ArkType",
    description:
      "Custom validation adapter backed by ArkType — covers nominal (by type name) and structural (by input shape) reference validation.",
    runtime: "Node.js",
    services: [],
    files: ["src/arktype-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation/codec-zod",
    label: "Zod codecs",
    description:
      "Zod 4 codec adapter — carries a Date through a chain while storing it as an ISO string, so handlers and client reads see runtime types and the database stays JSON-safe.",
    runtime: "Node.js",
    services: [],
    files: ["src/zod-codec-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation/codec-superjson",
    label: "superjson",
    description:
      "superjson codec adapter — one codec for every job type carries Date, Map, Set and bigint through a chain, with job types declared as plain TypeScript types.",
    runtime: "Node.js",
    services: [],
    files: ["src/superjson-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "observability/otel",
    label: "@queuert/otel",
    description: "@queuert/otel wiring for distributed tracing and metrics, viewed in otel-tui.",
    runtime: "Node.js",
    services: [],
    files: ["src/observability.ts", "src/index.ts"],
    commands: [
      { label: "Terminal 1: OTLP receiver", script: "tui" },
      { label: "Terminal 2: example", script: "start" },
    ],
    guide: { title: "OpenTelemetry", href: "/integrations/opentelemetry/" },
  },
  {
    name: "observability/dashboard",
    label: "@queuert/dashboard",
    description:
      "@queuert/dashboard embedded as a fetch handler with Node's built-in HTTP server. Run the populator to generate chains, jobs and workers, browse them through the web UI.",
    runtime: "Node.js",
    services: [],
    files: [
      "src/dashboard.ts",
      "src/dashboard-mounted.ts",
      "src/populator.ts",
      "src/scenarios.ts",
      "src/common.ts",
    ],
    commands: [
      { label: "Terminal 1: dashboard", script: "dashboard" },
      {
        label: "Terminal 1, alternative: mounted under a base path with Basic auth",
        script: "dashboard:mounted",
      },
      { label: "Terminal 2: populator", script: "start" },
    ],
    guide: { title: "Dashboard", href: "/integrations/dashboard/" },
  },
];

export const exampleUrl = (name: string) =>
  `https://github.com/kvet/queuert/tree/main/examples/${name}`;

export const exampleFileUrl = (name: string, file: string) =>
  `https://github.com/kvet/queuert/blob/main/examples/${name}/${file}`;

/** The example's directory under `examples/` with `/` replaced by `-`: its anchor id and package name suffix. */
export const exampleSlug = (name: string) => name.replaceAll("/", "-");

export const exampleCommands = (example: Example): { label?: string; command: string }[] =>
  (example.commands ?? [{ script: "start" }]).map((command) => ({
    label: "label" in command ? command.label : undefined,
    command: `pnpm --filter example-${exampleSlug(example.name)} ${command.script}`,
  }));

export const findExample = (name: string): Example => {
  const example = examples.find((candidate) => candidate.name === name);
  if (example === undefined) throw new Error(`Unknown example "${name}"`);
  return example;
};
