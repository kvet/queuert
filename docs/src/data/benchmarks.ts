import type { BenchGroup } from "../components/BenchChart.tsx";
import type { KeyValueItem } from "../components/KeyValueList.tsx";

export const creationGroups = [
  {
    label: "State adapter (noop notify)",
    rows: [
      { label: "In-process", backend: "in-process", values: [298602, 428016] },
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
      { label: "In-process", backend: "in-process", values: [225333, 299870] },
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
      { label: "In-process", backend: "in-process", values: [105572, 101548, 101041] },
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
      { label: "In-process", backend: "in-process", values: [62444, 88456, 91548] },
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
      { label: "state-in-process", backend: "in-process", values: [100, 275, 5, 140] },
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
      { label: "state-in-process", backend: "in-process", values: [39, 0, 0, 11] },
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
      { label: "state-in-process", backend: "in-process", values: [35.1] },
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
      { label: "getChains/default", values: [0.48, 0.06, 2.56, 0.62, 0.81, 0.01] },
      { label: "getChains/lock", values: [0.96, 0.05, 3.47, 1.28, 0.74, 0.01] },
      { label: "getJobs/default", values: [0.44, 0.03, 0.55, 0.39, 0.22, 0] },
      { label: "getJobs/lock", values: [1.04, 0.03, 1.71, 0.89, 0.39, 0] },
      { label: "getWorkers/default", values: [0.47, 0.02, 0.66, 0.26, 0.22, 0] },
      { label: "getWorkers/lock", values: [0.83, 0.03, 1.37, 1.3, 0.23, 0] },
      { label: "createJobs/default", values: [1.46, 0.07, 17.14, 3.43, 0.32, 0.01] },
      { label: "createJobs/deduplication", values: [0.75, 0.12, 1.18, 1.51, 0.65, 0.01] },
      { label: "continueJobs/default", values: [1.32, 0.1, 3.09, 2.86, 0.53, 0.01] },
      { label: "addJobsBlockers/default", values: [1.43, 0.09, 3.41, 2.25, 0.56, 0.01] },
      { label: "getJobBlockers/default", values: [0.35, 0.08, 0.56, 0.31, 0.57, 0] },
      { label: "unblockJobs/default", values: [2.47, 0.14, 1.97, 1.74, 0.56, 0.01] },
      { label: "startWorker/default", values: [0.67, 0.06, 2, 1.88, 0.49, 0] },
      { label: "extendWorkerLease/default", values: [0.96, 0.02, 2.57, 2.26, 0.32, 0] },
      { label: "stopWorker/default", values: [0.83, 0.02, 1.93, 2.55, 0.32, 0] },
      { label: "startJobAttempts/default", values: [2.58, 0.07, 3.05, 4.07, 0.21, 0] },
      { label: "startJobAttempts/limit10", values: [4.3, 0.18, 5.91, 3.58, 0.49, 0.01] },
      { label: "completeJobs/default", values: [2.35, 0.07, 2.58, 2.92, 0.43, 0.01] },
      { label: "getStartAttemptDelayMs/default", values: [1.47, 0.03, 1.07, 1.18, 0.38, 0] },
      { label: "rescheduleJobs/default", values: [0.94, 0.04, 2.75, 2.51, 0.37, 0] },
      { label: "deleteChains/default", values: [2.53, 0.08, 4.26, 5.31, 0.84, 0.01] },
      { label: "deleteChains/multiJob", values: [3.22, 0.09, 15.28, 3.24, 1.26, 0.01] },
    ],
  },
] satisfies BenchGroup[];

export const discoveryGroups = [
  {
    rows: [
      { label: "getChainTypeNames/default", values: [0.74, 0.05, 0.53, 0.43, 0.28, 0.01] },
      { label: "getJobTypeNames/default", values: [0.69, 0.06, 0.41, 0.61, 0.26, 0.02] },
      {
        label: "countChainsByTypeName/default",
        values: [2.61, 1.41, 7.93, 11.4, 0.19, 0],
      },
      {
        label: "countJobsByTypeName/default",
        values: [2.8, 1.33, 8.45, 12.51, 0.2, 0],
      },
      { label: "countWorkers/default", values: [0.27, 0.01, 0.26, 0.39, 0.25, 0] },
      {
        label: "countWorkersByTypeName/default",
        values: [0.45, 0.04, 0.42, 0.5, 0.24, 0.01],
      },
      { label: "countRunningJobsByWorkerId/default", values: [0.33, 0.02, 0.31, 0.38, 0.19, 0] },
    ],
  },
] satisfies BenchGroup[];

