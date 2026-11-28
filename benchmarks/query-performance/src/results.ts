import { notMeasured } from "benchmark-results/results-file";
import { writePlansFile } from "benchmark-results/write-plans-file";
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
  writePlansFile({
    path: new URL(`../plans/${backend.toLowerCase()}.md`, import.meta.url).pathname,
    title: `${backend} query plans`,
    description: `Plans of every statement each query-performance case runs, at scale ${scale}, without cost and row estimates, and with IDs and timestamps replaced by placeholders. Rerun \`pnpm start\` after a query or index change and review the diff.`,
    sections: [...plans].map(([key, queries]) => ({
      heading: key,
      plans: queries.map(({ id, plan }) => ({
        label: id?.replace(/@[0-9a-f]+$/, "") ?? "dynamic",
        plan,
      })),
    })),
  });
};
