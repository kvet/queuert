import { type SeedSentinelsV2 } from "../conformance/seed-all-states-v2.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";

export type IndexCoverageCaseKey =
  // type discovery
  | "listChainTypeNames/default"
  | "listJobTypeNames/default"
  // counts
  | "countByChainTypeNames/default"
  | "countByJobTypeNames/default"
  // listJobs > no status
  | "listJobs/noStatus/default"
  | "listJobs/noStatus/fromTo"
  | "listJobs/noStatus/cursor"
  // listJobs > pending
  | "listJobs/pending/default"
  | "listJobs/pending/blocked"
  | "listJobs/pending/unblocked"
  | "listJobs/pending/fromTo"
  | "listJobs/pending/orderByCreatedAt"
  | "listJobs/pending/cursor"
  // listJobs > running
  | "listJobs/running/default"
  | "listJobs/running/orderByCreatedAt"
  | "listJobs/running/orderByAttemptUntil"
  | "listJobs/running/cursor"
  // listJobs > completed
  | "listJobs/completed/default"
  | "listJobs/completed/continued"
  | "listJobs/completed/notContinued"
  | "listJobs/completed/orderByCreatedAt"
  | "listJobs/completed/cursor"
  // listChains > no status
  | "listChains/noStatus/default"
  | "listChains/noStatus/independent"
  | "listChains/noStatus/nonIndependent"
  | "listChains/noStatus/fromTo"
  | "listChains/noStatus/cursor"
  // listChains > running
  | "listChains/running/default"
  | "listChains/running/independent"
  | "listChains/running/nonIndependent"
  | "listChains/running/cursor"
  // listChains > completed
  | "listChains/completed/default"
  | "listChains/completed/independent"
  | "listChains/completed/nonIndependent"
  | "listChains/completed/orderByCreatedAt"
  | "listChains/completed/orderByCompletedAt"
  | "listChains/completed/cursor"
  | "listChains/completed/orderByCreatedAtCursor"
  | "listChains/completed/orderByCompletedAtCursor"
  // single-group methods
  | "listChainJobs/default"
  | "listChainJobs/cursor"
  | "listBlockedJobs/default"
  | "listBlockedJobs/cursor"
  | "getChains/default"
  | "getChains/lock"
  | "getJobs/default"
  | "getJobs/lock"
  | "createChains/default"
  | "createChains/deduplication"
  | "createContinuationJob/default"
  | "addJobsBlockers/default"
  | "getJobBlockers/default"
  | "unblockJobs/default"
  | "startJobAttempt/default"
  | "extendJobAttempt/default"
  | "finishJobAttempt/failure"
  | "finishJobAttempt/success"
  | "reclaimExpiredJobAttempt/default"
  | "getStartAttemptDelayMs/default"
  | "rescheduleJobs/default"
  | "deleteChains/default"
  | "deleteChains/cascade";

type Act = (stateAdapter: StateAdapter<any, string>, sentinels: SeedSentinelsV2) => Promise<void>;

export type IndexCoverageCase = {
  key: IndexCoverageCaseKey;
  label: string;
  run: (stateAdapter: StateAdapter<any, string>, sentinels: SeedSentinelsV2) => Promise<Act>;
};

export type IndexCoverageGroup = {
  name: string;
  cases: IndexCoverageCase[];
};