export const listChainsGroups = [
  {
    label: "No status filter",
    rows: [
      {
        label: "listChains/noStatus/default",
        values: [0.77, 0.27, 1.05, 0.91, 0.82, 0.02],
      },
      {
        label: "listChains/noStatus/independent",
        values: [1.02, 0.33, 1.39, 0.88, 1.44, 0.01],
      },
      {
        label: "listChains/noStatus/nonIndependent",
        values: [145.73, 121.13, 219.43, 223.56, 74.26, 0],
      },
      {
        label: "listChains/noStatus/fromTo",
        values: [1.01, 0.27, 1.27, 2.22, 0.98, 0.01],
      },
      {
        label: "listChains/noStatus/cursor",
        values: [1.95, 0.57, 1.87, 2.6, 2.01, 0.03],
      },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listChains/running/default", values: [1.02, 0.27, 1.32, 1.44, 0.83, 0.01] },
      {
        label: "listChains/running/independent",
        values: [1.09, 0.29, 1.44, 1.6, 1.56, 0.01],
      },
      {
        label: "listChains/running/nonIndependent",
        values: [24.26, 20.83, 100.78, 128.02, 68.6, 0],
      },
      {
        label: "listChains/running/cursor",
        values: [1.81, 0.52, 2.27, 3.65, 2.21, 0.03],
      },
    ],
  },
  {
    label: "Completed",
    rows: [
      {
        label: "listChains/completed/default",
        values: [0.64, 0.29, 0.86, 1.96, 1.19, 0.01],
      },
      {
        label: "listChains/completed/independent",
        values: [1.2, 0.33, 1.38, 1.83, 1.98, 0.01],
      },
      {
        label: "listChains/completed/nonIndependent",
        values: [61.87, 50.1, 229.74, 251.91, 73.19, 0],
      },
      {
        label: "listChains/completed/orderByCreatedAt",
        values: [0.99, 0.61, 1.3, 1.71, 0.95, 0.01],
      },
      {
        label: "listChains/completed/orderByCompletedAt",
        values: [0.76, 0.3, 1.2, 1.71, 1.05, 0.01],
      },
      {
        label: "listChains/completed/cursor",
        values: [1.35, 0.74, 2.43, 2.92, 2.09, 0.03],
      },
      {
        label: "listChains/completed/orderByCreatedAtCursor",
        values: [1.25, 0.6, 2.33, 2.99, 2.03, 0.02],
      },
      {
        label: "listChains/completed/orderByCompletedAtCursor",
        values: [1.21, 0.52, 2, 3.06, 1.77, 0.03],
      },
    ],
  },
] satisfies BenchGroup[];

export const listJobsGroups = [
  {
    label: "No status filter",
    rows: [
      { label: "listJobs/noStatus/default", values: [0.79, 0.27, 1.31, 1.03, 0.79, 0.02] },
      { label: "listJobs/noStatus/fromTo", values: [0.85, 0.25, 0.89, 0.64, 0.79, 0.02] },
      {
        label: "listJobs/noStatus/cursor",
        values: [1.92, 0.41, 1.6, 1.14, 1.85, 0.04],
      },
    ],
  },
  {
    label: "Pending",
    rows: [
      { label: "listJobs/pending/default", values: [1.27, 0.2, 0.62, 0.87, 0.83, 0.01] },
      { label: "listJobs/pending/fromTo", values: [0.78, 0.22, 0.49, 0.95, 0.65, 0.01] },
      {
        label: "listJobs/pending/orderByCreatedAt",
        values: [0.78, 0.2, 0.52, 1.11, 0.56, 0.02],
      },
      {
        label: "listJobs/pending/cursor",
        values: [1.3, 0.41, 0.89, 1.68, 1.17, 0.03],
      },
    ],
  },
  {
    label: "Blocked",
    rows: [
      { label: "listJobs/blocked/default", values: [1.1, 0.23, 0.47, 0.7, 0.6, 0.01] },
      { label: "listJobs/blocked/fromTo", values: [1.11, 0.22, 0.48, 0.72, 0.56, 0.01] },
      {
        label: "listJobs/blocked/orderByCreatedAt",
        values: [1.08, 0.22, 0.54, 0.82, 0.56, 0.01],
      },
      { label: "listJobs/blocked/cursor", values: [1.93, 0.4, 0.94, 1, 1.16, 0.03] },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listJobs/running/default", values: [1.36, 0.32, 0.48, 0.52, 0.61, 0.02] },
      {
        label: "listJobs/running/orderByCreatedAt",
        values: [0.77, 0.21, 0.53, 0.96, 0.56, 0.01],
      },
      { label: "listJobs/running/cursor", values: [11.11, 0.6, 0.93, 1.43, 1.18, 0.03] },
    ],
  },
  {
    label: "Completed",
    rows: [
      { label: "listJobs/completed/default", values: [0.95, 0.26, 0.69, 0.53, 0.56, 0.01] },
      {
        label: "listJobs/completed/orderByCreatedAt",
        values: [1.02, 0.23, 1.07, 0.59, 0.54, 0.01],
      },
      { label: "listJobs/completed/cursor", values: [1.56, 0.46, 1.61, 0.9, 1.32, 0.02] },
    ],
  },
] satisfies BenchGroup[];

export const chainJobsGroups = [
  {
    rows: [
      { label: "listChainJobs/default", values: [3.33, 0.91, 0.8, 3.63, 0.51, 0.01] },
      { label: "listChainJobs/cursor", values: [6.14, 1.93, 1.33, 5.18, 1.15, 0.01] },
      {
        label: "listBlockedJobs/default",
        values: [177.82, 225.34, 207.28, 175.24, 0.55, 0.01],
      },
      {
        label: "listBlockedJobs/cursor",
        values: [324.83, 438.39, 420.59, 324.15, 1.01, 0.02],
      },
    ],
  },
] satisfies BenchGroup[];

export const workerGroups = [
  {
    rows: [
      { label: "listWorkers/default", values: [0.74, 0.1, 0.58, 0.4, 0.45, 0.03] },
      { label: "listWorkers/typeName", values: [0.45, 0.07, 0.73, 0.32, 0.3, 0.01] },
      { label: "listWorkers/status", values: [0.28, 0.06, 0.37, 0.28, 1.74, 0] },
      { label: "listWorkers/cursor", values: [0.74, 0.17, 0.99, 0.69, 1.07, 0.06] },
      { label: "listWorkerJobs/default", values: [0.49, 0.15, 0.41, 6.75, 0.46, 0] },
      { label: "listWorkerJobs/cursor", values: [1.58, 0.27, 1.7, 14.47, 0.77, 0.02] },
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
