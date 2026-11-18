import { mkdirSync, writeFileSync } from "node:fs";

import { notMeasured } from "benchmark-results/results-file";
import { writeResultsFile } from "benchmark-results/write-results-file";
import {
  observabilityCoverageGroups,
  operationalCoverageGroups,
} from "queuert/conformance-internal";

const backends = ["PostgreSQL", "SQLite", "MySQL", "MariaDB", "Redis", "In-process"] as const;

const sections = [
  { title: "Operational queries", groups: operationalCoverageGroups },
  {
    title: "Type discovery & counts",
    groups: observabilityCoverageGroups.filter(
      ({ name }) => name.startsWith("get") || name.startsWith("count"),
    ),
  },
  {
    title: "List chains",
    groups: observabilityCoverageGroups.filter(({ name }) => name.startsWith("listChains >")),
  },
  {
    title: "List jobs",
    groups: observabilityCoverageGroups.filter(({ name }) => name.startsWith("listJobs >")),
  },
  {
    title: "List chain jobs & blocked jobs",
    groups: observabilityCoverageGroups.filter(({ name }) =>
      ["listChainJobs", "listBlockedJobs"].includes(name),
    ),
  },
  {
    title: "List workers & worker jobs",
    groups: observabilityCoverageGroups.filter(({ name }) =>
      ["listWorkers", "listWorkerJobs"].includes(name),
    ),
  },
];

export const writeQueryResults = (
  backend: (typeof backends)[number],
  scale: number,
  timings: Map<string, { p50: number; max: number }>,
): void => {
  const path = new URL("../results.md", import.meta.url).pathname;
  writeResultsFile({
    path,
    title: "Query performance",
    ran: `${backend} at scale ${scale}`,
    tables: (["p50", "max"] as const).flatMap((statistic) =>
      sections.map(({ title, groups }) => ({
        title: `${title}, ${statistic} (ms)`,
        columns: ["Query", ...backends],
        rows: groups
          .flatMap(({ cases }) => cases)
          .map(({ key }) => [
            key,
            ...backends.map((column) => {
              const timing = column === backend ? timings.get(key) : undefined;
              return timing === undefined ? notMeasured : timing[statistic].toFixed(2);
            }),
          ]),
      })),
    ),
  });
  console.log(`  Results written to ${path}`);
};

export type QueryPlan = { id: string | undefined; plan: string };

export const writeQueryPlans = (
  backend: (typeof backends)[number],
  scale: number,
  plans: Map<string, QueryPlan[]>,
): void => {
  const dir = new URL("../plans", import.meta.url).pathname;
  const path = `${dir}/${backend.toLowerCase()}.md`;
  const sections = [...plans].map(([key, queries]) =>
    [
      `## ${key}`,
      ...(queries.length === 0
        ? ["No query plans."]
        : queries.map(({ id, plan }, index) =>
            [
              `${index + 1}. \`${id?.replace(/@[0-9a-f]+$/, "") ?? "dynamic"}\``,
              "",
              "```",
              plan
                .trimEnd()
                .replaceAll(
                  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
                  "<uuid>",
                )
                .replaceAll(
                  /'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?'/g,
                  "'<timestamp>'",
                ),
              "```",
            ].join("\n"),
          )),
    ].join("\n\n"),
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path,
    [
      `# ${backend} query plans`,
      `Plans of every statement each query-performance case runs, at scale ${scale}, without cost and row estimates, and with IDs and timestamps replaced by placeholders. Rerun \`pnpm start\` after a query or index change and review the diff.`,
      ...sections,
    ].join("\n\n") + "\n",
  );
  console.log(`  Plans written to ${path}`);
};
