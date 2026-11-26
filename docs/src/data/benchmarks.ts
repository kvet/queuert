import {
  type ResultsTable,
  environmentTableTitle,
  notMeasured,
  parseResultsFile,
} from "benchmark-results/results-file";

import type { BenchGroup } from "../components/BenchChart.tsx";
import type { KeyValueItem } from "../components/KeyValueList.tsx";
import type { Backend } from "../stack.ts";

const resultsFiles = import.meta.glob<string>("../../../benchmarks/*/results.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const resultsTable = (suite: string, title: string): ResultsTable => {
  const markdown = resultsFiles[`../../../benchmarks/${suite}/results.md`];
  if (markdown === undefined) {
    throw new Error(`benchmarks/${suite}/results.md is missing`);
  }
  const table = parseResultsFile(markdown).find((candidate) => candidate.title === title);
  if (table === undefined) {
    throw new Error(`benchmarks/${suite}/results.md has no "${title}" table`);
  }
  return table;
};

const valuesOf = (table: ResultsTable, label: string, columns: string[]): number[] => {
  const row = table.rows.find((candidate) => candidate[0] === label);
  if (row === undefined) {
    throw new Error(`"${table.title}" has no "${label}" row`);
  }
  return columns.map((column) => {
    const cell = row[table.columns.indexOf(column)];
    if (cell === undefined || cell === notMeasured || Number.isNaN(Number(cell))) {
      throw new Error(`"${table.title}" has no "${column}" value for "${label}"`);
    }
    return Number(cell);
  });
};

const stateAdapters = [
  { label: "PostgreSQL (postgres-js)", backend: "postgres" },
  { label: "PostgreSQL (pg)", backend: "postgres" },
  { label: "SQLite (better-sqlite3)", backend: "sqlite" },
  { label: "SQLite (node:sqlite)", backend: "sqlite" },
  { label: "MySQL (mysql2)", backend: "mysql" },
  { label: "MariaDB (mysql2)", backend: "mariadb" },
  { label: "Redis (redis)", backend: "redis" },
  { label: "Redis (ioredis)", backend: "redis" },
  { label: "In-process", backend: "in-process" },
] satisfies { label: string; backend: Backend }[];

const notifyAdapters = [
  { label: "PostgreSQL (pg)", backend: "postgres" },
  { label: "PostgreSQL (postgres-js)", backend: "postgres" },
  { label: "Redis (redis)", backend: "redis" },
  { label: "Redis (ioredis)", backend: "redis" },
  { label: "NATS", backend: "nats" },
  { label: "IPC", backend: "ipc" },
  { label: "In-process", backend: "in-process" },
] satisfies { label: string; backend: Backend }[];

const capacityGroups = (title: string, columns: string[]): BenchGroup[] =>
  [
    { label: "State adapter (noop notify)", adapters: stateAdapters },
    { label: "Notify adapter (in-process state)", adapters: notifyAdapters },
  ].map(({ label, adapters }) => {
    const table = resultsTable("processing-capacity", `${title}: ${label}`);
    return {
      label,
      rows: adapters.map((adapter) => ({
        ...adapter,
        values: valuesOf(table, adapter.label, columns),
      })),
    };
  });

export const creationGroups = capacityGroups("Creation (chains/s)", ["Single", "Batched (100)"]);

export const completionGroups = capacityGroups("Completion, no-op handler (jobs/s)", [
  "1 slot",
  "4 slots",
  "16 slots",
]);

export const batchedCompletionGroups = capacityGroups(
  "Completion, batched no-op handler (100 per batch, jobs/s)",
  ["1 slot", "4 slots", "16 slots"],
);

const runtimeMeasurements: { label: string; backend?: Backend }[] = [
  { label: "notify-redis", backend: "redis" },
  { label: "notify-postgres", backend: "postgres" },
  { label: "notify-nats", backend: "nats" },
  { label: "notify-ipc", backend: "ipc" },
  { label: "state-in-process", backend: "in-process" },
  { label: "state-sqlite", backend: "sqlite" },
  { label: "state-postgres", backend: "postgres" },
  { label: "state-mysql", backend: "mysql" },
  { label: "state-mariadb", backend: "mariadb" },
  { label: "state-redis", backend: "redis" },
  { label: "dashboard" },
  { label: "otel" },
];

const runtimeGroups = (title: string, columns: string[]): BenchGroup[] => {
  const table = resultsTable("runtime-performance", title);
  return [
    {
      rows: runtimeMeasurements.map((measurement) => ({
        ...measurement,
        values: valuesOf(table, measurement.label, columns),
      })),
    },
  ];
};

export const memoryGroups = runtimeGroups("Memory (KB)", [
  "Setup",
  "In-flight peak",
  "Live JS retained",
  "JIT code retained",
]);

export const cpuGroups = runtimeGroups("CPU per job (µs)", [
  "Queuert core",
  "Adapter",
  "Dependencies",
  "Runtime",
]);

export const allocationGroups = runtimeGroups("Allocated per job (KB)", ["Allocated"]);

const registries = [
  "defineJobTypes",
  "Zod",
  "Valibot",
  "TypeBox",
  "ArkType",
  "Zod codec",
  "superjson codec",
];

const registryGroups = (title: string, column: string): BenchGroup[] => {
  const table = resultsTable("runtime-performance", title);
  return [
    { rows: registries.map((label) => ({ label, values: valuesOf(table, label, [column]) })) },
  ];
};

export const validationCpuGroups = registryGroups(
  "Schema library CPU per job (µs)",
  "Schema library",
);

export const validationAllocationGroups = registryGroups(
  "Allocated per job by registry (KB)",
  "Allocated",
);