export const observabilityCoverageGroups: IndexCoverageGroup[] = [
  {
    name: "listChainTypeNames",
    cases: [
      {
        key: "listChainTypeNames/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChainTypeNames({});
        },
      },
    ],
  },
  {
    name: "listJobTypeNames",
    cases: [
      {
        key: "listJobTypeNames/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobTypeNames({});
        },
      },
    ],
  },

  {
    name: "countByChainTypeNames",
    cases: [
      {
        key: "countByChainTypeNames/default",
        label: "default",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.countByChainTypeNames({ typeNames: sentinels.pending.typeNames });
        },
      },
    ],
  },
  {
    name: "countByJobTypeNames",
    cases: [
      {
        key: "countByJobTypeNames/default",
        label: "default",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.countByJobTypeNames({ typeNames: sentinels.pending.typeNames });
        },
      },
    ],
  },
  {
    name: "listJobs > no status",
    cases: [
      {
        key: "listJobs/noStatus/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: "seed:pending:order",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/noStatus/fromTo",
        label: "+ from/to",
        run: async () => async (stateAdapter) => {
          const now = new Date();
          const from = new Date(now.getTime() - 3600_000);
          await stateAdapter.listJobs({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: "seed:pending:order",
            from,
            to: now,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/noStatus/cursor",
        label: "cursor",
        run: async () => async (stateAdapter) => {
          const page1 = await stateAdapter.listJobs({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: "seed:pending:order",
            page: { limit: 2 },
          });
          await stateAdapter.listJobs({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: "seed:pending:order",
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
    ],
  },

  {
    name: "listJobs > pending",
    cases: [
      {
        key: "listJobs/pending/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
            typeName: "seed:pending:order",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/pending/blocked",
        label: "+ blocked",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
            typeName: "seed:pending:order",
            blocked: true,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/pending/unblocked",
        label: "+ unblocked",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
            typeName: "seed:pending:order",
            blocked: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/pending/fromTo",
        label: "+ from/to",
        run: async () => async (stateAdapter) => {
          const now = new Date();
          const from = new Date(now.getTime() - 3600_000);
          await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
            typeName: "seed:pending:order",
            from,
            to: now,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/pending/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderDirection: "desc",
            status: "pending",
            typeName: "seed:pending:order",
            orderBy: "createdAt",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/pending/cursor",
        label: "cursor",
        run: async () => async (stateAdapter) => {
          const page1 = await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
            typeName: "seed:pending:order",
            blocked: false,
            page: { limit: 2 },
          });
          await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
            typeName: "seed:pending:order",
            blocked: false,
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
    ],
  },

  {
    name: "listJobs > running",
    cases: [
      {
        key: "listJobs/running/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "attemptAt",
            orderDirection: "desc",
            status: "running",
            typeName: "seed:running:order",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/running/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderDirection: "desc",
            status: "running",
            typeName: "seed:running:order",
            orderBy: "createdAt",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/running/orderByAttemptUntil",
        label: "+ orderBy:attemptUntil",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderDirection: "desc",
            status: "running",
            typeName: "seed:running:order",
            orderBy: "attemptUntil",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/running/cursor",
        label: "cursor",
        run: async () => async (stateAdapter) => {
          const page1 = await stateAdapter.listJobs({
            orderBy: "attemptAt",
            orderDirection: "desc",
            status: "running",
            typeName: "seed:running:order",
            page: { limit: 2 },
          });
          await stateAdapter.listJobs({
            orderBy: "attemptAt",
            orderDirection: "desc",
            status: "running",
            typeName: "seed:running:order",
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
    ],
  },

  {
    name: "listJobs > completed",
    cases: [
      {
        key: "listJobs/completed/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/completed/continued",
        label: "+ continued",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            continued: true,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/completed/notContinued",
        label: "+ not continued",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            continued: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/completed/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            orderBy: "createdAt",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/completed/cursor",
        label: "cursor",
        run: async () => async (stateAdapter) => {
          const page1 = await stateAdapter.listJobs({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            page: { limit: 2 },
          });
          await stateAdapter.listJobs({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
    ],
  },

  {
    name: "listChains > no status",
    cases: [
      {
        key: "listChains/noStatus/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: "seed:pending:order",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/noStatus/independent",
        label: "+ independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: "seed:pending:order",
            independent: true,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/noStatus/nonIndependent",
        label: "+ non-independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: "seed:pending:order",
            independent: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/noStatus/fromTo",
        label: "+ from/to",
        run: async () => async (stateAdapter) => {
          const now = new Date();
          const from = new Date(now.getTime() - 3600_000);
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: "seed:pending:order",
            from,
            to: now,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/noStatus/cursor",
        label: "cursor",
        run: async () => async (stateAdapter) => {
          const page1 = await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: "seed:pending:order",
            page: { limit: 2 },
          });
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: "seed:pending:order",
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
    ],
  },

  {
    name: "listChains > running",
    cases: [
      {
        key: "listChains/running/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            status: "running",
            typeName: "seed:running:order",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/running/independent",
        label: "+ independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            status: "running",
            typeName: "seed:running:order",
            independent: true,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/running/nonIndependent",
        label: "+ non-independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            status: "running",
            typeName: "seed:running:order",
            independent: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/running/cursor",
        label: "cursor",
        run: async () => async (stateAdapter) => {
          const page1 = await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            status: "running",
            typeName: "seed:running:order",
            page: { limit: 2 },
          });
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            status: "running",
            typeName: "seed:running:order",
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
    ],
  },

  {
    name: "listChains > completed",
    cases: [
      {
        key: "listChains/completed/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/completed/independent",
        label: "+ independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            independent: true,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/completed/nonIndependent",
        label: "+ non-independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            independent: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/completed/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            orderBy: "createdAt",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/completed/orderByCompletedAt",
        label: "+ orderBy:completedAt",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            orderBy: "completedAt",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/completed/cursor",
        label: "cursor",
        run: async () => async (stateAdapter) => {
          const page1 = await stateAdapter.listChains({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            page: { limit: 2 },
          });
          await stateAdapter.listChains({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
      {
        key: "listChains/completed/orderByCreatedAtCursor",
        label: "+ orderBy:createdAt cursor",
        run: async () => async (stateAdapter) => {
          const page1 = await stateAdapter.listChains({
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            orderBy: "createdAt",
            page: { limit: 2 },
          });
          await stateAdapter.listChains({
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            orderBy: "createdAt",
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
      {
        key: "listChains/completed/orderByCompletedAtCursor",
        label: "+ orderBy:completedAt cursor",
        run: async () => async (stateAdapter) => {
          const page1 = await stateAdapter.listChains({
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            orderBy: "completedAt",
            page: { limit: 2 },
          });
          await stateAdapter.listChains({
            orderDirection: "desc",
            status: "completed",
            typeName: "seed:completed:order",
            orderBy: "completedAt",
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
    ],
  },

  {
    name: "listChainJobs",
    cases: [
      {
        key: "listChainJobs/default",
        label: "default",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.listChainJobs({
            orderDirection: "asc",
            chainId: sentinels.longChain.chainId,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChainJobs/cursor",
        label: "cursor",
        run: async () => async (stateAdapter, sentinels) => {
          const page1 = await stateAdapter.listChainJobs({
            orderDirection: "asc",
            chainId: sentinels.longChain.chainId,
            page: { limit: 2 },
          });
          await stateAdapter.listChainJobs({
            orderDirection: "asc",
            chainId: sentinels.longChain.chainId,
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
    ],
  },

  {
    name: "listBlockedJobs",
    cases: [
      {
        key: "listBlockedJobs/default",
        label: "default",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.listBlockedJobs({
            orderDirection: "desc",
            chainId: sentinels.fanIn.blockerChainIds[0],
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listBlockedJobs/cursor",
        label: "cursor",
        run: async () => async (stateAdapter, sentinels) => {
          const page1 = await stateAdapter.listBlockedJobs({
            orderDirection: "desc",
            chainId: sentinels.fanIn.blockerChainIds[0],
            page: { limit: 2 },
          });
          await stateAdapter.listBlockedJobs({
            orderDirection: "desc",
            chainId: sentinels.fanIn.blockerChainIds[0],
            page: { limit: 20, cursor: page1.nextCursor! },
          });
        },
      },
    ],
  },
];

export const operationalCoverageGroups: IndexCoverageGroup[] = [
  {
    name: "getChains",
    cases: [
      {
        key: "getChains/default",
        label: "default",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.getChains({ chainIds: [sentinels.longChain.chainId] });
        },
      },
      {
        key: "getChains/lock",
        label: "+ lock",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.getChains({
              txCtx,
              chainIds: [sentinels.longChain.chainId],
              lock: "exclusive",
            }),
          );
        },
      },
    ],
  },

  {
    name: "getJobs",
    cases: [
      {
        key: "getJobs/default",
        label: "default",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.getJobs({ jobIds: [sentinels.pending.jobId] });
        },
      },
      {
        key: "getJobs/lock",
        label: "+ lock",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.getJobs({ txCtx, jobIds: [sentinels.pending.jobId], lock: "exclusive" }),
          );
        },
      },
    ],
  },

  {
    name: "createChains",
    cases: [
      {
        key: "createChains/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [{ typeName: "idx:test", input: {} }],
            }),
          );
        },
      },
      {
        key: "createChains/deduplication",
        label: "+ deduplication",
        run: async () => async (stateAdapter) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "idx:dedup",
                  input: {},
                  deduplication: { key: "idx-dedup-key", scope: "running" },
                },
              ],
            }),
          );
        },
      },
    ],
  },

  {
    name: "createContinuationJob",
    cases: [
      {
        key: "createContinuationJob/default",
        label: "default",
        run: async (stateAdapter) => {
          const { job } = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({
              txCtx,
              typeNames: ["seed:throwaway:pending"],
              workerId: "w-cont",
            }),
          );
          if (!job) return async () => {};
          return async (stateAdapter) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.createContinuationJob({
                txCtx,
                job: { typeName: "idx:cont", input: {}, continueFromId: job.id },
              }),
            );
          };
        },
      },
    ],
  },

  {
    name: "addJobsBlockers",
    cases: [
      {
        key: "addJobsBlockers/default",
        label: "default",
        run: async (stateAdapter, sentinels) => {
          const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "idx:blocker-target",
                  input: {},
                },
              ],
            }),
          );
          return async (stateAdapter) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [{ jobId: job.id, blockedByChainIds: [sentinels.longChain.chainId] }],
              }),
            );
          };
        },
      },
    ],
  },

  {
    name: "getJobBlockers",
    cases: [
      {
        key: "getJobBlockers/default",
        label: "default",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.getJobBlockers({ jobId: sentinels.fanIn.blockedJobId });
        },
      },
    ],
  },

  {
    name: "unblockJobs",
    cases: [
      {
        key: "unblockJobs/default",
        label: "default",
        run: async (_stateAdapter, sentinels) => {
          const chainId = sentinels.throwaway.unblockerChainIds.shift();
          if (!chainId) return async () => {};
          return async (stateAdapter) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId }),
            );
          };
        },
      },
    ],
  },

  {
    name: "startJobAttempt",
    cases: [
      {
        key: "startJobAttempt/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({
              txCtx,
              typeNames: ["seed:throwaway:pending"],
              workerId: "w-idx",
            }),
          );
        },
      },
    ],
  },

  {
    name: "extendJobAttempt",
    cases: [
      {
        key: "extendJobAttempt/default",
        label: "default",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.extendJobAttempt({
              txCtx,
              jobId: sentinels.running.jobId,
              workerId: "seed-worker",
              timeoutMs: 60_000,
            }),
          );
        },
      },
    ],
  },

  {
    name: "finishJobAttempt",
    cases: [
      {
        key: "finishJobAttempt/failure",
        label: "failure",
        run: async (stateAdapter) => {
          const { job } = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({
              txCtx,
              typeNames: ["seed:throwaway:pending"],
              workerId: "w-fail",
            }),
          );
          if (!job) return async () => {};
          return async (stateAdapter) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.finishJobAttempt({
                txCtx,
                jobId: job.id,
                workerId: "w-fail",
                outcome: { error: "test", schedule: { afterMs: 60_000 } },
              }),
            );
          };
        },
      },
      {
        key: "finishJobAttempt/success",
        label: "success",
        run: async (stateAdapter) => {
          const { job } = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({
              txCtx,
              typeNames: ["seed:throwaway:pending"],
              workerId: "w-ok",
            }),
          );
          if (!job) return async () => {};
          return async (stateAdapter) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.finishJobAttempt({
                txCtx,
                jobId: job.id,
                workerId: "w-ok",
                outcome: { output: { ok: true } },
              }),
            );
          };
        },
      },
    ],
  },

  {
    name: "reclaimExpiredJobAttempt",
    cases: [
      {
        key: "reclaimExpiredJobAttempt/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.reclaimExpiredJobAttempt({
              txCtx,
              typeNames: ["seed:throwaway:expired"],
              ignoredJobIds: [],
            }),
          );
        },
      },
    ],
  },

  {
    name: "getStartAttemptDelayMs",
    cases: [
      {
        key: "getStartAttemptDelayMs/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.getStartAttemptDelayMs({
              txCtx,
              typeNames: ["seed:throwaway:pending"],
            }),
          );
        },
      },
    ],
  },

  {
    name: "rescheduleJobs",
    cases: [
      {
        key: "rescheduleJobs/default",
        label: "default",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.rescheduleJobs({
              txCtx,
              jobIds: [sentinels.pending.jobId],
              schedule: { afterMs: 1000 },
            }),
          );
        },
      },
    ],
  },

  {
    name: "deleteChains",
    cases: [
      {
        key: "deleteChains/default",
        label: "default",
        run: async (_stateAdapter, sentinels) => {
          const chainId = sentinels.throwaway.chainIds.shift();
          if (!chainId) return async () => {};
          return async (stateAdapter) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.deleteChains({ txCtx, chainIds: [chainId] }),
            );
          };
        },
      },
      {
        key: "deleteChains/cascade",
        label: "+ cascade",
        run: async (_stateAdapter, sentinels) => {
          const chainId = sentinels.throwaway.cascadeChainIds.shift();
          if (!chainId) return async () => {};
          return async (stateAdapter) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.deleteChains({ txCtx, chainIds: [chainId], cascade: true }),
            );
          };
        },
      },
    ],
  },
];

export const indexCoverageGroups: IndexCoverageGroup[] = [
  ...observabilityCoverageGroups,
  ...operationalCoverageGroups,
];
