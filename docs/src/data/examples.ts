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
  title: "PostgreSQL state adapter",
  href: "/integrations/state-adapters/postgres/",
};
const stateSqlite = { title: "SQLite state adapter", href: "/integrations/state-adapters/sqlite/" };
const stateMysql = {
  title: "MySQL / MariaDB state adapter",
  href: "/integrations/state-adapters/mysql/",
};
const stateRedis = { title: "Redis state adapter", href: "/integrations/state-adapters/redis/" };
const notifyPostgres = {
  title: "PostgreSQL notify adapter",
  href: "/integrations/notify-adapters/postgres/",
};
const notifyRedis = { title: "Redis notify adapter", href: "/integrations/notify-adapters/redis/" };
const notifyNats = { title: "NATS notify adapter", href: "/integrations/notify-adapters/nats/" };
const notifyIpc = { title: "IPC notify adapter", href: "/integrations/notify-adapters/ipc/" };
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
    description: "The pg (node-postgres) driver.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: stateProviderFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/state-postgres-js",
    label: "postgres.js",
    description: "The postgres.js driver.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: stateProviderFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/state-drizzle",
    label: "Drizzle ORM",
    description: "Drizzle ORM.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: [...stateProviderFiles, "src/schema.ts"],
    guide: statePostgres,
  },
  {
    name: "postgresql/state-kysely",
    label: "Kysely",
    description: "Kysely.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: [...stateProviderFiles, "src/database.ts"],
    guide: statePostgres,
  },
  {
    name: "postgresql/state-mikro-orm",
    label: "MikroORM",
    description: "MikroORM, with commit and rollback callbacks from its transaction events.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/state-prisma",
    label: "Prisma",
    description: "Prisma ORM.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/provider.ts", "src/index.ts", "src/migrations.ts", "prisma/schema.prisma"],
    guide: statePostgres,
  },
  {
    name: "postgresql/state-knex",
    label: "Knex",
    description: "Knex.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: stateProviderFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/state-bun-sql",
    label: "Bun.SQL",
    description: "Bun's built-in SQL client.",
    runtime: "Bun",
    services: ["PostgreSQL"],
    files: stateProviderFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/state-pglite",
    label: "PGlite",
    description: "PGlite, PostgreSQL in-process on WebAssembly, with a single-connection provider.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: statePostgres,
  },
  {
    name: "postgresql/multi-worker",
    label: "multiple workers",
    description: "Three forked worker processes compete for jobs in one PostgreSQL database.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: ["src/index.ts", "src/worker.ts"],
    guide: { title: "Horizontal scaling", href: "/guides/horizontal-scaling/" },
  },
  {
    name: "sqlite/multi-worker",
    label: "multiple workers on SQLite",
    description:
      "Three forked worker processes share one SQLite file and wake each other through IPC.",
    runtime: "Node.js",
    services: [],
    files: ["src/index.ts", "src/worker.ts"],
    guide: { title: "Horizontal scaling", href: "/guides/horizontal-scaling/" },
  },
  {
    name: "sqlite/state-better-sqlite3",
    label: "better-sqlite3",
    description: "better-sqlite3 through a synchronous provider, with no lock.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-node-sqlite",
    label: "node:sqlite",
    description: "Node's built-in node:sqlite through a synchronous provider, with no lock.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-drizzle",
    label: "Drizzle ORM",
    description: "Drizzle ORM over better-sqlite3 through a synchronous provider.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-kysely",
    label: "Kysely",
    description: "Kysely, whose size-1 connection pool already serializes writers.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-mikro-orm",
    label: "MikroORM",
    description: "MikroORM, whose SQLite driver holds one connection per transaction.",
    runtime: "Node.js",
    services: [],
    files: providerFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-prisma",
    label: "Prisma",
    description: "Prisma ORM, with createAsyncRwLock() serializing writes.",
    runtime: "Node.js",
    services: [],
    files: ["src/provider.ts", "src/index.ts", "src/migrations.ts", "prisma/schema.prisma"],
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-knex",
    label: "Knex",
    description: "Knex, whose size-1 connection pool already serializes writers.",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-bun-sqlite",
    label: "bun:sqlite",
    description: "Bun's built-in bun:sqlite through a synchronous provider.",
    runtime: "Bun",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-bun-sql",
    label: "Bun.SQL",
    description: "Bun's built-in SQL client in sqlite:// mode, with createAsyncRwLock().",
    runtime: "Bun",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "sqlite/state-sql-js",
    label: "sql.js",
    description: "sql.js, SQLite in-process on WebAssembly, with createAsyncRwLock().",
    runtime: "Node.js",
    services: [],
    files: stateProviderFiles,
    guide: stateSqlite,
  },
  {
    name: "mysql/state-mysql2",
    label: "mysql2",
    description: "The mysql2 driver.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: stateProviderFiles,
    guide: stateMysql,
  },
  {
    name: "mysql/state-mariadb",
    label: "mariadb",
    description: "The official mariadb connector.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: stateProviderFiles,
    guide: stateMysql,
  },
  {
    name: "mysql/state-drizzle",
    label: "Drizzle ORM",
    description: "Drizzle ORM.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: [...stateProviderFiles, "src/schema.ts"],
    guide: stateMysql,
  },
  {
    name: "mysql/state-kysely",
    label: "Kysely",
    description: "Kysely.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: [...stateProviderFiles, "src/database.ts"],
    guide: stateMysql,
  },
  {
    name: "mysql/state-mikro-orm",
    label: "MikroORM",
    description: "MikroORM, with commit and rollback callbacks from its transaction events.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: providerFiles,
    guide: stateMysql,
  },
  {
    name: "mysql/state-prisma",
    label: "Prisma",
    description: "Prisma ORM with its MariaDB driver adapter.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: ["src/provider.ts", "src/index.ts", "src/migrations.ts", "prisma/schema.prisma"],
    guide: stateMysql,
  },
  {
    name: "mysql/state-knex",
    label: "Knex",
    description: "Knex.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: stateProviderFiles,
    guide: stateMysql,
  },
  {
    name: "mysql/state-bun-sql",
    label: "Bun.SQL",
    description: "Bun's built-in SQL client in MySQL mode.",
    runtime: "Bun",
    services: ["MySQL"],
    files: stateProviderFiles,
    guide: stateMysql,
  },
  {
    name: "mysql/multi-worker",
    label: "multiple workers on MySQL",
    description: "Three forked worker processes share one MySQL database and poll for new work.",
    runtime: "Node.js",
    services: ["MySQL"],
    files: ["src/index.ts", "src/worker.ts"],
    guide: { title: "Horizontal scaling", href: "/guides/horizontal-scaling/" },
  },
  {
    name: "redis/state-ioredis",
    label: "ioredis",
    description: "The ioredis client, with a chain created in an optimistic transaction.",
    runtime: "Node.js",
    services: ["Redis"],
    files: providerFiles,
    guide: stateRedis,
  },
  {
    name: "redis/state-redis",
    label: "node-redis",
    description: "The node-redis client, with a chain created in an optimistic transaction.",
    runtime: "Node.js",
    services: ["Redis"],
    files: providerFiles,
    guide: stateRedis,
  },
  {
    name: "redis/multi-worker",
    label: "multiple workers on Redis",
    description:
      "Three forked worker processes share one Redis instance and wake each other through the Redis notify adapter.",
    runtime: "Node.js",
    services: ["Redis"],
    files: ["src/index.ts", "src/worker.ts"],
    guide: { title: "Horizontal scaling", href: "/guides/horizontal-scaling/" },
  },
  {
    name: "postgresql/notify-redis-ioredis",
    label: "Redis · ioredis",
    description: "Redis pub/sub with the ioredis client.",
    runtime: "Node.js",
    services: ["PostgreSQL", "Redis"],
    files: providerFiles,
    guide: notifyRedis,
  },
  {
    name: "postgresql/notify-redis-redis",
    label: "Redis · node-redis",
    description: "Redis pub/sub with the node-redis client.",
    runtime: "Node.js",
    services: ["PostgreSQL", "Redis"],
    files: providerFiles,
    guide: notifyRedis,
  },
  {
    name: "postgresql/notify-redis-cluster-ioredis",
    label: "Redis Cluster · ioredis",
    description: "Redis Cluster through an ioredis cluster client.",
    runtime: "Node.js",
    services: ["PostgreSQL", "Redis Cluster"],
    files: providerFiles,
    guide: notifyRedis,
  },
  {
    name: "postgresql/notify-redis-cluster-node-redis",
    label: "Redis Cluster · node-redis",
    description: "Redis Cluster through a node-redis cluster client.",
    runtime: "Node.js",
    services: ["PostgreSQL", "Redis Cluster"],
    files: providerFiles,
    guide: notifyRedis,
  },
  {
    name: "postgresql/notify-redis-bun",
    label: "Redis · Bun",
    description: "Redis pub/sub with Bun's built-in RedisClient.",
    runtime: "Bun",
    services: ["PostgreSQL", "Redis"],
    files: providerFiles,
    guide: notifyRedis,
  },
  {
    name: "postgresql/notify-pg",
    label: "LISTEN/NOTIFY · pg",
    description: "LISTEN/NOTIFY with the pg (node-postgres) client.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: notifyPostgres,
  },
  {
    name: "postgresql/notify-postgres-js",
    label: "LISTEN/NOTIFY · postgres.js",
    description: "LISTEN/NOTIFY with the postgres.js client.",
    runtime: "Node.js",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: notifyPostgres,
  },
  {
    name: "postgresql/notify-bun-sql",
    label: "LISTEN/NOTIFY · Bun.SQL",
    description: "LISTEN/NOTIFY with Bun's built-in SQL client.",
    runtime: "Bun",
    services: ["PostgreSQL"],
    files: providerFiles,
    guide: notifyPostgres,
  },
  {
    name: "postgresql/notify-nats",
    label: "NATS",
    description: "NATS core pub/sub.",
    runtime: "Node.js",
    services: ["PostgreSQL", "NATS"],
    files: ["src/index.ts"],
    guide: notifyNats,
  },
  {
    name: "ipc/notify",
    label: "IPC",
    description: "A main process and a forked worker share one SQLite file.",
    runtime: "Node.js",
    services: [],
    files: ["src/index.ts", "src/worker.ts"],
    guide: notifyIpc,
  },
  {
    name: "log/console",
    label: "createConsoleLog",
    description: "The built-in createConsoleLog() for console output.",
    runtime: "Node.js",
    services: [],
    files: ["src/index.ts"],
    guide: logging,
  },
  {
    name: "log/pino",
    label: "Pino",
    description: "Pino, with loggers bound to each handler call's jobs.",
    runtime: "Node.js",
    services: [],
    files: ["src/log.ts", "src/index.ts"],
    guide: logging,
  },
  {
    name: "log/winston",
    label: "Winston",
    description: "Winston, with loggers bound to each handler call's jobs.",
    runtime: "Node.js",
    services: [],
    files: ["src/log.ts", "src/index.ts"],
    guide: logging,
  },
  {
    name: "validation/zod",
    label: "Zod",
    description: "Nominal and structural reference validation with Zod.",
    runtime: "Node.js",
    services: [],
    files: ["src/zod-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation/valibot",
    label: "Valibot",
    description: "Nominal and structural reference validation with Valibot.",
    runtime: "Node.js",
    services: [],
    files: ["src/valibot-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation/typebox",
    label: "TypeBox",
    description: "Nominal and structural reference validation with TypeBox.",
    runtime: "Node.js",
    services: [],
    files: ["src/typebox-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation/arktype",
    label: "ArkType",
    description: "Nominal and structural reference validation with ArkType.",
    runtime: "Node.js",
    services: [],
    files: ["src/arktype-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation/codec-zod",
    label: "Zod codecs",
    description: "A Zod 4 codec that carries a Date as an ISO string.",
    runtime: "Node.js",
    services: [],
    files: ["src/zod-codec-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "validation/codec-superjson",
    label: "superjson",
    description: "One superjson codec carrying Date, Map, Set and bigint.",
    runtime: "Node.js",
    services: [],
    files: ["src/superjson-adapter.ts", "src/index.ts"],
    guide: validationAdapters,
  },
  {
    name: "observability/otel",
    label: "@queuert/otel",
    description: "Traces and metrics viewed in otel-tui.",
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
      "The dashboard embedded as a fetch handler on Node's HTTP server, with a populator.",
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