const typeCheckTimes = resultsTable("type-complexity", "Type-check time (ms)");
const instantiations = resultsTable("type-complexity", "Instantiations");

/** Type-check time in ms per compiler (TS 6, TS 7, tsrs) and TS 7's instantiation count. */
const typeScenarios = [
  "Linear: 1 type",
  "Linear: 10 types",
  "Linear: 50 types",
  "Linear: 100 types",
  "Branched: 4w x 3d",
  "Branched: 2w x 6d",
  "Blockers: 8 steps",
  "Blockers: 25 steps",
  "Loop: 20 steps",
  "Loop: 50 steps",
  "Merge: 2 x 50",
  "Merge: 5 x 50",
  "Merge: 10 x 50",
  "Merge: 20 x 50",
  "Merge: 50 x 50",
  "Middleware: 10 on linear-100",
].map((label) => {
  const [types, count] = valuesOf(instantiations, label, ["Job types", "TS 7"]);
  return {
    label,
    types,
    instantiations: count,
    values: valuesOf(typeCheckTimes, label, ["TS 6", "TS 7", "tsrs"]),
  };
});

export const typeGroups = [
  { rows: typeScenarios.map((scenario) => ({ label: scenario.label, values: scenario.values })) },
] satisfies BenchGroup[];

/** Instantiations, with each scenario's type count and its scaling against the one-type baseline. */
export const instantiationGroups = [
  {
    rows: typeScenarios.map((scenario) => ({
      label: scenario.label,
      meta: `${scenario.types.toLocaleString("en-US")} ${scenario.types === 1 ? "type" : "types"} · ${(scenario.instantiations / typeScenarios[0].instantiations).toFixed(1)}x baseline`,
      values: [scenario.instantiations],
    })),
  },
] satisfies BenchGroup[];

const queryBackends = ["PostgreSQL", "SQLite", "MySQL", "MariaDB", "Redis", "In-process"];

const queryRows = (title: string, prefix = "") => {
  const table = resultsTable("query-performance", `${title}, p50 (ms)`);
  const rows = table.rows
    .filter(([label]) => label.startsWith(prefix))
    .map(([label]) => ({ label, values: valuesOf(table, label, queryBackends) }));
  if (rows.length === 0) {
    throw new Error(`"${table.title}" has no "${prefix}" rows`);
  }
  return rows;
};

export const operationalGroups = [
  { rows: queryRows("Operational queries") },
] satisfies BenchGroup[];

export const discoveryGroups = [
  { rows: queryRows("Type discovery & counts") },
] satisfies BenchGroup[];

export const listChainsGroups = [
  { label: "No status filter", rows: queryRows("List chains", "listChains/noStatus/") },
  { label: "Running", rows: queryRows("List chains", "listChains/running/") },
  { label: "Completed", rows: queryRows("List chains", "listChains/completed/") },
] satisfies BenchGroup[];

export const listJobsGroups = [
  { label: "No status filter", rows: queryRows("List jobs", "listJobs/noStatus/") },
  { label: "Pending", rows: queryRows("List jobs", "listJobs/pending/") },
  { label: "Blocked", rows: queryRows("List jobs", "listJobs/blocked/") },
  { label: "Running", rows: queryRows("List jobs", "listJobs/running/") },
  { label: "Completed", rows: queryRows("List jobs", "listJobs/completed/") },
] satisfies BenchGroup[];

export const chainJobsGroups = [
  { rows: queryRows("List chain jobs & blocked jobs") },
] satisfies BenchGroup[];

export const workerGroups = [
  { rows: queryRows("List workers & worker jobs") },
] satisfies BenchGroup[];

export const benchmarkEnvironment = (
  suite: string,
): { label: string; value: string; note?: string }[] =>
  resultsTable(suite, environmentTableTitle).rows.map(([label, value]) =>
    label === "Containers"
      ? {
          label,
          value,
          note: "Databases and pub/sub servers run in containers limited to 4 GB and 8 CPUs each, so every round trip crosses the VM bridge.",
        }
      : { label, value },
  );

export const benchmarkServers = {
  label: "Servers",
  value: "PostgreSQL 18, SQLite 3.53, MySQL 26, MariaDB 13, Redis 8, NATS 2",
} satisfies KeyValueItem;

/** One series of every row, so a chart compares the rows on a single scenario. */
export const seriesOf = (groups: BenchGroup[], index: number): BenchGroup[] =>
  groups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => ({ ...row, values: [row.values[index]] })),
  }));

export const benchmarkSourceUrl = (suite: string) =>
  `https://github.com/kvet/queuert/tree/main/benchmarks/${suite}`;

export const benchmarkSummaryColumns = [
  { label: "Create", detail: "single", unit: "chains/s" },
  { label: "Create", detail: "batch of 100", unit: "chains/s" },
  { label: "Complete", detail: "single", unit: "jobs/s" },
  { label: "Complete", detail: "batch of 100", unit: "jobs/s" },
];

const summaryAdapters = [
  "PostgreSQL (pg)",
  "SQLite (better-sqlite3)",
  "MySQL (mysql2)",
  "MariaDB (mysql2)",
  "Redis (redis)",
  "In-process",
];

const stateRow = (groups: BenchGroup[], label: string) =>
  groups[0].rows.find((row) => row.label === label)!;

/** Each state adapter's creation and completion throughput, completion by one worker with 16 slots. */
export const benchmarkSummary = summaryAdapters.map((label) => {
  const creation = stateRow(creationGroups, label);
  return {
    label,
    values: [
      creation.values[0],
      creation.values[1],
      stateRow(completionGroups, label).values[2],
      stateRow(batchedCompletionGroups, label).values[2],
    ],
  };
});
