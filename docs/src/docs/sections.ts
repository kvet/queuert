type SiteGroup = { label: string; slugs: string[] };

export type SiteSection = {
  id: "docs" | "integrations" | "examples" | "api" | "compare" | "benchmarks" | "changelog";
  label: string;
  href: string;
  groups: SiteGroup[];
};

export const apiPackages = [
  {
    label: "queuert",
    dir: "core",
    slug: "core",
    summary: "Client, worker runner and job types.",
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
          "guides/tx-hooks",
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
        label: "How It Works",
        slugs: [
          "how-it-works/chain-model",
          "how-it-works/job-processing",
          "how-it-works/processing-reliability",
          "how-it-works/worker-runner",
          "how-it-works/job-type-references",
        ],
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    href: "/integrations/",
    groups: [
      { label: "Overview", slugs: ["integrations"] },
      {
        label: "State Adapters",
        slugs: [
          "integrations/state-adapters",
          "integrations/state-adapters/postgres",
          "integrations/state-adapters/sqlite",
          "integrations/state-adapters/custom",
        ],
      },
      {
        label: "Notify Adapters",
        slugs: [
          "integrations/notify-adapters",
          "integrations/notify-adapters/postgres",
          "integrations/notify-adapters/redis",
          "integrations/notify-adapters/nats",
          "integrations/notify-adapters/custom",
        ],
      },
      {
        label: "Validation",
        slugs: ["integrations/validation", "integrations/validation/custom"],
      },
      {
        label: "Observability",
        slugs: [
          "integrations/observability",
          "integrations/logging",
          "integrations/opentelemetry",
          "integrations/opentelemetry/metrics",
          "integrations/opentelemetry/tracing",
          "integrations/dashboard",
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
          "comparison/graphile-worker",
          "comparison/bullmq",
          "comparison/dbos",
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
          "benchmarks/query-performance",
          "benchmarks/type-complexity",
          "benchmarks/runtime-performance",
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
