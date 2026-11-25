/** A group with an empty label is listed first without a heading. */
type SiteGroup = { label: string; slugs: string[] };

export type SiteSection = {
  id: "learn" | "guides" | "concepts" | "integrations" | "api" | "compare" | "blog" | "changelog";
  label: string;
  href: string;
  groups: SiteGroup[];
};

export const siteSections: SiteSection[] = [
  {
    id: "learn",
    label: "Learn",
    href: "/learn/",
    groups: [
      {
        label: "Learn",
        slugs: [
          "learn",
          "learn/what-is-queuert",
          "learn/first-chain",
          "learn/chains-in-your-transaction",
          "learn/continuing-a-chain",
          "learn/branching",
          "learn/errors-and-retries",
          "learn/use-it-in-your-app",
        ],
      },
    ],
  },
  {
    id: "guides",
    label: "Guides",
    href: "/guides/",
    groups: [
      { label: "", slugs: ["guides"] },
      {
        label: "Shape workflows",
        slugs: [
          "guides/chain-patterns",
          "guides/job-blockers",
          "guides/batched-processors",
          "guides/slices",
        ],
      },
      { label: "Handle failure", slugs: ["guides/error-handling", "guides/timeouts"] },
      {
        label: "Timing and load",
        slugs: [
          "guides/scheduling",
          "guides/deduplication",
          "guides/prioritization",
          "guides/horizontal-scaling",
        ],
      },
      {
        label: "Data and lifecycle",
        slugs: [
          "guides/chain-awaiting",
          "guides/workerless-outcomes",
          "guides/queries",
          "guides/chain-deletion",
          "guides/cleanup",
        ],
      },
      {
        label: "Extend",
        slugs: ["guides/middleware", "guides/tx-hooks", "guides/application-migrations"],
      },
    ],
  },
  {
    id: "concepts",
    label: "Concepts",
    href: "/how-it-works/glossary/",
    groups: [
      {
        label: "Concepts",
        slugs: [
          "how-it-works/glossary",
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
      { label: "", slugs: ["integrations"] },
      {
        label: "State adapters",
        slugs: [
          "integrations/state-adapters",
          "integrations/state-adapters/postgres",
          "integrations/state-adapters/sqlite",
          "integrations/state-adapters/mysql",
          "integrations/state-adapters/redis",
          "integrations/state-adapters/in-process",
          "integrations/state-adapters/custom",
        ],
      },
      {
        label: "Notify adapters",
        slugs: [
          "integrations/notify-adapters",
          "integrations/notify-adapters/postgres",
          "integrations/notify-adapters/redis",
          "integrations/notify-adapters/nats",
          "integrations/notify-adapters/ipc",
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
      { label: "", slugs: ["comparison"] },
      {
        label: "Benchmarks",
        slugs: [
          "benchmarks/processing-capacity",
          "benchmarks/query-performance",
          "benchmarks/type-complexity",
          "benchmarks/runtime-performance",
        ],
      },
      {
        label: "Alternatives",
        slugs: [
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
    id: "blog",
    label: "Blog",
    href: "/blog/",
    groups: [
      { label: "", slugs: ["blog"] },
      {
        label: "Posts",
        slugs: [
          "blog/one-body-sync-and-async",
          "blog/post-commit-side-effects",
          "blog/finishing-a-job",
          "blog/typing-job-chains",
          "blog/dual-write-problem",
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

/** The sections the top bar lists before the search box. The changelog is reached from the version badge instead. */
export const topBarSections = siteSections.filter(
  (section) => section.id !== "changelog" && section.id !== "blog",
);

export const blogSection = sectionById("blog");

export const drawerSections = [...topBarSections, blogSection];

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
