import type { MaybePromise } from "@queuert/helpers/maybe-promise";
import { step } from "@queuert/helpers/steps";

import { inMode, inTransaction } from "../conformance/adapters.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import type { SeedSentinels } from "./seed-all-states.ts";

export type IndexCoverageCaseKey =
  // type discovery
  | "getChainTypeNames/default"
  | "getJobTypeNames/default"
  // counts
  | "countChainsByTypeName/default"
  | "countJobsByTypeName/default"
  | "countWorkers/default"
  | "countWorkersByTypeName/default"
  | "countRunningJobsByWorkerId/default"
  // listJobs > no status
  | "listJobs/noStatus/default"
  | "listJobs/noStatus/fromTo"
  | "listJobs/noStatus/cursor"
  // listJobs > pending
  | "listJobs/pending/default"
  | "listJobs/pending/fromTo"
  | "listJobs/pending/orderByCreatedAt"
  | "listJobs/pending/cursor"
  // listJobs > blocked
  | "listJobs/blocked/default"
  | "listJobs/blocked/fromTo"
  | "listJobs/blocked/orderByCreatedAt"
  | "listJobs/blocked/cursor"
  // listJobs > running
  | "listJobs/running/default"
  | "listJobs/running/orderByCreatedAt"
  | "listJobs/running/cursor"
  // listJobs > completed
  | "listJobs/completed/default"
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
  | "listWorkers/default"
  | "listWorkers/typeName"
  | "listWorkers/status"
  | "listWorkers/cursor"
  | "listWorkerJobs/default"
  | "listWorkerJobs/cursor"
  | "getChains/default"
  | "getChains/lock"
  | "getJobs/default"
  | "getJobs/lock"
  | "getWorkers/default"
  | "getWorkers/lock"
  | "createJobs/default"
  | "createJobs/deduplication"
  | "continueJobs/default"
  | "addJobsBlockers/default"
  | "getJobBlockers/default"
  | "unblockJobs/default"
  | "startWorker/default"
  | "extendWorkerLease/default"
  | "stopWorker/default"
  | "startJobAttempts/default"
  | "startJobAttempts/limit10"
  | "completeJobs/default"
  | "getStartAttemptDelayMs/default"
  | "rescheduleJobs/default"
  | "deleteChains/default"
  | "deleteChains/multiJob";

type CoverageStateAdapter = StateAdapter<any, string, string>;

type Act = (stateAdapter: CoverageStateAdapter, sentinels: SeedSentinels) => MaybePromise<void>;

/**
 * A query whose plan the index coverage checks. `run` prepares what the query needs and returns
 * the act that issues it, both in the adapter's mode: synchronously over a sync adapter.
 */
export type IndexCoverageCase = {
  key: IndexCoverageCaseKey;
  label: string;
  run: (stateAdapter: CoverageStateAdapter, sentinels: SeedSentinels) => MaybePromise<Act>;
};

export type IndexCoverageGroup = {
  name: string;
  cases: IndexCoverageCase[];
};

