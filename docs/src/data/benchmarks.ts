import type { BenchGroup } from "../components/BenchChart.tsx";
import type { KeyValueItem } from "../components/KeyValueList.tsx";

export const creationGroups = [
  {
    label: "State adapter (noop notify)",
    rows: [
      { label: "In-process", values: [153616, 272621] },
      { label: "SQLite (better-sqlite3)", values: [36376, 92712] },
      { label: "SQLite (node:sqlite)", values: [33090, 78886] },
      { label: "PostgreSQL (postgres-js)", values: [992, 26705] },
      { label: "PostgreSQL (pg)", values: [891, 25693] },
      { label: "MySQL (mysql2)", values: [484, 11558] },
      { label: "MariaDB (mysql2)", values: [434, 13974] },
      { label: "Redis (redis)", values: [2945, 24985] },
      { label: "Redis (ioredis)", values: [2895, 24132] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process", values: [150888, 277786] },
      { label: "Redis (redis)", values: [4756, 138729] },
      { label: "Redis (ioredis)", values: [4300, 131519] },
      { label: "PostgreSQL (pg)", values: [3035, 127833] },
      { label: "PostgreSQL (postgres-js)", values: [4064, 129686] },
      { label: "NATS", values: [4204, 123552] },
    ],
  },
] satisfies BenchGroup[];

export const completionGroups = [
  {
    label: "State adapter (noop notify)",
    rows: [
      { label: "In-process", values: [5472, 5828, 6060] },
      { label: "SQLite (better-sqlite3)", values: [12801, 12802, 15780] },
      { label: "SQLite (node:sqlite)", values: [11127, 11076, 13295] },
      { label: "PostgreSQL (postgres-js)", values: [481, 1274, 2280] },
      { label: "PostgreSQL (pg)", values: [464, 1333, 2666] },
      { label: "MySQL (mysql2)", values: [177, 490, 1293] },
      { label: "MariaDB (mysql2)", values: [182, 459, 1289] },
      { label: "Redis (redis)", values: [940, 2436, 4576] },
      { label: "Redis (ioredis)", values: [1151, 2891, 6873] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process", values: [5839, 5927, 5964] },
      { label: "Redis (redis)", values: [941, 2056, 3624] },
      { label: "Redis (ioredis)", values: [1098, 4742, 4572] },
      { label: "PostgreSQL (pg)", values: [689, 3447, 4005] },
      { label: "PostgreSQL (postgres-js)", values: [835, 4067, 4046] },
      { label: "NATS", values: [1988, 4737, 4507] },
    ],
  },
] satisfies BenchGroup[];

export const memoryGroups = [
  {
    rows: [
      { label: "notify-redis", values: [65, 280, 20, 125] },
      { label: "notify-postgres", values: [75, 280, 15, 115] },
      { label: "notify-nats", values: [75, 250, 0, 80] },
      { label: "state-sqlite", values: [110, 165, 0, 95] },
      { label: "state-postgres", values: [55, 105, 15, 15] },
      { label: "state-mysql", values: [70, 185, 20, 75] },
      { label: "state-mariadb", values: [70, 180, 20, 75] },
      { label: "state-redis", values: [105, 240, 15, 160] },
      { label: "dashboard", values: [100, 255, 30, 115] },
      { label: "otel", values: [90, 255, 25, 95] },
    ],
  },
] satisfies BenchGroup[];

export const cpuGroups = [
  {
    rows: [
      { label: "notify-redis", values: [123, 12, 44, 146] },
      { label: "notify-postgres", values: [107, 12, 76, 138] },
      { label: "notify-nats", values: [88, 9, 26, 91] },
      { label: "state-sqlite", values: [29, 17, 2, 99] },
      { label: "state-postgres", values: [100, 40, 208, 254] },
      { label: "state-mysql", values: [92, 122, 367, 440] },
      { label: "state-mariadb", values: [93, 113, 346, 436] },
      { label: "state-redis", values: [66, 211, 47, 165] },
      { label: "dashboard", values: [46, 0, 0, 16] },
      { label: "otel", values: [61, 0, 12, 25] },
    ],
  },
] satisfies BenchGroup[];

export const allocationGroups = [
  {
    rows: [
      { label: "notify-redis", values: [84.5] },
      { label: "notify-postgres", values: [86.7] },
      { label: "notify-nats", values: [73.7] },
      { label: "state-sqlite", values: [62.5] },
      { label: "state-postgres", values: [135.3] },
      { label: "state-mysql", values: [243.3] },
      { label: "state-mariadb", values: [241.8] },
      { label: "state-redis", values: [226.1] },
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

export const typeGroups = [
  {
    rows: [
      {
        label: "Linear: 1 type",
        chips: ["1 type", "20,015 instantiations"],
        meta: "1.0x baseline",
        values: [560, 115, 72],
      },
      {
        label: "Linear: 10 types",
        chips: ["10 types", "25,019 instantiations"],
        meta: "1.3x baseline",
        values: [583, 118, 71],
      },
      {
        label: "Linear: 50 types",
        chips: ["50 types", "47,219 instantiations"],
        meta: "2.4x baseline",
        values: [687, 137, 78],
      },
      {
        label: "Linear: 100 types",
        chips: ["100 types", "74,969 instantiations"],
        meta: "3.7x baseline",
        values: [837, 158, 85],
      },
      {
        label: "Branched: 4w x 3d",
        chips: ["85 types", "66,980 instantiations"],
        meta: "3.3x baseline",
        values: [792, 148, 80],
      },
      {
        label: "Branched: 2w x 6d",
        chips: ["127 types", "90,458 instantiations"],
        meta: "4.5x baseline",
        values: [918, 165, 88],
      },
      {
        label: "Blockers: 8 steps",
        chips: ["30 types", "44,150 instantiations"],
        meta: "2.2x baseline",
        values: [664, 134, 75],
      },
      {
        label: "Blockers: 25 steps",
        chips: ["98 types", "129,643 instantiations"],
        meta: "6.5x baseline",
        values: [904, 182, 87],
      },
      {
        label: "Loop: 20 steps",
        chips: ["21 types", "31,706 instantiations"],
        meta: "1.6x baseline",
        values: [618, 122, 69],
      },
      {
        label: "Loop: 50 steps",
        chips: ["51 types", "48,806 instantiations"],
        meta: "2.4x baseline",
        values: [689, 139, 75],
      },
      {
        label: "Merge: 2 x 50",
        chips: ["100 types", "79,234 instantiations"],
        meta: "4.0x baseline",
        values: [812, 187, 77],
      },
      {
        label: "Merge: 5 x 50",
        chips: ["250 types", "161,203 instantiations"],
        meta: "8.1x baseline",
        values: [1093, 217, 94],
      },
      {
        label: "Merge: 10 x 50",
        chips: ["500 types", "298,630 instantiations"],
        meta: "14.9x baseline",
        values: [1537, 328, 124],
      },
      {
        label: "Merge: 20 x 50",
        chips: ["1,000 types", "574,112 instantiations"],
        meta: "28.7x baseline",
        values: [2425, 540, 180],
      },
      {
        label: "Merge: 50 x 50",
        chips: ["2,500 types", "1,413,540 instantiations"],
        meta: "70.6x baseline",
        values: [5246, 1419, 426],
      },
      {
        label: "Middleware: 10 on linear-100",
        chips: ["100 types", "77,084 instantiations"],
        meta: "3.9x baseline",
        values: [854, 173, 86],
      },
    ],
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

export const benchmarkSourceUrl = (suite: string) =>
  `https://github.com/kvet/queuert/tree/main/benchmarks/${suite}`;

const rowValues = (groups: BenchGroup[], groupLabel: string | undefined, rowLabel: string) =>
  groups.find((group) => group.label === groupLabel)!.rows.find((row) => row.label === rowLabel)!
    .values;

const allValues = (groups: BenchGroup[], series: number) =>
  groups.flatMap((group) => group.rows.map((row) => row.values[series]));

export const benchmarkHeadlines = {
  postgresCompletion: rowValues(
    completionGroups,
    "State adapter (noop notify)",
    "PostgreSQL (pg)",
  )[2],
  sqliteCompletion: Math.max(
    ...completionGroups[0].rows
      .filter((row) => row.label.startsWith("SQLite"))
      .map((row) => row.values[2]),
  ),
  postgresBatchedCreation: Math.max(
    ...creationGroups[0].rows
      .filter((row) => row.label.startsWith("PostgreSQL"))
      .map((row) => row.values[1]),
  ),
  retainedAfterClose: {
    min: Math.min(...allValues(memoryGroups, 2)),
    max: Math.max(...allValues(memoryGroups, 2)),
  },
  coreCpuPerJob: {
    min: Math.min(...allValues(cpuGroups, 0)),
    max: Math.max(...allValues(cpuGroups, 0)),
  },
  postgresOperational: {
    min: Math.min(...allValues(operationalGroups, 0)),
    max: Math.max(...allValues(operationalGroups, 0)),
  },
  sqliteOperationalMax: Math.max(...allValues(operationalGroups, 1)),
  typeCheck100: rowValues(typeGroups, undefined, "Linear: 100 types"),
  typeCheck2500: rowValues(typeGroups, undefined, "Merge: 50 x 50"),
};
