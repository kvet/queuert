type ApiPackageSource = {
  name: string;
  dir: string;
  entryPoints: { subpath?: string; slug: string; summary: string }[];
};

const apiPackages: ApiPackageSource[] = [
  {
    name: "queuert",
    dir: "core",
    entryPoints: [
      { slug: "core", summary: "Client, worker, job types and the in-process adapters." },
      {
        subpath: "conformance",
        slug: "conformance",
        summary: "Conformance suites for custom adapters.",
      },
    ],
  },
  {
    name: "@queuert/postgres",
    dir: "postgres",
    entryPoints: [
      { slug: "postgres", summary: "PostgreSQL state and notify adapters." },
      {
        subpath: "conformance",
        slug: "postgres-conformance",
        summary: "Conformance cases for PostgreSQL providers.",
      },
    ],
  },
  {
    name: "@queuert/sqlite",
    dir: "sqlite",
    entryPoints: [
      { slug: "sqlite", summary: "SQLite state adapter." },
      {
        subpath: "conformance",
        slug: "sqlite-conformance",
        summary: "Conformance cases for SQLite providers.",
      },
    ],
  },
  {
    name: "@queuert/mysql",
    dir: "mysql",
    entryPoints: [
      { slug: "mysql", summary: "MySQL and MariaDB state adapter." },
      {
        subpath: "conformance",
        slug: "mysql-conformance",
        summary: "Conformance cases for MySQL and MariaDB providers.",
      },
    ],
  },
  {
    name: "@queuert/redis",
    dir: "redis",
    entryPoints: [
      { slug: "redis", summary: "Redis notify adapter and experimental state adapter." },
      {
        subpath: "conformance",
        slug: "redis-conformance",
        summary: "Conformance cases for Redis providers.",
      },
    ],
  },
  {
    name: "@queuert/nats",
    dir: "nats",
    entryPoints: [{ slug: "nats", summary: "NATS notify adapter." }],
  },
  {
    name: "@queuert/ipc",
    dir: "ipc",
    entryPoints: [{ slug: "ipc", summary: "IPC notify adapter." }],
  },
  {
    name: "@queuert/otel",
    dir: "otel",
    entryPoints: [{ slug: "otel", summary: "OpenTelemetry metrics and tracing." }],
  },
  {
    name: "@queuert/dashboard",
    dir: "dashboard",
    entryPoints: [{ slug: "dashboard", summary: "Embeddable web dashboard." }],
  },
];

export type ApiEntryPoint = {
  label: string;
  subpath: string | undefined;
  packageName: string;
  dir: string;
  source: string;
  slug: string;
  summary: string;
};

export const apiEntryPoints: ApiEntryPoint[] = apiPackages.flatMap((pkg) =>
  pkg.entryPoints.map((entryPoint) => ({
    label: entryPoint.subpath === undefined ? pkg.name : `${pkg.name}/${entryPoint.subpath}`,
    subpath: entryPoint.subpath,
    packageName: pkg.name,
    dir: pkg.dir,
    source: `src/${entryPoint.subpath ?? "index"}.ts`,
    slug: entryPoint.slug,
    summary: entryPoint.summary,
  })),
);
