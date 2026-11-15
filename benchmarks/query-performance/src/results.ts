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
