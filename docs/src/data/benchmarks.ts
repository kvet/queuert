import { type BenchGroup } from "../components/BenchChart.tsx";
import { type KeyValueItem } from "../components/KeyValueList.tsx";

export const creationGroups = [
  {
    label: "State adapter (in-process notify)",
    rows: [
      { label: "In-process", values: [88585, 205063] },
      { label: "SQLite (better-sqlite3)", values: [28644, 88850] },
      { label: "SQLite (node:sqlite)", values: [23446, 77073] },
      { label: "PostgreSQL (postgres-js)", values: [870, 30241] },
      { label: "PostgreSQL (pg)", values: [827, 28415] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process", values: [81548, 186412] },
      { label: "Redis (redis)", values: [1275, 79267] },
      { label: "Redis (ioredis)", values: [2340, 100197] },
      { label: "PostgreSQL (pg)", values: [3879, 116092] },
      { label: "PostgreSQL (postgres-js)", values: [4456, 122082] },
      { label: "NATS", values: [4375, 130000] },
    ],
  },
] satisfies BenchGroup[];

export const completionGroups = [
  {
    label: "State adapter (in-process notify)",
    rows: [
      { label: "In-process", values: [4996, 5143, 5389] },
      { label: "SQLite (better-sqlite3)", values: [4700, 5328, 7461] },
      { label: "SQLite (node:sqlite)", values: [3994, 5475, 7994] },
      { label: "PostgreSQL (postgres-js)", values: [367, 853, 1738] },
      { label: "PostgreSQL (pg)", values: [333, 1127, 2327] },
    ],
  },
  {
    label: "Notify adapter (in-process state)",
    rows: [
      { label: "In-process", values: [4863, 4509, 4797] },
      { label: "Redis (redis)", values: [865, 2067, 3504] },
      { label: "Redis (ioredis)", values: [1018, 3987, 4139] },
      { label: "PostgreSQL (pg)", values: [964, 3646, 3719] },
      { label: "PostgreSQL (postgres-js)", values: [992, 3505, 3537] },
      { label: "NATS", values: [1861, 4060, 4111] },
    ],
  },
] satisfies BenchGroup[];

export const memoryGroups = [
  {
    rows: [
      { label: "notify-redis", values: [80, 255, 10, 65] },
      { label: "notify-postgres", values: [500, 680, 10, 75] },
      { label: "notify-nats", values: [435, 570, 10, 45] },
      { label: "state-sqlite", values: [485, 560, 10, 105] },
      { label: "state-postgres", values: [470, 620, 25, 105] },
      { label: "dashboard", values: [665, 835, 10, 100] },
      { label: "otel", values: [65, 240, 10, 110] },
    ],
  },
] satisfies BenchGroup[];

export const typeGroups = [
  {
    rows: [
      {
        label: "Linear: 1 type",
        chips: ["1 type", "17,191 instantiations"],
        meta: "1.0x baseline",
        values: [527, 112],
      },
      {
        label: "Linear: 10 types",
        chips: ["10 types", "22,010 instantiations"],
        meta: "1.3x baseline",
        values: [561, 113],
      },
      {
        label: "Linear: 50 types",
        chips: ["50 types", "43,450 instantiations"],
        meta: "2.5x baseline",
        values: [682, 131],
      },
      {
        label: "Linear: 100 types",
        chips: ["100 types", "70,250 instantiations"],
        meta: "4.1x baseline",
        values: [771, 163],
      },
      {
        label: "Branched: 4w x 3d",
        chips: ["85 types", "62,639 instantiations"],
        meta: "3.6x baseline",
        values: [784, 152],
      },
      {
        label: "Branched: 2w x 6d",
        chips: ["127 types", "85,361 instantiations"],
        meta: "5.0x baseline",
        values: [884, 164],
      },
      {
        label: "Blockers: 8 steps",
        chips: ["30 types", "40,812 instantiations"],
        meta: "2.4x baseline",
        values: [624, 132],
      },
      {
        label: "Blockers: 25 steps",
        chips: ["98 types", "125,081 instantiations"],
        meta: "7.3x baseline",
        values: [843, 185],
      },
      {
        label: "Loop: 20 steps",
        chips: ["21 types", "28,458 instantiations"],
        meta: "1.7x baseline",
        values: [576, 118],
      },
      {
        label: "Loop: 50 steps",
        chips: ["51 types", "44,928 instantiations"],
        meta: "2.6x baseline",
        values: [653, 131],
      },
      {
        label: "Merge: 2 x 50",
        chips: ["100 types", "74,501 instantiations"],
        meta: "4.3x baseline",
        values: [773, 149],
      },
      {
        label: "Merge: 5 x 50",
        chips: ["250 types", "153,884 instantiations"],
        meta: "9.0x baseline",
        values: [1052, 208],
      },
      {
        label: "Merge: 10 x 50",
        chips: ["500 types", "286,737 instantiations"],
        meta: "16.7x baseline",
        values: [1461, 306],
      },
      {
        label: "Merge: 20 x 50",
        chips: ["1,000 types", "552,549 instantiations"],
        meta: "32.1x baseline",
        values: [2278, 518],
      },
      {
        label: "Merge: 50 x 50",
        chips: ["2,500 types", "1,357,277 instantiations"],
        meta: "79.0x baseline",
        values: [5006, 1318],
      },
      {
        label: "Middleware: 10 on linear-100",
        chips: ["100 types", "72,311 instantiations"],
        meta: "4.2x baseline",
        values: [808, 153],
      },
    ],
  },
] satisfies BenchGroup[];

export const operationalGroups = [
  {
    rows: [
      { label: "getChains/default", values: [1.23, 0.25] },
      { label: "getChains/lock", values: [1.85, 0.16] },
      { label: "getJobs/default", values: [1.05, 0.09] },
      { label: "getJobs/lock", values: [2.62, 0.13] },
      { label: "createJobs/default", values: [3.01, 0.19] },
      { label: "createJobs/deduplication", values: [2.18, 0.07] },
      { label: "continueJobs/default", values: [2.19, 0.3] },
      { label: "addJobsBlockers/default", values: [3.94, 0.23] },
      { label: "getJobBlockers/default", values: [1.58, 0.22] },
      { label: "unblockJobs/default", values: [4.99, 0.33] },
      { label: "startJobAttempts/default", values: [3.5, 0.36] },
      { label: "startJobAttempts/limit10", values: [4.13, 0.47] },
      { label: "extendJobAttempt/default", values: [2.2, 0.1] },
      { label: "completeJobs/default", values: [2.57, 0.4] },
      { label: "reclaimExpiredJobAttempts/default", values: [2.1, 0.27] },
      { label: "reclaimExpiredJobAttempts/limit10", values: [2.47, 0.52] },
      { label: "getStartAttemptDelayMs/default", values: [2.05, 0.04] },
      { label: "rescheduleJobs/default", values: [2.46, 0.28] },
      { label: "deleteChains/default", values: [4.43, 0.43] },
      { label: "deleteChains/multiJob", values: [3.3, 0.29] },
    ],
  },
] satisfies BenchGroup[];

export const discoveryGroups = [
  {
    rows: [
      { label: "listChainTypeNames/default", values: [0.87, 0.06] },
      { label: "listJobTypeNames/default", values: [0.95, 0.05] },
      { label: "countByChainTypeNames/default", values: [2.49, 1.22] },
      { label: "countByJobTypeNames/default", values: [4.37, 1.23] },
    ],
  },
] satisfies BenchGroup[];

export const listChainsGroups = [
  {
    label: "No status filter",
    rows: [
      { label: "listChains/noStatus/default", values: [20.32, 0.46] },
      { label: "listChains/noStatus/independent", values: [57.35, 0.58] },
      { label: "listChains/noStatus/nonIndependent", values: [81.45, 98.31] },
      { label: "listChains/noStatus/fromTo", values: [21.73, 0.58] },
      { label: "listChains/noStatus/cursor", values: [46.53, 0.84] },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listChains/running/default", values: [4.52, 0.44] },
      { label: "listChains/running/independent", values: [107.6, 0.62] },
      { label: "listChains/running/nonIndependent", values: [23.61, 20.02] },
      { label: "listChains/running/cursor", values: [11.42, 1.15] },
    ],
  },
  {
    label: "Completed",
    rows: [
      { label: "listChains/completed/default", values: [11.79, 0.76] },
      { label: "listChains/completed/independent", values: [35.32, 0.6] },
      { label: "listChains/completed/nonIndependent", values: [53.92, 45.41] },
      { label: "listChains/completed/orderByCreatedAt", values: [13.45, 0.53] },
      { label: "listChains/completed/orderByCompletedAt", values: [10.58, 0.46] },
      { label: "listChains/completed/cursor", values: [24.87, 0.87] },
      { label: "listChains/completed/orderByCreatedAtCursor", values: [26.84, 0.97] },
      { label: "listChains/completed/orderByCompletedAtCursor", values: [24.59, 0.95] },
    ],
  },
] satisfies BenchGroup[];

export const listJobsGroups = [
  {
    label: "No status filter",
    rows: [
      { label: "listJobs/noStatus/default", values: [22.2, 0.45] },
      { label: "listJobs/noStatus/fromTo", values: [20.41, 0.36] },
      { label: "listJobs/noStatus/cursor", values: [21.49, 0.66] },
    ],
  },
  {
    label: "Pending",
    rows: [
      { label: "listJobs/pending/default", values: [22.54, 0.36] },
      { label: "listJobs/pending/fromTo", values: [22.59, 0.4] },
      { label: "listJobs/pending/orderByCreatedAt", values: [27.23, 0.34] },
      { label: "listJobs/pending/cursor", values: [23.54, 0.66] },
    ],
  },
  {
    label: "Blocked",
    rows: [
      { label: "listJobs/blocked/default", values: [16.09, 0.34] },
      { label: "listJobs/blocked/fromTo", values: [14.73, 0.41] },
      { label: "listJobs/blocked/orderByCreatedAt", values: [17.8, 0.36] },
      { label: "listJobs/blocked/cursor", values: [24, 0.64] },
    ],
  },
  {
    label: "Running",
    rows: [
      { label: "listJobs/running/default", values: [5.71, 7.9] },
      { label: "listJobs/running/orderByCreatedAt", values: [5.64, 0.36] },
      { label: "listJobs/running/orderByAttemptUntil", values: [4.99, 0.38] },
      { label: "listJobs/running/cursor", values: [8.36, 12.12] },
    ],
  },
  {
    label: "Completed",
    rows: [
      { label: "listJobs/completed/default", values: [10.84, 0.37] },
      { label: "listJobs/completed/orderByCreatedAt", values: [12.82, 0.35] },
      { label: "listJobs/completed/cursor", values: [12.71, 0.67] },
    ],
  },
] satisfies BenchGroup[];

export const chainJobsGroups = [
  {
    rows: [
      { label: "listChainJobs/default", values: [2.16, 0.43] },
      { label: "listChainJobs/cursor", values: [5.52, 0.87] },
      { label: "listBlockedJobs/default", values: [143.13, 195.61] },
      { label: "listBlockedJobs/cursor", values: [313.46, 362.46] },
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
