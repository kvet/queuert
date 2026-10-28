type SiteGroup = { label: string; slugs: string[] };

export type SiteSection = {
  id: "docs" | "examples" | "api" | "compare" | "benchmarks" | "changelog";
  label: string;
  href: string;
  groups: SiteGroup[];
};

export const apiPackages = [
  {
    label: "queuert",
    dir: "core",
    slug: "core",
    summary: "Client, worker, job types and the in-process adapters.",
  },
  {
    label: "queuert/conformance",
    dir: "core",
    slug: "conformance",
    entry: "src/conformance.ts",
    summary: "Conformance suites for custom adapters.",
  },
  {
    label: "@queuert/postgres",
    dir: "postgres",
    slug: "postgres",
    summary: "PostgreSQL state and notify adapters.",
  },
  { label: "@queuert/sqlite", dir: "sqlite", slug: "sqlite", summary: "SQLite state adapter." },
  { label: "@queuert/redis", dir: "redis", slug: "redis", summary: "Redis notify adapter." },
  { label: "@queuert/nats", dir: "nats", slug: "nats", summary: "NATS notify adapter." },
  {
    label: "@queuert/otel",
    dir: "otel",
    slug: "otel",
    summary: "OpenTelemetry metrics and tracing.",
  },
  {
    label: "@queuert/dashboard",
    dir: "dashboard",
    slug: "dashboard",
    summary: "Embeddable web dashboard.",
  },
] as const;

export const siteSections: SiteSection[] = [
  {
    id: "docs",
    label: "Docs",
    href: "/getting-started/introduction/",
    groups: [
      {
        label: "Getting Started",
        slugs: [
          "getting-started/introduction",
          "getting-started/installation",
          "getting-started/core-concepts",
        ],
      },
      {
        label: "Guides",
        slugs: [
          "guides/transaction-hooks",
          "guides/processing-reliability",
          "guides/chain-patterns",
          "guides/job-blockers",
          "guides/error-handling",
          "guides/timeouts",
          "guides/scheduling",
          "guides/deduplication",
          "guides/chain-awaiting",
          "guides/workerless-completion",
          "guides/chain-deletion",
          "guides/queries",
          "guides/cleanup",
          "guides/slices",
          "guides/horizontal-scaling",
          "guides/prioritization",
          "guides/middleware",
          "guides/runtime-validation",
        ],
      },
      {
        label: "Integrations",
        slugs: [
          "integrations/state-adapters",
          "integrations/notify-adapters",
          "integrations/validation-adapters",
          "integrations/observability",
          "integrations/dashboard",
        ],
      },
      {
        label: "Advanced",
        slugs: [
          "advanced/in-process-worker",
          "advanced/chain-model",
          "advanced/job-processing",
          "advanced/adapters",
          "advanced/job-type-references",
          "advanced/postgres-internals",
          "advanced/sqlite-internals",
          "advanced/redis-internals",
          "advanced/nats-internals",
          "advanced/logging",
          "advanced/otel-metrics",
          "advanced/otel-tracing",
          "advanced/otel-internals",
          "advanced/dashboard-internals",
          "advanced/custom-adapters",
        ],
      },
    ],
  },
  {
    id: "examples",
    label: "Examples",
    href: "/examples/",
    groups: [
      { label: "Overview", slugs: ["examples"] },
      {
        label: "Integrations",
        slugs: [
          "examples/state-adapters",
          "examples/notify-adapters",
          "examples/validation",
          "examples/logging-observability",
        ],
      },
      {
        label: "Showcases",
        slugs: [
          "examples/building-chains",
          "examples/scheduling",
          "examples/reliability",
          "examples/app-structure",
          "examples/operations",
        ],
      },
    ],
  },
  {
    id: "api",
    label: "API",
    href: "/api/",
    groups: [],
  },
  {
    id: "compare",
    label: "Compare",
    href: "/comparison/",
    groups: [
      {
        label: "Compare",
        slugs: [
          "comparison",
          "comparison/pg-boss",
          "comparison/bullmq",
          "comparison/temporal",
          "comparison/inngest",
        ],
      },
    ],
  },
  {
    id: "benchmarks",
    label: "Benchmarks",
    href: "/benchmarks/",
    groups: [
      { label: "Overview", slugs: ["benchmarks"] },
      {
        label: "Suites",
        slugs: [
          "benchmarks/processing-capacity",
          "benchmarks/memory-footprint",
          "benchmarks/query-performance",
          "benchmarks/type-complexity",
        ],
      },
    ],
  },
  {
    id: "changelog",
    label: "Changelog",
    href: "/changelog/",
    groups: [],
  },
];

export const sectionById = (id: SiteSection["id"]): SiteSection =>
  siteSections.find((section) => section.id === id)!;

export const sectionForPath = (pathname: string): SiteSection | undefined => {
  const path = pathname.replace(/^\/+/, "");
  if (path.startsWith("api")) return sectionById("api");
  if (path.startsWith("changelog")) return sectionById("changelog");
  return siteSections.find((section) =>
    section.groups.some((group) =>
      group.slugs.some((slug) => path === `${slug}/` || path === slug),
    ),
  );
};
