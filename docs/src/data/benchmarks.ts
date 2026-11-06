import { type BenchGroup } from "../components/BenchChart.tsx";
import { type KeyValueItem } from "../components/KeyValueList.tsx";

export const creationGroups = [
  {
    label: "State adapter (in-process notify)",
    rows: [
      { label: "In-process", values: [94292, 218906] },
      { label: "SQLite (better-sqlite3)", values: [30062, 92325] },
      { label: "SQLite (node:sqlite)", values: [25531, 74873] },
      { label: "PostgreSQL (postgres-js)", values: [874, 30175] },
      { label: "PostgreSQL (pg)", values: [1044, 30200] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process", values: [92090, 206227] },
      { label: "Redis (redis)", values: [4513, 131556] },
      { label: "Redis (ioredis)", values: [4614, 142290] },
      { label: "PostgreSQL (pg)", values: [3800, 116512] },
      { label: "PostgreSQL (postgres-js)", values: [4131, 115881] },
      { label: "NATS", values: [4262, 127035] },
    ],
  },
] satisfies BenchGroup[];

export const completionGroups = [
  {
    label: "State adapter (in-process notify)",
    rows: [
      { label: "In-process", values: [5189, 5615, 5915] },
      { label: "SQLite (better-sqlite3)", values: [5271, 5155, 10469] },
      { label: "SQLite (node:sqlite)", values: [5147, 5252, 9786] },
      { label: "PostgreSQL (postgres-js)", values: [461, 1347, 2671] },
      { label: "PostgreSQL (pg)", values: [448, 1439, 2774] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process", values: [5254, 5580, 5828] },
      { label: "Redis (redis)", values: [1075, 2218, 3847] },
      { label: "Redis (ioredis)", values: [1107, 4458, 4587] },
      { label: "PostgreSQL (pg)", values: [834, 4034, 4036] },
      { label: "PostgreSQL (postgres-js)", values: [808, 3670, 3576] },
      { label: "NATS", values: [1771, 4098, 4511] },
    ],
  },
] satisfies BenchGroup[];

export const memoryGroups = [
  {
    rows: [
      { label: "notify-redis", values: [80, 255, 10, 60] },
      { label: "notify-postgres", values: [505, 710, 10, 80] },
      { label: "notify-nats", values: [455, 590, 10, 40] },
      { label: "state-sqlite", values: [455, 540, 10, 80] },
      { label: "state-postgres", values: [490, 640, 20, 80] },
      { label: "dashboard", values: [640, 820, 10, 65] },
      { label: "otel", values: [250, 435, 10, 85] },
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
      { label: "getChains/default", values: [0.87, 0.17] },
      { label: "getChains/lock", values: [1.42, 0.16] },
      { label: "getJobs/default", values: [0.87, 0.07] },
      { label: "getJobs/lock", values: [1.67, 0.1] },
      { label: "getWorkers/default", values: [0.56, 0.05] },
      { label: "getWorkers/lock", values: [1.21, 0.06] },
      { label: "createJobs/default", values: [2.82, 0.13] },
      { label: "createJobs/deduplication", values: [2.21, 0.05] },
      { label: "continueJobs/default", values: [2.4, 0.3] },
      { label: "addJobsBlockers/default", values: [3.58, 0.25] },
      { label: "getJobBlockers/default", values: [1.02, 0.2] },
      { label: "unblockJobs/default", values: [3.91, 0.25] },
      { label: "startWorker/default", values: [0.8, 0.03] },
      { label: "extendWorkerLease/default", values: [0.67, 0.04] },
      { label: "stopWorker/default", values: [0.62, 0.03] },
      { label: "startJobAttempts/default", values: [2.79, 0.28] },
      { label: "startJobAttempts/limit10", values: [3.04, 0.53] },
      { label: "completeJobs/default", values: [2.27, 0.36] },
      { label: "getStartAttemptDelayMs/default", values: [1.79, 0.04] },
      { label: "rescheduleJobs/default", values: [1.73, 0.13] },
      { label: "deleteChains/default", values: [3.9, 0.24] },
      { label: "deleteChains/multiJob", values: [4.05, 0.24] },
    ],
  },
] satisfies BenchGroup[];

export const discoveryGroups = [
  {
    rows: [
      { label: "getChainTypeNames/default", values: [0.84, 0.06] },
      { label: "getJobTypeNames/default", values: [0.75, 0.05] },
      { label: "countChainsByTypeName/default", values: [2.62, 1.2] },
      { label: "countJobsByTypeName/default", values: [2.88, 1.31] },
      { label: "countWorkers/default", values: [0.51, 0.02] },
      { label: "countWorkersByTypeName/default", values: [0.54, 0.08] },
      { label: "countRunningJobsByWorkerId/default", values: [0.57, 0.04] },
    ],
  },
] satisfies BenchGroup[];

export const listChainsGroups = [
  {
    label: "No status filter",
    rows: [
      { label: "listChains/noStatus/default", values: [48.88, 0.47] },
      { label: "listChains/noStatus/independent", values: [62.24, 0.53] },
      { label: "listChains/noStatus/nonIndependent", values: [82.66, 94.44] },
      { label: "listChains/noStatus/fromTo", values: [46.96, 0.46] },
      { label: "listChains/noStatus/cursor", values: [97.13, 0.84] },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listChains/running/default", values: [9.45, 0.43] },
      { label: "listChains/running/independent", values: [117.46, 0.58] },
      { label: "listChains/running/nonIndependent", values: [26.51, 17.62] },
      { label: "listChains/running/cursor", values: [20.35, 0.9] },
    ],
  },
  {
    label: "Completed",
    rows: [
      { label: "listChains/completed/default", values: [21.69, 0.47] },
      { label: "listChains/completed/independent", values: [37.6, 0.56] },
      { label: "listChains/completed/nonIndependent", values: [57.14, 38.93] },
      { label: "listChains/completed/orderByCreatedAt", values: [23.93, 0.44] },
      { label: "listChains/completed/orderByCompletedAt", values: [22.26, 0.45] },
      { label: "listChains/completed/cursor", values: [50.52, 0.84] },
      { label: "listChains/completed/orderByCreatedAtCursor", values: [48.45, 0.85] },
      { label: "listChains/completed/orderByCompletedAtCursor", values: [48.97, 0.85] },
    ],
  },
] satisfies BenchGroup[];

export const listJobsGroups = [
  {
    label: "No status filter",
    rows: [
      { label: "listJobs/noStatus/default", values: [48.45, 0.36] },
      { label: "listJobs/noStatus/fromTo", values: [49.91, 0.35] },
      { label: "listJobs/noStatus/cursor", values: [100.06, 0.65] },
    ],
  },
  {
    label: "Pending",
    rows: [
      { label: "listJobs/pending/default", values: [46.11, 0.32] },
      { label: "listJobs/pending/fromTo", values: [47.01, 0.35] },
      { label: "listJobs/pending/orderByCreatedAt", values: [49.53, 0.34] },
      { label: "listJobs/pending/cursor", values: [96.33, 0.63] },
    ],
  },
  {
    label: "Blocked",
    rows: [
      { label: "listJobs/blocked/default", values: [32.44, 0.36] },
      { label: "listJobs/blocked/fromTo", values: [31.56, 0.39] },
      { label: "listJobs/blocked/orderByCreatedAt", values: [33.8, 0.38] },
      { label: "listJobs/blocked/cursor", values: [65.38, 0.69] },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listJobs/running/default", values: [9.32, 0.36] },
      { label: "listJobs/running/orderByCreatedAt", values: [10.35, 0.38] },
      { label: "listJobs/running/cursor", values: [21.53, 0.71] },
    ],
  },
  {
    label: "Completed",
    rows: [
      { label: "listJobs/completed/default", values: [23.85, 0.37] },
      { label: "listJobs/completed/orderByCreatedAt", values: [24.63, 0.38] },
      { label: "listJobs/completed/cursor", values: [50.06, 0.69] },
    ],
  },
] satisfies BenchGroup[];

export const chainJobsGroups = [
  {
    rows: [
      { label: "listChainJobs/default", values: [2.67, 0.42] },
      { label: "listChainJobs/cursor", values: [5.92, 0.87] },
      { label: "listBlockedJobs/default", values: [198.63, 185.95] },
      { label: "listBlockedJobs/cursor", values: [373.34, 362.83] },
    ],
  },
] satisfies BenchGroup[];

export const workerGroups = [
  {
    rows: [
      { label: "listWorkers/default", values: [1.43, 0.13] },
      { label: "listWorkers/typeName", values: [0.51, 0.08] },
      { label: "listWorkers/status", values: [0.49, 0.07] },
      { label: "listWorkers/cursor", values: [1.09, 0.19] },
      { label: "listWorkerJobs/default", values: [1.3, 0.21] },
      { label: "listWorkerJobs/cursor", values: [3.36, 0.41] },
    ],
  },
] satisfies BenchGroup[];

export const benchmarkMachine = [
  { label: "Machine", value: "Apple M1 Pro" },
  { label: "Runtime", value: "Node.js v22" },
] satisfies KeyValueItem[];

export const benchmarkContainers = {
  label: "Infrastructure",
  value: "Docker Desktop on macOS",
  note: "Databases and pub/sub servers run in containers, so every round trip crosses the VM bridge.",
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
    "State adapter (in-process notify)",
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
  postgresOperational: {
    min: Math.min(...allValues(operationalGroups, 0)),
    max: Math.max(...allValues(operationalGroups, 0)),
  },
  sqliteOperationalMax: Math.max(...allValues(operationalGroups, 1)),
  typeCheck100: rowValues(typeGroups, undefined, "Linear: 100 types"),
  typeCheck2500: rowValues(typeGroups, undefined, "Merge: 50 x 50"),
};
