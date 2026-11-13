import type { BenchGroup } from "../components/BenchChart.tsx";
import type { KeyValueItem } from "../components/KeyValueList.tsx";

export const creationGroups = [
  {
    label: "State adapter (noop notify)",
    rows: [
      { label: "In-process", backend: "in-process", values: [153616, 272621] },
      { label: "SQLite (better-sqlite3)", backend: "sqlite", values: [36376, 92712] },
      { label: "SQLite (node:sqlite)", backend: "sqlite", values: [33090, 78886] },
      { label: "PostgreSQL (postgres-js)", backend: "postgres", values: [992, 26705] },
      { label: "PostgreSQL (pg)", backend: "postgres", values: [891, 25693] },
      { label: "MySQL (mysql2)", backend: "mysql", values: [484, 11558] },
      { label: "MariaDB (mysql2)", backend: "mariadb", values: [434, 13974] },
      { label: "Redis (redis)", backend: "redis", values: [2945, 24985] },
      { label: "Redis (ioredis)", backend: "redis", values: [2895, 24132] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process", backend: "in-process", values: [150888, 277786] },
      { label: "Redis (redis)", backend: "redis", values: [4756, 138729] },
      { label: "Redis (ioredis)", backend: "redis", values: [4300, 131519] },
      { label: "PostgreSQL (pg)", backend: "postgres", values: [3035, 127833] },
      { label: "PostgreSQL (postgres-js)", backend: "postgres", values: [4064, 129686] },
      { label: "NATS", backend: "nats", values: [4204, 123552] },
    ],
  },
] satisfies BenchGroup[];

export const completionGroups = [
  {
    label: "State adapter (noop notify)",
    rows: [
      { label: "In-process", backend: "in-process", values: [5472, 5828, 6060] },
      { label: "SQLite (better-sqlite3)", backend: "sqlite", values: [12801, 12802, 15780] },
      { label: "SQLite (node:sqlite)", backend: "sqlite", values: [11127, 11076, 13295] },
      { label: "PostgreSQL (postgres-js)", backend: "postgres", values: [481, 1274, 2280] },
      { label: "PostgreSQL (pg)", backend: "postgres", values: [464, 1333, 2666] },
      { label: "MySQL (mysql2)", backend: "mysql", values: [177, 490, 1293] },
      { label: "MariaDB (mysql2)", backend: "mariadb", values: [182, 459, 1289] },
      { label: "Redis (redis)", backend: "redis", values: [940, 2436, 4576] },
      { label: "Redis (ioredis)", backend: "redis", values: [1151, 2891, 6873] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process", backend: "in-process", values: [5839, 5927, 5964] },
      { label: "Redis (redis)", backend: "redis", values: [941, 2056, 3624] },
      { label: "Redis (ioredis)", backend: "redis", values: [1098, 4742, 4572] },
      { label: "PostgreSQL (pg)", backend: "postgres", values: [689, 3447, 4005] },
      { label: "PostgreSQL (postgres-js)", backend: "postgres", values: [835, 4067, 4046] },
      { label: "NATS", backend: "nats", values: [1988, 4737, 4507] },
    ],
  },
] satisfies BenchGroup[];

export const memoryGroups = [
  {
    rows: [
      { label: "notify-redis", backend: "redis", values: [65, 280, 20, 125] },
      { label: "notify-postgres", backend: "postgres", values: [75, 280, 15, 115] },
      { label: "notify-nats", backend: "nats", values: [75, 250, 0, 80] },
      { label: "state-sqlite", backend: "sqlite", values: [110, 165, 0, 95] },
      { label: "state-postgres", backend: "postgres", values: [55, 105, 15, 15] },
      { label: "state-mysql", backend: "mysql", values: [70, 185, 20, 75] },
      { label: "state-mariadb", backend: "mariadb", values: [70, 180, 20, 75] },
      { label: "state-redis", backend: "redis", values: [105, 240, 15, 160] },
      { label: "dashboard", values: [100, 255, 30, 115] },
      { label: "otel", values: [90, 255, 25, 95] },
    ],
  },
] satisfies BenchGroup[];

export const cpuGroups = [
  {
    rows: [
      { label: "notify-redis", backend: "redis", values: [123, 12, 44, 146] },
      { label: "notify-postgres", backend: "postgres", values: [107, 12, 76, 138] },
      { label: "notify-nats", backend: "nats", values: [88, 9, 26, 91] },
      { label: "state-sqlite", backend: "sqlite", values: [29, 17, 2, 99] },
      { label: "state-postgres", backend: "postgres", values: [100, 40, 208, 254] },
      { label: "state-mysql", backend: "mysql", values: [92, 122, 367, 440] },
      { label: "state-mariadb", backend: "mariadb", values: [93, 113, 346, 436] },
      { label: "state-redis", backend: "redis", values: [66, 211, 47, 165] },
      { label: "dashboard", values: [46, 0, 0, 16] },
      { label: "otel", values: [61, 0, 12, 25] },
    ],
  },
] satisfies BenchGroup[];

export const allocationGroups = [
  {
    rows: [
      { label: "notify-redis", backend: "redis", values: [84.5] },
      { label: "notify-postgres", backend: "postgres", values: [86.7] },
      { label: "notify-nats", backend: "nats", values: [73.7] },
      { label: "state-sqlite", backend: "sqlite", values: [62.5] },
      { label: "state-postgres", backend: "postgres", values: [135.3] },
      { label: "state-mysql", backend: "mysql", values: [243.3] },
      { label: "state-mariadb", backend: "mariadb", values: [241.8] },
      { label: "state-redis", backend: "redis", values: [226.1] },
      { label: "dashboard", values: [54.4] },
      { label: "otel", values: [68.2] },
    ],
  },
] satisfies BenchGroup[];

export const validationCpuGroups = [
  {
    rows: [
      { label: "defineJobTypes", values: [0] },
      { label: "Zod", values: [0.1] },
      { label: "Valibot", values: [9.2] },
      { label: "TypeBox", values: [0] },
      { label: "ArkType", values: [0.1] },
      { label: "Zod codec", values: [3.9] },
      { label: "superjson codec", values: [38.5] },
    ],
  },
] satisfies BenchGroup[];

export const validationAllocationGroups = [
  {
    rows: [
      { label: "defineJobTypes", values: [54.3] },
      { label: "Zod", values: [55.8] },
      { label: "Valibot", values: [63.0] },
      { label: "TypeBox", values: [55.4] },
      { label: "ArkType", values: [55.5] },
      { label: "Zod codec", values: [60.6] },
      { label: "superjson codec", values: [88.3] },
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
      { label: "getChains/default", values: [3.16, 0.12, 1.75, 0.6, 0.92] },
      { label: "getChains/lock", values: [7.28, 0.1, 2.28, 1.52, 0.86] },
      { label: "getJobs/default", values: [2.58, 0.06, 0.38, 0.42, 0.35] },
      { label: "getJobs/lock", values: [7.12, 0.06, 1.02, 0.99, 0.41] },
      { label: "getWorkers/default", values: [0.85, 0.04, 0.33, 0.29, 0.23] },
      { label: "getWorkers/lock", values: [2.1, 0.05, 1.15, 0.92, 0.29] },
      { label: "createJobs/default", values: [5.39, 0.13, 2.18, 2.49, 0.55] },
      { label: "createJobs/deduplication", values: [3.19, 0.1, 1.09, 1.55, 1.08] },
      { label: "continueJobs/default", values: [4.33, 0.28, 14.66, 3.01, 1.02] },
      { label: "addJobsBlockers/default", values: [6.52, 0.26, 2.79, 2.89, 0.89] },
      { label: "getJobBlockers/default", values: [1.58, 0.17, 0.32, 0.42, 0.86] },
      { label: "unblockJobs/default", values: [4.69, 0.27, 1.44, 3.07, 0.7] },
      { label: "startWorker/default", values: [1.5, 0.04, 1.31, 1.85, 0.43] },
      { label: "extendWorkerLease/default", values: [1.17, 0.04, 2.09, 2.06, 0.51] },
      { label: "stopWorker/default", values: [1.6, 0.03, 2.46, 1.76, 0.5] },
      { label: "startJobAttempts/default", values: [3.36, 0.14, 3.74, 2.49, 0.29] },
      { label: "startJobAttempts/limit10", values: [3.96, 0.25, 3.98, 3.04, 0.66] },
      { label: "completeJobs/default", values: [3.13, 0.37, 2.57, 2.6, 0.69] },
      { label: "getStartAttemptDelayMs/default", values: [1.86, 0.04, 1.02, 1.81, 0.91] },
      { label: "rescheduleJobs/default", values: [3.36, 0.13, 2.47, 3, 0.48] },
      { label: "deleteChains/default", values: [5.62, 0.26, 3.89, 3.63, 1.13] },
      { label: "deleteChains/multiJob", values: [3.53, 0.27, 7.04, 3.43, 1.58] },
    ],
  },
] satisfies BenchGroup[];

export const discoveryGroups = [
  {
    rows: [
      { label: "getChainTypeNames/default", values: [1.29, 0.06, 0.8, 0.38, 0.31] },
      { label: "getJobTypeNames/default", values: [0.95, 0.05, 0.45, 0.3, 0.25] },
      { label: "countChainsByTypeName/default", values: [2.86, 1.26, 7.95, 9.41, 0.23] },
      { label: "countJobsByTypeName/default", values: [3.49, 1.28, 7.88, 9.22, 0.23] },
      { label: "countWorkers/default", values: [0.75, 0.03, 0.33, 0.37, 0.27] },
      { label: "countWorkersByTypeName/default", values: [0.68, 0.06, 0.5, 0.41, 0.29] },
      { label: "countRunningJobsByWorkerId/default", values: [1.02, 0.04, 0.56, 0.27, 0.21] },
    ],
  },
] satisfies BenchGroup[];

export const listChainsGroups = [
  {
    label: "No status filter",
    rows: [
      { label: "listChains/noStatus/default", values: [24.09, 0.48, 1.07, 1.3, 1.09] },
      { label: "listChains/noStatus/independent", values: [85.15, 0.53, 1.23, 1.19, 2.41] },
      {
        label: "listChains/noStatus/nonIndependent",
        values: [101.65, 114.71, 160.34, 156.3, 49.42],
      },
      { label: "listChains/noStatus/fromTo", values: [23.04, 0.52, 1.42, 1.02, 1.44] },
      { label: "listChains/noStatus/cursor", values: [50.81, 0.84, 2.83, 1.73, 2.73] },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listChains/running/default", values: [4.91, 0.47, 1.74, 0.92, 1.31] },
      { label: "listChains/running/independent", values: [117.67, 0.78, 2.09, 1.13, 2.54] },
      { label: "listChains/running/nonIndependent", values: [25.02, 30.05, 72.09, 68.69, 45.65] },
      { label: "listChains/running/cursor", values: [11.19, 0.94, 3.36, 2.49, 2.72] },
    ],
  },
  {
    label: "Completed",
    rows: [
      { label: "listChains/completed/default", values: [11.95, 0.48, 1.32, 1.35, 1.14] },
      { label: "listChains/completed/independent", values: [37.48, 0.61, 1.27, 0.98, 1.94] },
      {
        label: "listChains/completed/nonIndependent",
        values: [60.25, 54.93, 159.95, 131.05, 43.86],
      },
      { label: "listChains/completed/orderByCreatedAt", values: [14.46, 0.51, 1.22, 1.66, 1.4] },
      { label: "listChains/completed/orderByCompletedAt", values: [13.57, 0.51, 1.28, 1.47, 1.09] },
      { label: "listChains/completed/cursor", values: [29.14, 0.93, 1.72, 2.7, 2.5] },
      {
        label: "listChains/completed/orderByCreatedAtCursor",
        values: [29.34, 0.95, 2.42, 2.51, 2.18],
      },
      {
        label: "listChains/completed/orderByCompletedAtCursor",
        values: [28.72, 1.2, 2.55, 2.42, 2.07],
      },
    ],
  },
] satisfies BenchGroup[];

export const listJobsGroups = [
  {
    label: "No status filter",
    rows: [
      { label: "listJobs/noStatus/default", values: [26.31, 0.4, 0.77, 0.56, 0.8] },
      { label: "listJobs/noStatus/fromTo", values: [29.24, 0.42, 0.66, 0.61, 0.66] },
      { label: "listJobs/noStatus/cursor", values: [59.97, 0.69, 0.99, 1.05, 1.61] },
    ],
  },
  {
    label: "Pending",
    rows: [
      { label: "listJobs/pending/default", values: [23.94, 0.34, 0.44, 0.45, 0.88] },
      { label: "listJobs/pending/fromTo", values: [27.69, 0.36, 0.45, 0.44, 0.97] },
      { label: "listJobs/pending/orderByCreatedAt", values: [36, 0.34, 0.51, 0.49, 0.85] },
      { label: "listJobs/pending/cursor", values: [55.79, 0.65, 0.87, 1.27, 3.54] },
    ],
  },
  {
    label: "Blocked",
    rows: [
      { label: "listJobs/blocked/default", values: [20.15, 0.36, 0.45, 0.79, 1.4] },
      { label: "listJobs/blocked/fromTo", values: [16.64, 0.35, 0.45, 0.84, 1.12] },
      { label: "listJobs/blocked/orderByCreatedAt", values: [20.75, 0.36, 0.48, 0.88, 0.98] },
      { label: "listJobs/blocked/cursor", values: [36.48, 0.67, 0.82, 1.02, 2.4] },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listJobs/running/default", values: [5.89, 0.36, 0.46, 0.52, 1] },
      { label: "listJobs/running/orderByCreatedAt", values: [6.13, 0.36, 0.53, 0.49, 0.85] },
      { label: "listJobs/running/cursor", values: [13.42, 0.7, 1.15, 0.78, 1.85] },
    ],
  },
  {
    label: "Completed",
    rows: [
      { label: "listJobs/completed/default", values: [12.49, 0.38, 0.93, 0.45, 0.97] },
      { label: "listJobs/completed/orderByCreatedAt", values: [13.98, 0.38, 0.74, 0.9, 0.97] },
      { label: "listJobs/completed/cursor", values: [28.18, 0.73, 1.23, 1.78, 2.3] },
    ],
  },
] satisfies BenchGroup[];

export const chainJobsGroups = [
  {
    rows: [
      { label: "listChainJobs/default", values: [2.02, 0.68, 0.57, 2.07, 1.81] },
      { label: "listChainJobs/cursor", values: [4.16, 2.22, 0.82, 3.76, 1.89] },
      { label: "listBlockedJobs/default", values: [146.45, 209.54, 204.77, 223.36, 1.55] },
      { label: "listBlockedJobs/cursor", values: [329.1, 384, 395.7, 456.17, 2.3] },
    ],
  },
] satisfies BenchGroup[];

export const workerGroups = [
  {
    rows: [
      { label: "listWorkers/default", values: [0.78, 0.13, 0.42, 0.73, 0.78] },
      { label: "listWorkers/typeName", values: [0.61, 0.08, 0.34, 1.13, 0.51] },
      { label: "listWorkers/status", values: [0.46, 0.08, 0.29, 0.66, 2.86] },
      { label: "listWorkers/cursor", values: [1.08, 0.22, 0.72, 1.24, 1.65] },
      { label: "listWorkerJobs/default", values: [0.98, 0.23, 0.5, 0.61, 0.52] },
      { label: "listWorkerJobs/cursor", values: [1.83, 0.48, 0.83, 0.82, 1.08] },
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
