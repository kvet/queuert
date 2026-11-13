import type { BenchGroup } from "../components/BenchChart.tsx";
import type { KeyValueItem } from "../components/KeyValueList.tsx";

export const creationGroups = [
  {
    label: "State adapter (noop notify)",
    rows: [
      { label: "In-process (sync)", backend: "in-process", values: [298602, 428016] },
      { label: "SQLite (better-sqlite3)", backend: "sqlite", values: [35695, 95406] },
      { label: "SQLite (node:sqlite)", backend: "sqlite", values: [37742, 82585] },
      { label: "PostgreSQL (postgres-js)", backend: "postgres", values: [1061, 25792] },
      { label: "PostgreSQL (pg)", backend: "postgres", values: [899, 23068] },
      { label: "MySQL (mysql2)", backend: "mysql", values: [484, 11558] },
      { label: "MariaDB (mysql2)", backend: "mariadb", values: [434, 13974] },
      { label: "Redis (redis)", backend: "redis", values: [2945, 24985] },
      { label: "Redis (ioredis)", backend: "redis", values: [2895, 24132] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process (sync)", backend: "in-process", values: [225333, 299870] },
      { label: "Redis (redis)", backend: "redis", values: [5221, 162138] },
      { label: "Redis (ioredis)", backend: "redis", values: [5169, 160189] },
      { label: "PostgreSQL (pg)", backend: "postgres", values: [4202, 149535] },
      { label: "PostgreSQL (postgres-js)", backend: "postgres", values: [4693, 154564] },
      { label: "NATS", backend: "nats", values: [4777, 160229] },
      { label: "IPC", backend: "ipc", values: [220314, 248956] },
    ],
  },
] satisfies BenchGroup[];

export const completionGroups = [
  {
    label: "State adapter (noop notify)",
    rows: [
      { label: "In-process (sync)", backend: "in-process", values: [105572, 101548, 101041] },
      { label: "SQLite (better-sqlite3)", backend: "sqlite", values: [13169, 15478, 15974] },
      { label: "SQLite (node:sqlite)", backend: "sqlite", values: [11765, 14285, 15342] },
      { label: "PostgreSQL (postgres-js)", backend: "postgres", values: [494, 1333, 2590] },
      { label: "PostgreSQL (pg)", backend: "postgres", values: [458, 1107, 2676] },
      { label: "MySQL (mysql2)", backend: "mysql", values: [177, 490, 1293] },
      { label: "MariaDB (mysql2)", backend: "mariadb", values: [182, 459, 1289] },
      { label: "Redis (redis)", backend: "redis", values: [940, 2436, 4576] },
      { label: "Redis (ioredis)", backend: "redis", values: [1151, 2891, 6873] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process (sync)", backend: "in-process", values: [62444, 88456, 91548] },
      { label: "Redis (redis)", backend: "redis", values: [1667, 5642, 16458] },
      { label: "Redis (ioredis)", backend: "redis", values: [1652, 9225, 29435] },
      { label: "PostgreSQL (pg)", backend: "postgres", values: [1461, 10534, 14927] },
      { label: "PostgreSQL (postgres-js)", backend: "postgres", values: [1477, 10873, 16067] },
      { label: "NATS", backend: "nats", values: [3697, 11970, 28704] },
      { label: "IPC", backend: "ipc", values: [69784, 78932, 81992] },
    ],
  },
] satisfies BenchGroup[];

export const memoryGroups = [
  {
    rows: [
      { label: "notify-redis", backend: "redis", values: [70, 300, 20, 135] },
      { label: "notify-postgres", backend: "postgres", values: [75, 295, 15, 125] },
      { label: "notify-nats", backend: "nats", values: [75, 270, 15, 100] },
      { label: "notify-ipc", backend: "ipc", values: [100, 240, 10, 95] },
      { label: "state-in-process-sync", backend: "in-process", values: [100, 275, 5, 140] },
      { label: "state-sqlite", backend: "sqlite", values: [100, 170, 10, 105] },
      { label: "state-postgres", backend: "postgres", values: [65, 125, 20, 25] },
      { label: "state-mysql", backend: "mysql", values: [80, 200, 20, 90] },
      { label: "state-mariadb", backend: "mariadb", values: [80, 190, 20, 80] },
      { label: "state-redis", backend: "redis", values: [120, 240, 20, 165] },
      { label: "dashboard", values: [110, 285, 10, 135] },
      { label: "otel", values: [95, 275, 10, 120] },
    ],
  },
] satisfies BenchGroup[];

export const cpuGroups = [
  {
    rows: [
      { label: "notify-redis", backend: "redis", values: [85, 9, 34, 120] },
      { label: "notify-postgres", backend: "postgres", values: [83, 9, 62, 115] },
      { label: "notify-nats", backend: "nats", values: [79, 9, 28, 78] },
      { label: "notify-ipc", backend: "ipc", values: [40, 5, 0, 14] },
      { label: "state-in-process-sync", backend: "in-process", values: [39, 0, 0, 11] },
      { label: "state-sqlite", backend: "sqlite", values: [37, 30, 18, 128] },
      { label: "state-postgres", backend: "postgres", values: [84, 32, 192, 245] },
      { label: "state-mysql", backend: "mysql", values: [92, 122, 367, 440] },
      { label: "state-mariadb", backend: "mariadb", values: [93, 113, 346, 436] },
      { label: "state-redis", backend: "redis", values: [66, 211, 47, 165] },
      { label: "dashboard", values: [46, 0, 0, 15] },
      { label: "otel", values: [48, 0, 12, 18] },
    ],
  },
] satisfies BenchGroup[];

export const allocationGroups = [
  {
    rows: [
      { label: "notify-redis", backend: "redis", values: [82.3] },
      { label: "notify-postgres", backend: "postgres", values: [83.8] },
      { label: "notify-nats", backend: "nats", values: [71.2] },
      { label: "notify-ipc", backend: "ipc", values: [35.0] },
      { label: "state-in-process-sync", backend: "in-process", values: [35.1] },
      { label: "state-sqlite", backend: "sqlite", values: [41.8] },
      { label: "state-postgres", backend: "postgres", values: [131.5] },
      { label: "state-mysql", backend: "mysql", values: [243.3] },
      { label: "state-mariadb", backend: "mariadb", values: [241.8] },
      { label: "state-redis", backend: "redis", values: [226.1] },
      { label: "dashboard", values: [51.9] },
      { label: "otel", values: [65.9] },
    ],
  },
] satisfies BenchGroup[];

export const validationCpuGroups = [
  {
    rows: [
      { label: "defineJobTypes", values: [0] },
      { label: "Zod", values: [0.1] },
      { label: "Valibot", values: [10.5] },
      { label: "TypeBox", values: [0] },
      { label: "ArkType", values: [0.6] },
      { label: "Zod codec", values: [3.4] },
      { label: "superjson codec", values: [38.0] },
    ],
  },
] satisfies BenchGroup[];

export const validationAllocationGroups = [
  {
    rows: [
      { label: "defineJobTypes", values: [52.0] },
      { label: "Zod", values: [53.8] },
      { label: "Valibot", values: [59.9] },
      { label: "TypeBox", values: [52.5] },
      { label: "ArkType", values: [53.5] },
      { label: "Zod codec", values: [57.9] },
      { label: "superjson codec", values: [86.6] },
    ],
  },
] satisfies BenchGroup[];

/** Type-check time in ms per compiler (TS 6, TS 7, tsrs) and TS 7's instantiation count. */
const typeScenarios = [
  { label: "Linear: 1 type", types: 1, instantiations: 20_015, values: [560, 115, 72] },
  { label: "Linear: 10 types", types: 10, instantiations: 25_019, values: [583, 118, 71] },
  { label: "Linear: 50 types", types: 50, instantiations: 47_219, values: [687, 137, 78] },
  { label: "Linear: 100 types", types: 100, instantiations: 74_969, values: [837, 158, 85] },
  { label: "Branched: 4w x 3d", types: 85, instantiations: 66_980, values: [792, 148, 80] },
  { label: "Branched: 2w x 6d", types: 127, instantiations: 90_458, values: [918, 165, 88] },
  { label: "Blockers: 8 steps", types: 30, instantiations: 44_150, values: [664, 134, 75] },
  { label: "Blockers: 25 steps", types: 98, instantiations: 129_643, values: [904, 182, 87] },
  { label: "Loop: 20 steps", types: 21, instantiations: 31_706, values: [618, 122, 69] },
  { label: "Loop: 50 steps", types: 51, instantiations: 48_806, values: [689, 139, 75] },
  { label: "Merge: 2 x 50", types: 100, instantiations: 79_234, values: [812, 187, 77] },
  { label: "Merge: 5 x 50", types: 250, instantiations: 161_203, values: [1093, 217, 94] },
  { label: "Merge: 10 x 50", types: 500, instantiations: 298_630, values: [1537, 328, 124] },
  { label: "Merge: 20 x 50", types: 1_000, instantiations: 574_112, values: [2425, 540, 180] },
  { label: "Merge: 50 x 50", types: 2_500, instantiations: 1_413_540, values: [5246, 1419, 426] },
  {
    label: "Middleware: 10 on linear-100",
    types: 100,
    instantiations: 77_084,
    values: [854, 173, 86],
  },
];

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

export const operationalGroups = [
  {
    rows: [
      { label: "getChains/default", values: [0.45, 0.06, 1.75, 0.6, 0.92, 0] },
      { label: "getChains/lock", values: [1.22, 0.03, 2.28, 1.52, 0.86, 0] },
      { label: "getJobs/default", values: [0.49, 0.08, 0.38, 0.42, 0.35, 0] },
      { label: "getJobs/lock", values: [1.21, 0.03, 1.02, 0.99, 0.41, 0] },
      { label: "getWorkers/default", values: [0.28, 0.04, 0.33, 0.29, 0.23, 0] },
      { label: "getWorkers/lock", values: [0.67, 0.02, 1.15, 0.92, 0.29, 0] },
      { label: "createJobs/default", values: [1.44, 0.05, 2.18, 2.49, 0.55, 0.01] },
      { label: "createJobs/deduplication", values: [0.66, 0.02, 1.09, 1.55, 1.08, 0] },
      { label: "continueJobs/default", values: [1.11, 0.1, 14.66, 3.01, 1.02, 0.01] },
      { label: "addJobsBlockers/default", values: [1.35, 0.08, 2.79, 2.89, 0.89, 0.01] },
      { label: "getJobBlockers/default", values: [0.33, 0.1, 0.32, 0.42, 0.86, 0] },
      { label: "unblockJobs/default", values: [1.39, 0.21, 1.44, 3.07, 0.7, 0.01] },
      { label: "startWorker/default", values: [0.29, 0.01, 1.31, 1.85, 0.43, 0] },
      { label: "extendWorkerLease/default", values: [0.3, 0.02, 2.09, 2.06, 0.51, 0] },
      { label: "stopWorker/default", values: [0.35, 0.01, 2.46, 1.76, 0.5, 0] },
      { label: "startJobAttempts/default", values: [0.72, 0.04, 3.74, 2.49, 0.29, 0] },
      { label: "startJobAttempts/limit10", values: [1.17, 0.32, 3.98, 3.04, 0.66, 0.01] },
      { label: "completeJobs/default", values: [1.54, 0.3, 2.57, 2.6, 0.69, 0.01] },
      { label: "getStartAttemptDelayMs/default", values: [1.01, 0.02, 1.02, 1.81, 0.91, 0] },
      { label: "rescheduleJobs/default", values: [1.43, 0.04, 2.47, 3, 0.48, 0] },
      { label: "deleteChains/default", values: [2.29, 0.07, 3.89, 3.63, 1.13, 0.01] },
      { label: "deleteChains/multiJob", values: [1.82, 0.07, 7.04, 3.43, 1.58, 0] },
    ],
  },
] satisfies BenchGroup[];

export const discoveryGroups = [
  {
    rows: [
      { label: "getChainTypeNames/default", values: [0.49, 0.04, 0.8, 0.38, 0.31, 0.01] },
      { label: "getJobTypeNames/default", values: [0.55, 0.05, 0.45, 0.3, 0.25, 0.01] },
      {
        label: "countChainsByTypeName/default",
        values: [2.29, 1.34, 7.95, 9.41, 0.23, 0.01],
      },
      {
        label: "countJobsByTypeName/default",
        values: [2.62, 1.42, 7.88, 9.22, 0.23, 0.01],
      },
      { label: "countWorkers/default", values: [0.28, 0.01, 0.33, 0.37, 0.27, 0.01] },
      {
        label: "countWorkersByTypeName/default",
        values: [0.28, 0.03, 0.5, 0.41, 0.29, 0.01],
      },
      { label: "countRunningJobsByWorkerId/default", values: [0.27, 0.02, 0.56, 0.27, 0.21, 0] },
    ],
  },
] satisfies BenchGroup[];

export const listChainsGroups = [
  {
    label: "No status filter",
    rows: [
      {
        label: "listChains/noStatus/default",
        values: [45.37, 0.35, 1.07, 1.3, 1.09, 0.01],
      },
      {
        label: "listChains/noStatus/independent",
        values: [61.83, 0.42, 1.23, 1.19, 2.41, 0.01],
      },
      {
        label: "listChains/noStatus/nonIndependent",
        values: [99.08, 118.12, 160.34, 156.3, 49.42, 0],
      },
      {
        label: "listChains/noStatus/fromTo",
        values: [46.37, 0.36, 1.42, 1.02, 1.44, 0.01],
      },
      {
        label: "listChains/noStatus/cursor",
        values: [99.6, 0.6, 2.83, 1.73, 2.73, 0.02],
      },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listChains/running/default", values: [9.4, 0.51, 1.74, 0.92, 1.31, 0.01] },
      {
        label: "listChains/running/independent",
        values: [142.21, 0.75, 2.09, 1.13, 2.54, 0.01],
      },
      {
        label: "listChains/running/nonIndependent",
        values: [70.81, 19.91, 72.09, 68.69, 45.65, 0],
      },
      {
        label: "listChains/running/cursor",
        values: [19.59, 0.68, 3.36, 2.49, 2.72, 0.02],
      },
    ],
  },
  {
    label: "Completed",
    rows: [
      {
        label: "listChains/completed/default",
        values: [23.99, 0.36, 1.32, 1.35, 1.14, 0.01],
      },
      {
        label: "listChains/completed/independent",
        values: [47.54, 0.47, 1.27, 0.98, 1.94, 0.01],
      },
      {
        label: "listChains/completed/nonIndependent",
        values: [64.66, 49.56, 159.95, 131.05, 43.86, 0],
      },
      {
        label: "listChains/completed/orderByCreatedAt",
        values: [23.36, 0.34, 1.22, 1.66, 1.4, 0.02],
      },
      {
        label: "listChains/completed/orderByCompletedAt",
        values: [22.28, 0.33, 1.28, 1.47, 1.09, 0.01],
      },
      {
        label: "listChains/completed/cursor",
        values: [50.21, 0.62, 1.72, 2.7, 2.5, 0.02],
      },
      {
        label: "listChains/completed/orderByCreatedAtCursor",
        values: [45.95, 0.7, 2.42, 2.51, 2.18, 0.02],
      },
      {
        label: "listChains/completed/orderByCompletedAtCursor",
        values: [46.48, 0.67, 2.55, 2.42, 2.07, 0.02],
      },
    ],
  },
] satisfies BenchGroup[];

export const listJobsGroups = [
  {
    label: "No status filter",
    rows: [
      { label: "listJobs/noStatus/default", values: [46.07, 0.4, 0.77, 0.56, 0.8, 0.02] },
      { label: "listJobs/noStatus/fromTo", values: [45.38, 0.41, 0.66, 0.61, 0.66, 0.02] },
      {
        label: "listJobs/noStatus/cursor",
        values: [94.27, 0.86, 0.99, 1.05, 1.61, 0.04],
      },
    ],
  },
  {
    label: "Pending",
    rows: [
      { label: "listJobs/pending/default", values: [56.66, 0.28, 0.44, 0.45, 0.88, 0.02] },
      { label: "listJobs/pending/fromTo", values: [49.97, 0.29, 0.45, 0.44, 0.97, 0.01] },
      {
        label: "listJobs/pending/orderByCreatedAt",
        values: [50.61, 0.3, 0.51, 0.49, 0.85, 0.01],
      },
      {
        label: "listJobs/pending/cursor",
        values: [107.73, 0.55, 0.87, 1.27, 3.54, 0.03],
      },
    ],
  },
  {
    label: "Blocked",
    rows: [
      { label: "listJobs/blocked/default", values: [32.81, 0.28, 0.45, 0.79, 1.4, 0.01] },
      { label: "listJobs/blocked/fromTo", values: [35.42, 0.3, 0.45, 0.84, 1.12, 0.01] },
      {
        label: "listJobs/blocked/orderByCreatedAt",
        values: [34.42, 0.31, 0.48, 0.88, 0.98, 0.01],
      },
      { label: "listJobs/blocked/cursor", values: [65.17, 0.55, 0.82, 1.02, 2.4, 0.03] },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listJobs/running/default", values: [13.99, 0.29, 0.46, 0.52, 1, 0.01] },
      {
        label: "listJobs/running/orderByCreatedAt",
        values: [14.88, 0.3, 0.53, 0.49, 0.85, 0.01],
      },
      { label: "listJobs/running/cursor", values: [21.21, 0.55, 1.15, 0.78, 1.85, 0.03] },
    ],
  },
  {
    label: "Completed",
    rows: [
      { label: "listJobs/completed/default", values: [21.22, 0.32, 0.93, 0.45, 0.97, 0.01] },
      {
        label: "listJobs/completed/orderByCreatedAt",
        values: [22.94, 0.32, 0.74, 0.9, 0.97, 0.01],
      },
      { label: "listJobs/completed/cursor", values: [46.6, 0.55, 1.23, 1.78, 2.3, 0.02] },
    ],
  },
] satisfies BenchGroup[];

export const chainJobsGroups = [
  {
    rows: [
      { label: "listChainJobs/default", values: [1.55, 0.56, 0.57, 2.07, 1.81, 0.01] },
      { label: "listChainJobs/cursor", values: [5.15, 1.31, 0.82, 3.76, 1.89, 0.01] },
      {
        label: "listBlockedJobs/default",
        values: [224.73, 221.3, 204.77, 223.36, 1.55, 0.01],
      },
      {
        label: "listBlockedJobs/cursor",
        values: [473.66, 414.99, 395.7, 456.17, 2.3, 0.03],
      },
    ],
  },
] satisfies BenchGroup[];

export const workerGroups = [
  {
    rows: [
      { label: "listWorkers/default", values: [0.46, 0.09, 0.42, 0.73, 0.78, 0.04] },
      { label: "listWorkers/typeName", values: [0.6, 0.06, 0.34, 1.13, 0.51, 0.01] },
      { label: "listWorkers/status", values: [0.37, 0.05, 0.29, 0.66, 2.86, 0.01] },
      { label: "listWorkers/cursor", values: [1.25, 0.16, 0.72, 1.24, 1.65, 0.07] },
      { label: "listWorkerJobs/default", values: [0.72, 0.16, 0.5, 0.61, 0.52, 0.01] },
      { label: "listWorkerJobs/cursor", values: [1.66, 0.3, 0.83, 0.82, 1.08, 0.02] },
    ],
  },
] satisfies BenchGroup[];

export const benchmarkMachine = [
  { label: "Machine", value: "Apple M1 Pro" },
  { label: "Runtime", value: "Node.js v24" },
] satisfies KeyValueItem[];

export const benchmarkContainers = {
  label: "Infrastructure",
  value: "Docker Desktop on macOS",
  note: "Databases and pub/sub servers run in containers, so every round trip crosses the VM bridge.",
} satisfies KeyValueItem;

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
