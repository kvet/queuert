import { type BenchGroup } from "../components/BenchChart.tsx";
import { type KeyValueItem } from "../components/KeyValueList.tsx";

export const creationGroups = [
  {
    label: "State adapter (in-process notify)",
    rows: [
      { label: "In-process", values: [96052, 208109] },
      { label: "SQLite (better-sqlite3)", values: [27343, 89788] },
      { label: "SQLite (node:sqlite)", values: [24464, 74792] },
      { label: "PostgreSQL (postgres-js)", values: [983, 31323] },
      { label: "PostgreSQL (pg)", values: [970, 27032] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process", values: [94345, 212810] },
      { label: "Redis (redis)", values: [4805, 131614] },
      { label: "Redis (ioredis)", values: [4911, 140549] },
      { label: "PostgreSQL (pg)", values: [4074, 122811] },
      { label: "PostgreSQL (postgres-js)", values: [2955, 111980] },
      { label: "NATS", values: [3597, 124628] },
    ],
  },
] satisfies BenchGroup[];

export const completionGroups = [
  {
    label: "State adapter (in-process notify)",
    rows: [
      { label: "In-process", values: [5469, 5640, 5986] },
      { label: "SQLite (better-sqlite3)", values: [4787, 6191, 9312] },
      { label: "SQLite (node:sqlite)", values: [4555, 5711, 8986] },
      { label: "PostgreSQL (postgres-js)", values: [367, 1256, 2090] },
      { label: "PostgreSQL (pg)", values: [383, 1350, 2416] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process", values: [5387, 5649, 5988] },
      { label: "Redis (redis)", values: [1074, 2274, 3855] },
      { label: "Redis (ioredis)", values: [1168, 4405, 4580] },
      { label: "PostgreSQL (pg)", values: [978, 4004, 4090] },
      { label: "PostgreSQL (postgres-js)", values: [879, 3713, 3514] },
      { label: "NATS", values: [1856, 3629, 4352] },
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
      { label: "getChains/default", values: [0.84, 0.18] },
      { label: "getChains/lock", values: [1.76, 0.13] },
      { label: "getJobs/default", values: [0.79, 0.06] },
      { label: "getJobs/lock", values: [1.58, 0.09] },
      { label: "getWorkers/default", values: [0.51, 0.05] },
      { label: "getWorkers/lock", values: [1.38, 0.06] },
      { label: "createJobs/default", values: [2.72, 0.13] },
      { label: "createJobs/deduplication", values: [2.02, 0.05] },
      { label: "continueJobs/default", values: [2.19, 0.26] },
      { label: "addJobsBlockers/default", values: [4.45, 0.2] },
      { label: "getJobBlockers/default", values: [1.37, 0.19] },
      { label: "unblockJobs/default", values: [4.1, 0.29] },
      { label: "startWorker/default", values: [0.63, 0.03] },
      { label: "extendWorkerLease/default", values: [0.63, 0.04] },
      { label: "stopWorker/default", values: [0.58, 0.03] },
      { label: "startJobAttempts/default", values: [1.32, 0.28] },
      { label: "startJobAttempts/limit10", values: [2.15, 0.5] },
      { label: "completeJobs/default", values: [2.46, 0.36] },
      { label: "getStartAttemptDelayMs/default", values: [2.41, 0.04] },
      { label: "rescheduleJobs/default", values: [2.59, 0.14] },
      { label: "deleteChains/default", values: [5.4, 0.25] },
      { label: "deleteChains/multiJob", values: [3.8, 0.27] },
    ],
  },
] satisfies BenchGroup[];

export const discoveryGroups = [
  {
    rows: [
      { label: "getChainTypeNames/default", values: [0.82, 0.06] },
      { label: "getJobTypeNames/default", values: [0.7, 0.05] },
      { label: "countChainsByTypeName/default", values: [3.14, 1.35] },
      { label: "countJobsByTypeName/default", values: [4.3, 1.38] },
      { label: "countWorkers/default", values: [0.87, 0.03] },
      { label: "countWorkersByTypeName/default", values: [1.1, 0.06] },
      { label: "countRunningJobsByWorkerId/default", values: [1.68, 0.03] },
    ],
  },
] satisfies BenchGroup[];

export const listChainsGroups = [
  {
    label: "No status filter",
    rows: [
      { label: "listChains/noStatus/default", values: [46.64, 0.44] },
      { label: "listChains/noStatus/independent", values: [63.68, 0.53] },
      { label: "listChains/noStatus/nonIndependent", values: [92.45, 94.12] },
      { label: "listChains/noStatus/fromTo", values: [46.63, 0.45] },
      { label: "listChains/noStatus/cursor", values: [96.43, 0.84] },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listChains/running/default", values: [8.95, 0.43] },
      { label: "listChains/running/independent", values: [119.45, 0.54] },
      { label: "listChains/running/nonIndependent", values: [23.78, 16.78] },
      { label: "listChains/running/cursor", values: [18.58, 0.88] },
    ],
  },
  {
    label: "Completed",
    rows: [
      { label: "listChains/completed/default", values: [21.72, 0.45] },
      { label: "listChains/completed/independent", values: [38.89, 0.55] },
      { label: "listChains/completed/nonIndependent", values: [62.43, 42.4] },
      { label: "listChains/completed/orderByCreatedAt", values: [21.89, 0.68] },
      { label: "listChains/completed/orderByCompletedAt", values: [22.26, 0.56] },
      { label: "listChains/completed/cursor", values: [45.75, 0.9] },
      { label: "listChains/completed/orderByCreatedAtCursor", values: [45.53, 0.96] },
      { label: "listChains/completed/orderByCompletedAtCursor", values: [46.36, 0.86] },
    ],
  },
] satisfies BenchGroup[];

export const listJobsGroups = [
  {
    label: "No status filter",
    rows: [
      { label: "listJobs/noStatus/default", values: [54.52, 0.37] },
      { label: "listJobs/noStatus/fromTo", values: [47.72, 0.35] },
      { label: "listJobs/noStatus/cursor", values: [102.67, 0.68] },
    ],
  },
  {
    label: "Pending",
    rows: [
      { label: "listJobs/pending/default", values: [46.13, 0.33] },
      { label: "listJobs/pending/fromTo", values: [46.25, 0.38] },
      { label: "listJobs/pending/orderByCreatedAt", values: [50.3, 0.35] },
      { label: "listJobs/pending/cursor", values: [96.99, 0.66] },
    ],
  },
  {
    label: "Blocked",
    rows: [
      { label: "listJobs/blocked/default", values: [32.09, 0.35] },
      { label: "listJobs/blocked/fromTo", values: [31.37, 0.36] },
      { label: "listJobs/blocked/orderByCreatedAt", values: [33.11, 0.35] },
      { label: "listJobs/blocked/cursor", values: [64.4, 0.65] },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listJobs/running/default", values: [9.03, 0.34] },
      { label: "listJobs/running/orderByCreatedAt", values: [11.14, 0.35] },
      { label: "listJobs/running/cursor", values: [20.12, 0.68] },
    ],
  },
  {
    label: "Completed",
    rows: [
      { label: "listJobs/completed/default", values: [23.53, 0.36] },
      { label: "listJobs/completed/orderByCreatedAt", values: [26.56, 0.36] },
      { label: "listJobs/completed/cursor", values: [46.96, 0.66] },
    ],
  },
] satisfies BenchGroup[];

export const chainJobsGroups = [
  {
    rows: [
      { label: "listChainJobs/default", values: [2.64, 0.47] },
      { label: "listChainJobs/cursor", values: [4.33, 0.92] },
      { label: "listBlockedJobs/default", values: [213.07, 193.56] },
      { label: "listBlockedJobs/cursor", values: [387.94, 393.46] },
    ],
  },
] satisfies BenchGroup[];

export const workerGroups = [
  {
    rows: [
      { label: "listWorkers/default", values: [0.89, 0.12] },
      { label: "listWorkers/typeName", values: [1.09, 0.08] },
      { label: "listWorkers/status", values: [0.77, 0.08] },
      { label: "listWorkers/cursor", values: [1.46, 0.2] },
      { label: "listWorkerJobs/default", values: [1.52, 0.24] },
      { label: "listWorkerJobs/cursor", values: [2.32, 0.41] },
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
