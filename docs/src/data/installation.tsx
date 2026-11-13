import type { JSX } from "solid-js";

export type InstallOption = {
  /** The option's label, also its value in the synced `state` / `notify` tab store. */
  label: string;
  /** Packages added to the install command; already-listed packages are not repeated. */
  packages: string[];
  note: JSX.Element;
  /** What is experimental (the package, or the part of it), when the option is experimental. */
  experimental?: JSX.Element;
};

const redisNotify: InstallOption = {
  label: "Redis",
  packages: ["@queuert/redis"],
  note: (
    <>
      Uses Redis pub/sub. Requires Redis 6+. See{" "}
      <a href="/queuert/integrations/notify-adapters/redis/">Redis Notify Adapter</a>.
    </>
  ),
};

const natsNotify: InstallOption = {
  label: "NATS",
  packages: ["@queuert/nats", "@nats-io/nats-core", "@nats-io/transport-node"],
  experimental: <code>@queuert/nats</code>,
  note: (
    <>
      Uses NATS pub/sub. Requires NATS 2.2+. See{" "}
      <a href="/queuert/integrations/notify-adapters/nats/">NATS Notify Adapter</a>.
    </>
  ),
};

const noNotify: InstallOption = {
  label: "None",
  packages: [],
  note: (
    <>
      No extra packages or infrastructure required. The client wakes its own worker runners in
      memory, and workers in other processes poll the database on a configurable interval. See{" "}
      <a href="/queuert/integrations/notify-adapters/#default">Without a notify adapter</a>.
    </>
  ),
};

export const stateInstallOptions: (InstallOption & { notify: InstallOption[] })[] = [
  {
    label: "PostgreSQL",
    packages: ["@queuert/postgres"],
    note: (
      <>
        Supports horizontal scaling and all Queuert features. Requires PostgreSQL 14+. See{" "}
        <a href="/queuert/integrations/state-adapters/postgres/">PostgreSQL State Adapter</a>.
      </>
    ),
    notify: [
      {
        label: "PostgreSQL LISTEN/NOTIFY",
        packages: ["@queuert/postgres"],
        note: (
          <>
            Uses PostgreSQL's built-in <code>LISTEN</code>/<code>NOTIFY</code>. No additional
            infrastructure beyond your existing PostgreSQL database — already included in{" "}
            <code>@queuert/postgres</code>. See{" "}
            <a href="/queuert/integrations/notify-adapters/postgres/">PostgreSQL Notify Adapter</a>.
          </>
        ),
      },
      redisNotify,
      natsNotify,
      noNotify,
    ],
  },
  {
    label: "SQLite",
    packages: ["@queuert/sqlite"],
    note: (
      <>
        Suitable for local development, CLI tools, and embedded applications. Requires SQLite 3.42+.
        See <a href="/queuert/integrations/state-adapters/sqlite/">SQLite State Adapter</a>.
      </>
    ),
    notify: [redisNotify, natsNotify, noNotify],
  },
  {
    label: "MySQL / MariaDB",
    packages: ["@queuert/mysql"],
    experimental: <code>@queuert/mysql</code>,
    note: (
      <>
        For applications whose data lives in MySQL or MariaDB. Requires MySQL 8.4+ or MariaDB 11.4+
        (InnoDB). See{" "}
        <a href="/queuert/integrations/state-adapters/mysql/">MySQL / MariaDB State Adapter</a>.
      </>
    ),
    notify: [redisNotify, natsNotify, noNotify],
  },
  {
    label: "Redis",
    packages: ["@queuert/redis"],
    experimental: (
      <>
        The Redis state adapter in <code>@queuert/redis</code>
      </>
    ),
    note: (
      <>
        Queuert's state on Redis or Redis Cluster, kept apart from your application database.
        Requires Redis 6+. See{" "}
        <a href="/queuert/integrations/state-adapters/redis/">Redis State Adapter</a>.
      </>
    ),
    notify: [redisNotify, natsNotify, noNotify],
  },
];

export const extraInstallOptions = [
  {
    label: "Dashboard",
    packages: ["@queuert/dashboard"],
    note: "Embeddable web UI for job observation",
  },
  {
    label: "OpenTelemetry",
    packages: ["@queuert/otel"],
    note: "OpenTelemetry metrics and tracing",
  },
];

export const packageManagers = [
  { label: "npm", install: "npm install" },
  { label: "pnpm", install: "pnpm add" },
  { label: "yarn", install: "yarn add" },
];

/** The one command that installs `queuert` and every picked package, each named once. */
export const installCommand = (install: string, packages: string[]) =>
  `${install} ${[...new Set(["queuert", ...packages])].join(" ")}`;