export const observabilityCoverageGroups: IndexCoverageGroup[] = [
  {
    name: "getChainTypeNames",
    cases: [
      {
        key: "getChainTypeNames/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(stateAdapter.getChainTypeNames({}));
          }),
      },
    ],
  },
  {
    name: "getJobTypeNames",
    cases: [
      {
        key: "getJobTypeNames/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(stateAdapter.getJobTypeNames({}));
          }),
      },
    ],
  },

  {
    name: "countChainsByTypeName",
    cases: [
      {
        key: "countChainsByTypeName/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.countChainsByTypeName({
                typeNames: [...sentinels.pending.typeNames, "seed:blocked:fanin:1"],
              }),
            );
          }),
      },
    ],
  },
  {
    name: "countJobsByTypeName",
    cases: [
      {
        key: "countJobsByTypeName/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.countJobsByTypeName({
                typeNames: [...sentinels.pending.typeNames, "seed:blocked:fanin:1"],
              }),
            );
          }),
      },
    ],
  },
  {
    name: "countWorkers",
    cases: [
      {
        key: "countWorkers/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(stateAdapter.countWorkers({}));
          }),
      },
    ],
  },
  {
    name: "countWorkersByTypeName",
    cases: [
      {
        key: "countWorkersByTypeName/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.countWorkersByTypeName({ typeNames: sentinels.pending.typeNames }),
            );
          }),
      },
    ],
  },
  {
    name: "countRunningJobsByWorkerId",
    cases: [
      {
        key: "countRunningJobsByWorkerId/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.countRunningJobsByWorkerId({
                workerIds: [sentinels.workers.busyWorkerId, ...sentinels.workers.idleWorkerIds],
              }),
            );
          }),
      },
    ],
  },
  {
    name: "listJobs > no status",
    cases: [
      {
        key: "listJobs/noStatus/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listJobs({
                orderBy: "createdAt",
                orderDirection: "desc",
                typeName: "seed:pending:order",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/noStatus/fromTo",
        label: "+ from/to",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const now = new Date();
            const from = new Date(now.getTime() - 3600_000);
            yield* step(
              stateAdapter.listJobs({
                orderBy: "createdAt",
                orderDirection: "desc",
                typeName: "seed:pending:order",
                from,
                to: now,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/noStatus/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listJobs({
                orderBy: "createdAt",
                orderDirection: "desc",
                typeName: "seed:pending:order",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listJobs({
                orderBy: "createdAt",
                orderDirection: "desc",
                typeName: "seed:pending:order",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listJobs > pending",
    cases: [
      {
        key: "listJobs/pending/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listJobs({
                orderBy: "scheduledAt",
                orderDirection: "desc",
                status: "pending",
                typeName: "seed:pending:order",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/pending/fromTo",
        label: "+ from/to",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const now = new Date();
            const from = new Date(now.getTime() - 3600_000);
            yield* step(
              stateAdapter.listJobs({
                orderBy: "scheduledAt",
                orderDirection: "desc",
                status: "pending",
                typeName: "seed:pending:order",
                from,
                to: now,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/pending/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listJobs({
                orderDirection: "desc",
                status: "pending",
                typeName: "seed:pending:order",
                orderBy: "createdAt",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/pending/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listJobs({
                orderBy: "scheduledAt",
                orderDirection: "desc",
                status: "pending",
                typeName: "seed:pending:order",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listJobs({
                orderBy: "scheduledAt",
                orderDirection: "desc",
                status: "pending",
                typeName: "seed:pending:order",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listJobs > blocked",
    cases: [
      {
        key: "listJobs/blocked/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listJobs({
                orderBy: "scheduledAt",
                orderDirection: "desc",
                status: "blocked",
                typeName: "seed:blocked:fanin:1",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/blocked/fromTo",
        label: "+ from/to",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const now = new Date();
            const from = new Date(now.getTime() - 3600_000);
            yield* step(
              stateAdapter.listJobs({
                orderBy: "scheduledAt",
                orderDirection: "desc",
                status: "blocked",
                typeName: "seed:blocked:fanin:1",
                from,
                to: now,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/blocked/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listJobs({
                orderDirection: "desc",
                status: "blocked",
                typeName: "seed:blocked:fanin:1",
                orderBy: "createdAt",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/blocked/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listJobs({
                orderBy: "scheduledAt",
                orderDirection: "desc",
                status: "blocked",
                typeName: "seed:blocked:fanin:1",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listJobs({
                orderBy: "scheduledAt",
                orderDirection: "desc",
                status: "blocked",
                typeName: "seed:blocked:fanin:1",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listJobs > running",
    cases: [
      {
        key: "listJobs/running/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listJobs({
                orderBy: "attemptAt",
                orderDirection: "desc",
                status: "running",
                typeName: "seed:running:order",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/running/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listJobs({
                orderDirection: "desc",
                status: "running",
                typeName: "seed:running:order",
                orderBy: "createdAt",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/running/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listJobs({
                orderBy: "attemptAt",
                orderDirection: "desc",
                status: "running",
                typeName: "seed:running:order",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listJobs({
                orderBy: "attemptAt",
                orderDirection: "desc",
                status: "running",
                typeName: "seed:running:order",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listJobs > completed",
    cases: [
      {
        key: "listJobs/completed/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listJobs({
                orderBy: "completedAt",
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/completed/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listJobs({
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                orderBy: "createdAt",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listJobs/completed/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listJobs({
                orderBy: "completedAt",
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listJobs({
                orderBy: "completedAt",
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listChains > no status",
    cases: [
      {
        key: "listChains/noStatus/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                typeName: "seed:pending:order",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/noStatus/independent",
        label: "+ independent",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                typeName: "seed:pending:order",
                independent: true,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/noStatus/nonIndependent",
        label: "+ non-independent",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                typeName: "seed:pending:order",
                independent: false,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/noStatus/fromTo",
        label: "+ from/to",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const now = new Date();
            const from = new Date(now.getTime() - 3600_000);
            yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                typeName: "seed:pending:order",
                from,
                to: now,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/noStatus/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                typeName: "seed:pending:order",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                typeName: "seed:pending:order",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listChains > running",
    cases: [
      {
        key: "listChains/running/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                status: "running",
                typeName: "seed:running:order",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/running/independent",
        label: "+ independent",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                status: "running",
                typeName: "seed:running:order",
                independent: true,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/running/nonIndependent",
        label: "+ non-independent",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                status: "running",
                typeName: "seed:running:order",
                independent: false,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/running/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                status: "running",
                typeName: "seed:running:order",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listChains({
                orderBy: "createdAt",
                orderDirection: "desc",
                status: "running",
                typeName: "seed:running:order",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listChains > completed",
    cases: [
      {
        key: "listChains/completed/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderBy: "completedAt",
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/completed/independent",
        label: "+ independent",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderBy: "completedAt",
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                independent: true,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/completed/nonIndependent",
        label: "+ non-independent",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderBy: "completedAt",
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                independent: false,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/completed/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                orderBy: "createdAt",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/completed/orderByCompletedAt",
        label: "+ orderBy:completedAt",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChains({
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                orderBy: "completedAt",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChains/completed/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listChains({
                orderBy: "completedAt",
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listChains({
                orderBy: "completedAt",
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
      {
        key: "listChains/completed/orderByCreatedAtCursor",
        label: "+ orderBy:createdAt cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listChains({
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                orderBy: "createdAt",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listChains({
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                orderBy: "createdAt",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
      {
        key: "listChains/completed/orderByCompletedAtCursor",
        label: "+ orderBy:completedAt cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listChains({
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                orderBy: "completedAt",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listChains({
                orderDirection: "desc",
                status: "completed",
                typeName: "seed:completed:order",
                orderBy: "completedAt",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listChainJobs",
    cases: [
      {
        key: "listChainJobs/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listChainJobs({
                orderDirection: "asc",
                chainId: sentinels.longChain.chainId,
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listChainJobs/cursor",
        label: "cursor",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listChainJobs({
                orderDirection: "asc",
                chainId: sentinels.longChain.chainId,
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listChainJobs({
                orderDirection: "asc",
                chainId: sentinels.longChain.chainId,
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listBlockedJobs",
    cases: [
      {
        key: "listBlockedJobs/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listBlockedJobs({
                orderDirection: "desc",
                chainId: sentinels.fanIn.blockerChainIds[0],
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listBlockedJobs/cursor",
        label: "cursor",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listBlockedJobs({
                orderDirection: "desc",
                chainId: sentinels.fanIn.blockerChainIds[0],
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listBlockedJobs({
                orderDirection: "desc",
                chainId: sentinels.fanIn.blockerChainIds[0],
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listWorkers",
    cases: [
      {
        key: "listWorkers/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(stateAdapter.listWorkers({ orderDirection: "asc", page: { limit: 20 } }));
          }),
      },
      {
        key: "listWorkers/typeName",
        label: "+ typeName",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listWorkers({
                typeName: sentinels.pending.typeNames[0],
                orderDirection: "asc",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listWorkers/status",
        label: "+ status",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listWorkers({
                status: "expired",
                orderDirection: "asc",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listWorkers/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listWorkers({
                orderDirection: "asc",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listWorkers({
                orderDirection: "asc",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
      },
    ],
  },

  {
    name: "listWorkerJobs",
    cases: [
      {
        key: "listWorkerJobs/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.listWorkerJobs({
                workerId: sentinels.workers.busyWorkerId,
                orderDirection: "asc",
                page: { limit: 20 },
              }),
            );
          }),
      },
      {
        key: "listWorkerJobs/cursor",
        label: "cursor",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            const page1 = yield* step(
              stateAdapter.listWorkerJobs({
                workerId: sentinels.workers.busyWorkerId,
                orderDirection: "asc",
                page: { limit: 2 },
              }),
            );
            yield* step(
              stateAdapter.listWorkerJobs({
                workerId: sentinels.workers.busyWorkerId,
                orderDirection: "asc",
                page: { limit: 20, cursor: page1.nextCursor! },
              }),
            );
          }),
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
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(stateAdapter.getChains({ chainIds: [sentinels.longChain.chainId] }));
          }),
      },
      {
        key: "getChains/lock",
        label: "+ lock",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              inTransaction(stateAdapter, (txCtx) =>
                stateAdapter.getChains({
                  txCtx,
                  chainIds: [sentinels.longChain.chainId],
                  lock: "exclusive",
                }),
              ),
            );
          }),
      },
    ],
  },

  {
    name: "getJobs",
    cases: [
      {
        key: "getJobs/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(stateAdapter.getJobs({ jobIds: [sentinels.pending.jobId] }));
          }),
      },
      {
        key: "getJobs/lock",
        label: "+ lock",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              inTransaction(stateAdapter, (txCtx) =>
                stateAdapter.getJobs({
                  txCtx,
                  jobIds: [sentinels.pending.jobId],
                  lock: "exclusive",
                }),
              ),
            );
          }),
      },
    ],
  },

  {
    name: "getWorkers",
    cases: [
      {
        key: "getWorkers/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(stateAdapter.getWorkers({ workerIds: sentinels.workers.idleWorkerIds }));
          }),
      },
      {
        key: "getWorkers/lock",
        label: "+ lock",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              inTransaction(stateAdapter, (txCtx) =>
                stateAdapter.getWorkers({
                  txCtx,
                  workerIds: sentinels.workers.idleWorkerIds,
                  lock: "exclusive",
                }),
              ),
            );
          }),
      },
    ],
  },

  {
    name: "createJobs",
    cases: [
      {
        key: "createJobs/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              inTransaction(stateAdapter, (txCtx) =>
                stateAdapter.createJobs({
                  txCtx,
                  jobs: [
                    { id: stateAdapter.config.generateJobId(), typeName: "idx:test", input: {} },
                  ],
                }),
              ),
            );
          }),
      },
      {
        key: "createJobs/deduplication",
        label: "+ deduplication",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              inTransaction(stateAdapter, (txCtx) =>
                stateAdapter.createJobs({
                  txCtx,
                  jobs: [
                    {
                      id: stateAdapter.config.generateJobId(),
                      typeName: "idx:dedup",
                      input: {},
                      deduplication: { key: "idx-dedup-key", scope: "running" },
                    },
                  ],
                }),
              ),
            );
          }),
      },
    ],
  },

  {
    name: "continueJobs",
    cases: [
      {
        key: "continueJobs/default",
        label: "default",
        run: (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const worker = yield* step(
              stateAdapter.startWorker({
                workerId: stateAdapter.config.generateWorkerId(),
                typeNames: ["seed:throwaway:pending"],
                concurrency: 1,
                leaseMs: 60_000,
              }),
            );
            const [acquired] = yield* step(
              stateAdapter.startJobAttempts({
                typeNames: ["seed:throwaway:pending"],
                workerId: worker.id,
                workerToken: worker.token,
                limit: 1,
              }),
            );
            if (!acquired) return () => {};
            return (stateAdapter: CoverageStateAdapter) =>
              inMode(stateAdapter, function* () {
                yield* step(
                  inTransaction(stateAdapter, (txCtx) =>
                    stateAdapter.continueJobs({
                      txCtx,
                      jobs: [
                        {
                          id: stateAdapter.config.generateJobId(),
                          typeName: "idx:cont",
                          input: {},
                          continueFromId: acquired.id,
                          attemptToken: acquired.attemptToken!,
                          workerId: acquired.attemptBy!,
                        },
                      ],
                    }),
                  ),
                );
              });
          }),
      },
    ],
  },

  {
    name: "addJobsBlockers",
    cases: [
      {
        key: "addJobsBlockers/default",
        label: "default",
        run: (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            const [stateChain] = yield* step(
              inTransaction(stateAdapter, (txCtx) =>
                stateAdapter.createJobs({
                  txCtx,
                  jobs: [
                    {
                      id: stateAdapter.config.generateJobId(),
                      typeName: "idx:blocker-target",
                      input: {},
                    },
                  ],
                }),
              ),
            );
            return (stateAdapter: CoverageStateAdapter) =>
              inMode(stateAdapter, function* () {
                yield* step(
                  inTransaction(stateAdapter, (txCtx) =>
                    stateAdapter.addJobsBlockers({
                      txCtx,
                      jobBlockers: [
                        {
                          jobId: stateChain.head.id,
                          blockedByChainIds: [sentinels.longChain.chainId],
                        },
                      ],
                    }),
                  ),
                );
              });
          }),
      },
    ],
  },

  {
    name: "getJobBlockers",
    cases: [
      {
        key: "getJobBlockers/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(stateAdapter.getJobBlockers({ jobId: sentinels.fanIn.blockedJobId }));
          }),
      },
    ],
  },

  {
    name: "unblockJobs",
    cases: [
      {
        key: "unblockJobs/default",
        label: "default",
        run: (_stateAdapter, sentinels) => {
          const chainId = sentinels.throwaway.unblockerChainIds.shift();
          if (!chainId) return () => {};
          return (stateAdapter: CoverageStateAdapter) =>
            inMode(stateAdapter, function* () {
              yield* step(
                inTransaction(stateAdapter, (txCtx) =>
                  stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId }),
                ),
              );
            });
        },
      },
    ],
  },

  {
    name: "startWorker",
    cases: [
      {
        key: "startWorker/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.startWorker({
                workerId: stateAdapter.config.generateWorkerId(),
                typeNames: [],
                concurrency: 1,
                leaseMs: 60_000,
              }),
            );
          }),
      },
    ],
  },

  {
    name: "extendWorkerLease",
    cases: [
      {
        key: "extendWorkerLease/default",
        label: "default",
        run: (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const worker = yield* step(
              stateAdapter.startWorker({
                workerId: stateAdapter.config.generateWorkerId(),
                typeNames: [],
                concurrency: 1,
                leaseMs: 60_000,
              }),
            );
            return (stateAdapter: CoverageStateAdapter) =>
              inMode(stateAdapter, function* () {
                yield* step(
                  stateAdapter.extendWorkerLease({
                    workerId: worker.id,
                    workerToken: worker.token,
                    leaseMs: 3_600_000,
                  }),
                );
              });
          }),
      },
    ],
  },

  {
    name: "stopWorker",
    cases: [
      {
        key: "stopWorker/default",
        label: "default",
        run: (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const worker = yield* step(
              stateAdapter.startWorker({
                workerId: stateAdapter.config.generateWorkerId(),
                typeNames: [],
                concurrency: 1,
                leaseMs: 60_000,
              }),
            );
            return (stateAdapter: CoverageStateAdapter) =>
              inMode(stateAdapter, function* () {
                yield* step(
                  stateAdapter.stopWorker({
                    workerId: worker.id,
                    workerToken: worker.token,
                  }),
                );
              });
          }),
      },
    ],
  },

  {
    name: "startJobAttempts",
    cases: [
      {
        key: "startJobAttempts/default",
        label: "default",
        run: (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const worker = yield* step(
              stateAdapter.startWorker({
                workerId: stateAdapter.config.generateWorkerId(),
                typeNames: ["seed:throwaway:pending"],
                concurrency: 1,
                leaseMs: 60_000,
              }),
            );
            return (stateAdapter: CoverageStateAdapter) =>
              inMode(stateAdapter, function* () {
                yield* step(
                  stateAdapter.startJobAttempts({
                    typeNames: ["seed:throwaway:pending"],
                    workerId: worker.id,
                    workerToken: worker.token,
                    limit: 1,
                  }),
                );
              });
          }),
      },
      {
        key: "startJobAttempts/limit10",
        label: "limit 10",
        run: (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const worker = yield* step(
              stateAdapter.startWorker({
                workerId: stateAdapter.config.generateWorkerId(),
                typeNames: ["seed:throwaway:pending"],
                concurrency: 10,
                leaseMs: 60_000,
              }),
            );
            return (stateAdapter: CoverageStateAdapter) =>
              inMode(stateAdapter, function* () {
                yield* step(
                  stateAdapter.startJobAttempts({
                    typeNames: ["seed:throwaway:pending"],
                    workerId: worker.id,
                    workerToken: worker.token,
                    limit: 10,
                  }),
                );
              });
          }),
      },
    ],
  },

  {
    name: "completeJobs",
    cases: [
      {
        key: "completeJobs/default",
        label: "default",
        run: (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const worker = yield* step(
              stateAdapter.startWorker({
                workerId: stateAdapter.config.generateWorkerId(),
                typeNames: ["seed:throwaway:pending"],
                concurrency: 1,
                leaseMs: 60_000,
              }),
            );
            const [acquired] = yield* step(
              stateAdapter.startJobAttempts({
                typeNames: ["seed:throwaway:pending"],
                workerId: worker.id,
                workerToken: worker.token,
                limit: 1,
              }),
            );
            if (!acquired) return () => {};
            return (stateAdapter: CoverageStateAdapter) =>
              inMode(stateAdapter, function* () {
                yield* step(
                  inTransaction(stateAdapter, (txCtx) =>
                    stateAdapter.completeJobs({
                      txCtx,
                      jobs: [
                        {
                          jobId: acquired.id,
                          output: { ok: true },
                          attemptToken: acquired.attemptToken!,
                          workerId: acquired.attemptBy!,
                        },
                      ],
                    }),
                  ),
                );
              });
          }),
      },
    ],
  },

  {
    name: "getStartAttemptDelayMs",
    cases: [
      {
        key: "getStartAttemptDelayMs/default",
        label: "default",
        run: () => (stateAdapter) =>
          inMode(stateAdapter, function* () {
            yield* step(
              inTransaction(stateAdapter, (txCtx) =>
                stateAdapter.getStartAttemptDelayMs({
                  txCtx,
                  typeNames: ["seed:throwaway:pending"],
                }),
              ),
            );
          }),
      },
    ],
  },

  {
    name: "rescheduleJobs",
    cases: [
      {
        key: "rescheduleJobs/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          inMode(stateAdapter, function* () {
            yield* step(
              stateAdapter.rescheduleJobs({
                jobs: [{ jobId: sentinels.pending.jobId, schedule: { afterMs: 1000 } }],
              }),
            );
          }),
      },
    ],
  },

  {
    name: "deleteChains",
    cases: [
      {
        key: "deleteChains/default",
        label: "default",
        run: (_stateAdapter, sentinels) => {
          const chainId = sentinels.throwaway.chainIds.shift();
          if (!chainId) return () => {};
          return (stateAdapter: CoverageStateAdapter) =>
            inMode(stateAdapter, function* () {
              yield* step(
                inTransaction(stateAdapter, (txCtx) =>
                  stateAdapter.deleteChains({ txCtx, chainIds: [chainId] }),
                ),
              );
            });
        },
      },
      {
        key: "deleteChains/multiJob",
        label: "multi-job chain",
        run: (stateAdapter) =>
          inMode(stateAdapter, function* () {
            const chainId = yield* step(
              inTransaction(stateAdapter, function* (txCtx) {
                const [chain] = yield* step(
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: [
                      {
                        id: stateAdapter.config.generateJobId(),
                        typeName: "idx:delete-multi",
                        input: {},
                      },
                    ],
                  }),
                );
                yield* step(
                  stateAdapter.continueJobs({
                    txCtx,
                    jobs: [
                      {
                        id: stateAdapter.config.generateJobId(),
                        typeName: "idx:delete-multi:step",
                        input: {},
                        continueFromId: chain.id,
                      },
                    ],
                  }),
                );
                return chain.id;
              }),
            );
            return (stateAdapter: CoverageStateAdapter) =>
              inMode(stateAdapter, function* () {
                yield* step(
                  inTransaction(stateAdapter, (txCtx) =>
                    stateAdapter.deleteChains({ txCtx, chainIds: [chainId] }),
                  ),
                );
              });
          }),
      },
    ],
  },
];

export const indexCoverageGroups: IndexCoverageGroup[] = [
  ...observabilityCoverageGroups,
  ...operationalCoverageGroups,
];
