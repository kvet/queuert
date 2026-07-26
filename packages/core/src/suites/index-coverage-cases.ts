import { type SeedSentinelsV2 } from "../conformance/seed-all-states-v2.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";

export type IndexCoverageCaseKey =
  // listJobs > no status
  | "listJobs/noStatus/default"
  | "listJobs/noStatus/typeName"
  | "listJobs/noStatus/chainTypeName"
  | "listJobs/noStatus/chainId"
  | "listJobs/noStatus/jobId"
  | "listJobs/noStatus/fromTo"
  | "listJobs/noStatus/cursor"
  // listJobs > pending
  | "listJobs/pending/default"
  | "listJobs/pending/blocked"
  | "listJobs/pending/unblocked"
  | "listJobs/pending/typeName"
  | "listJobs/pending/typeNameBlocked"
  | "listJobs/pending/typeNameUnblocked"
  | "listJobs/pending/chainTypeName"
  | "listJobs/pending/fromTo"
  | "listJobs/pending/orderByCreatedAt"
  | "listJobs/pending/cursor"
  // listJobs > running
  | "listJobs/running/default"
  | "listJobs/running/typeName"
  | "listJobs/running/chainTypeName"
  | "listJobs/running/orderByCreatedAt"
  | "listJobs/running/orderByAttemptUntil"
  | "listJobs/running/cursor"
  // listJobs > completed
  | "listJobs/completed/default"
  | "listJobs/completed/typeName"
  | "listJobs/completed/chainTypeName"
  | "listJobs/completed/continued"
  | "listJobs/completed/notContinued"
  | "listJobs/completed/typeNameContinued"
  | "listJobs/completed/typeNameNotContinued"
  | "listJobs/completed/orderByCreatedAt"
  | "listJobs/completed/cursor"
  // listChains > no status
  | "listChains/noStatus/default"
  | "listChains/noStatus/typeName"
  | "listChains/noStatus/independent"
  | "listChains/noStatus/nonIndependent"
  | "listChains/noStatus/typeNameIndependent"
  | "listChains/noStatus/typeNameNonIndependent"
  | "listChains/noStatus/fromTo"
  | "listChains/noStatus/chainId"
  | "listChains/noStatus/cursor"
  // listChains > running
  | "listChains/running/default"
  | "listChains/running/typeName"
  | "listChains/running/independent"
  | "listChains/running/nonIndependent"
  | "listChains/running/typeNameIndependent"
  | "listChains/running/typeNameNonIndependent"
  | "listChains/running/cursor"
  // listChains > completed
  | "listChains/completed/default"
  | "listChains/completed/typeName"
  | "listChains/completed/independent"
  | "listChains/completed/nonIndependent"
  | "listChains/completed/typeNameIndependent"
  | "listChains/completed/typeNameNonIndependent"
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
    name: "listJobs > no status",
    cases: [
      {
        key: "listJobs/noStatus/default",
        label: "default",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/noStatus/typeName",
        label: "+ typeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: ["seed:pending:order"],
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/noStatus/chainTypeName",
        label: "+ chainTypeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "createdAt",
            orderDirection: "desc",
            chainTypeName: ["seed:pending:order"],
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/noStatus/chainId",
        label: "+ chainId",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.listJobs({
            orderBy: "createdAt",
            orderDirection: "desc",
            chainId: [sentinels.longChain.chainId],
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/noStatus/jobId",
        label: "+ jobId",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.listJobs({
            orderBy: "createdAt",
            orderDirection: "desc",
            jobId: [sentinels.pending.jobId],
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
            page: { limit: 2 },
          });
          await stateAdapter.listJobs({
            orderBy: "createdAt",
            orderDirection: "desc",
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
            blocked: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/pending/typeName",
        label: "+ typeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
            typeName: ["seed:pending:order"],
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/pending/typeNameBlocked",
        label: "+ typeName + blocked",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
            typeName: ["seed:blocked:fanin:1"],
            blocked: true,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/pending/typeNameUnblocked",
        label: "+ typeName + unblocked",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
            typeName: ["seed:pending:order"],
            blocked: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/pending/chainTypeName",
        label: "+ chainTypeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
            chainTypeName: ["seed:pending:order"],
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
            blocked: false,
            page: { limit: 2 },
          });
          await stateAdapter.listJobs({
            orderBy: "scheduledAt",
            orderDirection: "desc",
            status: "pending",
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
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/running/typeName",
        label: "+ typeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "attemptAt",
            orderDirection: "desc",
            status: "running",
            typeName: ["seed:running:order"],
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/running/chainTypeName",
        label: "+ chainTypeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "attemptAt",
            orderDirection: "desc",
            status: "running",
            chainTypeName: ["seed:running:order"],
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
            page: { limit: 2 },
          });
          await stateAdapter.listJobs({
            orderBy: "attemptAt",
            orderDirection: "desc",
            status: "running",
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
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/completed/typeName",
        label: "+ typeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: ["seed:completed:order"],
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/completed/chainTypeName",
        label: "+ chainTypeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            chainTypeName: ["seed:completed:order"],
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
            continued: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/completed/typeNameContinued",
        label: "+ typeName + continued",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: ["seed:chain"],
            continued: true,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listJobs/completed/typeNameNotContinued",
        label: "+ typeName + not continued",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listJobs({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: ["seed:completed:order"],
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
            page: { limit: 2 },
          });
          await stateAdapter.listJobs({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
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
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/noStatus/typeName",
        label: "+ typeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: ["seed:pending:order"],
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
            independent: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/noStatus/typeNameIndependent",
        label: "+ typeName + independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: ["seed:pending:order"],
            independent: true,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/noStatus/typeNameNonIndependent",
        label: "+ typeName + non-independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            typeName: ["seed:pending:order"],
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
            from,
            to: now,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/noStatus/chainId",
        label: "+ chainId",
        run: async () => async (stateAdapter, sentinels) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            chainId: [sentinels.longChain.chainId],
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
            page: { limit: 2 },
          });
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
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
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/running/typeName",
        label: "+ typeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            status: "running",
            typeName: ["seed:running:order"],
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
            independent: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/running/typeNameIndependent",
        label: "+ typeName + independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            status: "running",
            typeName: ["seed:running:order"],
            independent: true,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/running/typeNameNonIndependent",
        label: "+ typeName + non-independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            status: "running",
            typeName: ["seed:running:order"],
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
            page: { limit: 2 },
          });
          await stateAdapter.listChains({
            orderBy: "createdAt",
            orderDirection: "desc",
            status: "running",
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
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/completed/typeName",
        label: "+ typeName",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: ["seed:completed:order"],
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
            independent: false,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/completed/typeNameIndependent",
        label: "+ typeName + independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: ["seed:completed:order"],
            independent: true,
            page: { limit: 20 },
          });
        },
      },
      {
        key: "listChains/completed/typeNameNonIndependent",
        label: "+ typeName + non-independent",
        run: async () => async (stateAdapter) => {
          await stateAdapter.listChains({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
            typeName: ["seed:completed:order"],
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
            page: { limit: 2 },
          });
          await stateAdapter.listChains({
            orderBy: "completedAt",
            orderDirection: "desc",
            status: "completed",
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
            orderBy: "createdAt",
            page: { limit: 2 },
          });
          await stateAdapter.listChains({
            orderDirection: "desc",
            status: "completed",
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
            orderBy: "completedAt",
            page: { limit: 2 },
          });
          await stateAdapter.listChains({
            orderDirection: "desc",
            status: "completed",
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
              jobs: [{ typeName: "idx:test", chainTypeName: "idx:test", input: {} }],
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
                  chainTypeName: "idx:dedup",
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
                  chainTypeName: "idx:blocker-target",
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
