import { type MaybePromise, type Mode, step, syncAsync } from "@queuert/sync-async";

import { runInModeOf } from "../conformance/adapters.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import type { SeedSentinels } from "./generate-state-dump.ts";

export type IndexCoverageCaseKey =
  | "getChainTypeNames/default"
  | "getJobTypeNames/default"
  // counts
  | "countChainsByTypeName/default"
  | "countChainsByTypeName/batch100"
  | "countJobsByTypeName/default"
  | "countJobsByTypeName/batch100"
  | "countWorkers/default"
  | "countWorkersByTypeName/default"
  | "countWorkersByTypeName/batch100"
  | "countRunningJobsByWorkerId/default"
  | "countRunningJobsByWorkerId/batch100"
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
  | "listChains/noStatus/nonBlocking"
  | "listChains/noStatus/blocking"
  | "listChains/noStatus/fromTo"
  | "listChains/noStatus/cursor"
  // listChains > running
  | "listChains/running/default"
  | "listChains/running/nonBlocking"
  | "listChains/running/blocking"
  | "listChains/running/cursor"
  // listChains > completed
  | "listChains/completed/default"
  | "listChains/completed/nonBlocking"
  | "listChains/completed/blocking"
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
  // operational
  | "getChains/default"
  | "getChains/lock"
  | "getChains/batch100"
  | "getChains/lockBatch100"
  | "getChainTails/default"
  | "getChainTails/lock"
  | "getChainTails/batch100"
  | "getChainTails/lockBatch100"
  | "getJobs/default"
  | "getJobs/lock"
  | "getJobs/batch100"
  | "getJobs/lockBatch100"
  | "getWorkers/default"
  | "getWorkers/lock"
  | "getWorkers/batch100"
  | "getWorkers/lockBatch100"
  | "createJobs/default"
  | "createJobs/deduplication"
  | "createJobs/batch100"
  | "createJobs/deduplicationBatch100"
  | "continueJobs/default"
  | "continueJobs/batch100"
  | "addJobsBlockers/default"
  | "addJobsBlockers/batch100"
  | "getJobsBlockers/default"
  | "getJobsBlockers/manyBlockers"
  | "getJobsBlockers/batch100"
  | "unblockJobs/default"
  | "unblockJobs/batch100"
  | "startWorker/default"
  | "startWorker/batch100"
  | "extendWorkerLease/default"
  | "stopWorker/default"
  | "startJobAttempts/default"
  | "startJobAttempts/limit100"
  | "startJobAttempts/batch100"
  | "completeJobs/default"
  | "completeJobs/batch100"
  | "getStartAttemptDelayMs/default"
  | "getStartAttemptDelayMs/batch100"
  | "rescheduleJobs/default"
  | "rescheduleJobs/batch100"
  | "deleteChains/default"
  | "deleteChains/multiJob"
  | "deleteChains/batch100";

type Act = (
  stateAdapter: StateAdapter<any, any, any, Mode>,
  sentinels: SeedSentinels,
) => MaybePromise<void>;

export type IndexCoverageCase = {
  key: IndexCoverageCaseKey;
  label: string;
  run: (
    stateAdapter: StateAdapter<any, any, any, Mode>,
    sentinels: SeedSentinels,
  ) => MaybePromise<Act>;
};

export type IndexCoverageGroup = {
  name: string;
  cases: IndexCoverageCase[];
};

const BATCH_SIZE = 100;

export const observabilityCoverageGroups: IndexCoverageGroup[] = [
  {
    name: "getChainTypeNames",
    cases: [
      {
        key: "getChainTypeNames/default",
        label: "default",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(stateAdapter.getChainTypeNames({}));
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(stateAdapter.getJobTypeNames({}));
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.countChainsByTypeName({
                  typeNames: [...sentinels.pending.typeNames, "seed:blocked:fanin:1"],
                }),
              );
            }),
          ),
      },
      {
        key: "countChainsByTypeName/batch100",
        label: "100 type names",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.countChainsByTypeName({
                  typeNames: [
                    sentinels.throwaway.pendingTypeName,
                    ...Array.from({ length: BATCH_SIZE - 1 }, (_, index) => `idx:type:${index}`),
                  ],
                }),
              );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.countJobsByTypeName({
                  typeNames: [...sentinels.pending.typeNames, "seed:blocked:fanin:1"],
                }),
              );
            }),
          ),
      },
      {
        key: "countJobsByTypeName/batch100",
        label: "100 type names",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.countJobsByTypeName({
                  typeNames: [
                    sentinels.throwaway.pendingTypeName,
                    ...Array.from({ length: BATCH_SIZE - 1 }, (_, index) => `idx:type:${index}`),
                  ],
                }),
              );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(stateAdapter.countWorkers({}));
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.countWorkersByTypeName({ typeNames: sentinels.pending.typeNames }),
              );
            }),
          ),
      },
      {
        key: "countWorkersByTypeName/batch100",
        label: "100 type names",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.countWorkersByTypeName({
                  typeNames: [
                    sentinels.throwaway.pendingTypeName,
                    ...Array.from({ length: BATCH_SIZE - 1 }, (_, index) => `idx:type:${index}`),
                  ],
                }),
              );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.countRunningJobsByWorkerId({
                  workerIds: [sentinels.workers.busyWorkerId, ...sentinels.workers.idleWorkerIds],
                }),
              );
            }),
          ),
      },
      {
        key: "countRunningJobsByWorkerId/batch100",
        label: "100 worker ids",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.countRunningJobsByWorkerId({
                  workerIds: [
                    sentinels.workers.busyWorkerId,
                    ...sentinels.workers.idleWorkerIds,
                    ...Array.from(
                      { length: BATCH_SIZE - 1 - sentinels.workers.idleWorkerIds.length },
                      () => stateAdapter.config.generateWorkerId(),
                    ),
                  ],
                }),
              );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listJobs({
                  orderBy: "createdAt",
                  orderDirection: "desc",
                  typeName: "seed:pending:order",
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listJobs/noStatus/fromTo",
        label: "+ from/to",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/noStatus/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/pending/fromTo",
        label: "+ from/to",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/pending/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/pending/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/blocked/fromTo",
        label: "+ from/to",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/blocked/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/blocked/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/running/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/running/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/completed/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listJobs/completed/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listChains({
                  orderBy: "createdAt",
                  orderDirection: "desc",
                  typeName: "seed:pending:order",
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listChains/noStatus/nonBlocking",
        label: "+ non-blocking",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listChains({
                  orderBy: "createdAt",
                  orderDirection: "desc",
                  typeName: "seed:pending:order",
                  blocking: false,
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listChains/noStatus/blocking",
        label: "+ blocking",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listChains({
                  orderBy: "createdAt",
                  orderDirection: "desc",
                  typeName: "seed:pending:order",
                  blocking: true,
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listChains/noStatus/fromTo",
        label: "+ from/to",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listChains/noStatus/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listChains/running/nonBlocking",
        label: "+ non-blocking",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listChains({
                  orderBy: "createdAt",
                  orderDirection: "desc",
                  status: "running",
                  typeName: "seed:running:order",
                  blocking: false,
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listChains/running/blocking",
        label: "+ blocking",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listChains({
                  orderBy: "createdAt",
                  orderDirection: "desc",
                  status: "running",
                  typeName: "seed:running:order",
                  blocking: true,
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listChains/running/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listChains/completed/nonBlocking",
        label: "+ non-blocking",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listChains({
                  orderBy: "completedAt",
                  orderDirection: "desc",
                  status: "completed",
                  typeName: "seed:completed:order",
                  blocking: false,
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listChains/completed/blocking",
        label: "+ blocking",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listChains({
                  orderBy: "completedAt",
                  orderDirection: "desc",
                  status: "completed",
                  typeName: "seed:completed:order",
                  blocking: true,
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listChains/completed/orderByCreatedAt",
        label: "+ orderBy:createdAt",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listChains/completed/orderByCompletedAt",
        label: "+ orderBy:completedAt",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listChains/completed/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listChains/completed/orderByCreatedAtCursor",
        label: "+ orderBy:createdAt cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
      },
      {
        key: "listChains/completed/orderByCompletedAtCursor",
        label: "+ orderBy:completedAt cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listChainJobs({
                  orderDirection: "asc",
                  chainId: sentinels.longChain.chainId,
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listChainJobs/cursor",
        label: "cursor",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listBlockedJobs({
                  orderDirection: "desc",
                  chainId: sentinels.fanIn.blockerChainIds[0],
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listBlockedJobs/cursor",
        label: "cursor",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(stateAdapter.listWorkers({ orderDirection: "asc", page: { limit: 20 } }));
            }),
          ),
      },
      {
        key: "listWorkers/typeName",
        label: "+ typeName",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listWorkers({
                  typeName: sentinels.pending.typeNames[0],
                  orderDirection: "asc",
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listWorkers/status",
        label: "+ status",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listWorkers({
                  status: "expired",
                  orderDirection: "asc",
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listWorkers/cursor",
        label: "cursor",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.listWorkerJobs({
                  workerId: sentinels.workers.busyWorkerId,
                  orderDirection: "asc",
                  page: { limit: 20 },
                }),
              );
            }),
          ),
      },
      {
        key: "listWorkerJobs/cursor",
        label: "cursor",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(stateAdapter.getChains({ chainIds: [sentinels.longChain.chainId] }));
            }),
          ),
      },
      {
        key: "getChains/lock",
        label: "+ lock",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.getChains({
                    txCtx,
                    chainIds: [sentinels.longChain.chainId],
                    lock: "exclusive",
                  }),
                ),
              );
            }),
          ),
      },
      {
        key: "getChains/batch100",
        label: "batch of 100",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.getChains({
                  chainIds: sentinels.fanIn.blockerChainIds.slice(0, BATCH_SIZE),
                }),
              );
            }),
          ),
      },
      {
        key: "getChains/lockBatch100",
        label: "+ lock, batch of 100",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.getChains({
                    txCtx,
                    chainIds: sentinels.fanIn.blockerChainIds.slice(0, BATCH_SIZE),
                    lock: "exclusive",
                  }),
                ),
              );
            }),
          ),
      },
    ],
  },

  {
    name: "getChainTails",
    cases: [
      {
        key: "getChainTails/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(stateAdapter.getChainTails({ chainIds: [sentinels.longChain.chainId] }));
            }),
          ),
      },
      {
        key: "getChainTails/lock",
        label: "+ lock",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.getChainTails({
                    txCtx,
                    chainIds: [sentinels.longChain.chainId],
                    lock: "exclusive",
                  }),
                ),
              );
            }),
          ),
      },
      {
        key: "getChainTails/batch100",
        label: "batch of 100",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.getChainTails({
                  chainIds: sentinels.fanIn.blockerChainIds.slice(0, BATCH_SIZE),
                }),
              );
            }),
          ),
      },
      {
        key: "getChainTails/lockBatch100",
        label: "+ lock, batch of 100",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.getChainTails({
                    txCtx,
                    chainIds: sentinels.fanIn.blockerChainIds.slice(0, BATCH_SIZE),
                    lock: "exclusive",
                  }),
                ),
              );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(stateAdapter.getJobs({ jobIds: [sentinels.pending.jobId] }));
            }),
          ),
      },
      {
        key: "getJobs/lock",
        label: "+ lock",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.getJobs({
                    txCtx,
                    jobIds: [sentinels.pending.jobId],
                    lock: "exclusive",
                  }),
                ),
              );
            }),
          ),
      },
      {
        key: "getJobs/batch100",
        label: "batch of 100",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.getJobs({
                  jobIds: sentinels.fanIn.blockerChainIds.slice(0, BATCH_SIZE),
                }),
              );
            }),
          ),
      },
      {
        key: "getJobs/lockBatch100",
        label: "+ lock, batch of 100",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.getJobs({
                    txCtx,
                    jobIds: sentinels.fanIn.blockerChainIds.slice(0, BATCH_SIZE),
                    lock: "exclusive",
                  }),
                ),
              );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(stateAdapter.getWorkers({ workerIds: sentinels.workers.idleWorkerIds }));
            }),
          ),
      },
      {
        key: "getWorkers/lock",
        label: "+ lock",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.getWorkers({
                    txCtx,
                    workerIds: sentinels.workers.idleWorkerIds,
                    lock: "exclusive",
                  }),
                ),
              );
            }),
          ),
      },
      {
        key: "getWorkers/batch100",
        label: "batch of 100",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.getWorkers({
                  workerIds: [
                    sentinels.workers.busyWorkerId,
                    ...sentinels.workers.idleWorkerIds,
                    ...Array.from(
                      { length: BATCH_SIZE - 1 - sentinels.workers.idleWorkerIds.length },
                      () => stateAdapter.config.generateWorkerId(),
                    ),
                  ],
                }),
              );
            }),
          ),
      },
      {
        key: "getWorkers/lockBatch100",
        label: "+ lock, batch of 100",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.getWorkers({
                    txCtx,
                    workerIds: [
                      sentinels.workers.busyWorkerId,
                      ...sentinels.workers.idleWorkerIds,
                      ...Array.from(
                        { length: BATCH_SIZE - 1 - sentinels.workers.idleWorkerIds.length },
                        () => stateAdapter.config.generateWorkerId(),
                      ),
                    ],
                    lock: "exclusive",
                  }),
                ),
              );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: [
                      { id: stateAdapter.config.generateJobId(), typeName: "idx:test", input: {} },
                    ],
                  }),
                ),
              );
            }),
          ),
      },
      {
        key: "createJobs/deduplication",
        label: "+ deduplication",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
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
          ),
      },
      {
        key: "createJobs/batch100",
        label: "batch of 100",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: Array.from({ length: BATCH_SIZE }, () => ({
                      id: stateAdapter.config.generateJobId(),
                      typeName: "idx:test",
                      input: {},
                    })),
                  }),
                ),
              );
            }),
          ),
      },
      {
        key: "createJobs/deduplicationBatch100",
        label: "+ deduplication, batch of 100",
        run: () => (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: Array.from({ length: BATCH_SIZE }, (_, index) => ({
                      id: stateAdapter.config.generateJobId(),
                      typeName: "idx:dedup",
                      input: {},
                      deduplication: { key: `idx-dedup-key-${index}`, scope: "running" as const },
                    })),
                  }),
                ),
              );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.withTransaction((txCtx) =>
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
                  }),
                );
            }),
          ),
      },
      {
        key: "continueJobs/batch100",
        label: "batch of 100",
        run: (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: Array.from({ length: BATCH_SIZE }, () => ({
                      id: stateAdapter.config.generateJobId(),
                      typeName: "idx:batch:continue",
                      input: {},
                    })),
                  }),
                ),
              );
              const worker = yield* step(
                stateAdapter.startWorker({
                  workerId: stateAdapter.config.generateWorkerId(),
                  typeNames: ["idx:batch:continue"],
                  concurrency: BATCH_SIZE,
                  leaseMs: 60_000,
                }),
              );
              const acquired = yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.startJobAttempts({
                    txCtx,
                    typeNames: ["idx:batch:continue"],
                    workerId: worker.id,
                    workerToken: worker.token,
                    limit: BATCH_SIZE,
                  }),
                ),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.withTransaction((txCtx) =>
                        stateAdapter.continueJobs({
                          txCtx,
                          jobs: acquired.map((job) => ({
                            id: stateAdapter.config.generateJobId(),
                            typeName: "idx:cont",
                            input: {},
                            continueFromId: job.id,
                            attemptToken: job.attemptToken!,
                            workerId: job.attemptBy!,
                          })),
                        }),
                      ),
                    );
                  }),
                );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              const [stateChain] = yield* step(
                stateAdapter.withTransaction((txCtx) =>
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
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.withTransaction((txCtx) =>
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
                  }),
                );
            }),
          ),
      },
      {
        key: "addJobsBlockers/batch100",
        label: "batch of 100",
        run: (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              const stateChains = yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: Array.from({ length: BATCH_SIZE }, () => ({
                      id: stateAdapter.config.generateJobId(),
                      typeName: "idx:blocker-target",
                      input: {},
                    })),
                  }),
                ),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.withTransaction((txCtx) =>
                        stateAdapter.addJobsBlockers({
                          txCtx,
                          jobBlockers: stateChains.map((stateChain) => ({
                            jobId: stateChain.head.id,
                            blockedByChainIds: [sentinels.longChain.chainId],
                          })),
                        }),
                      ),
                    );
                  }),
                );
            }),
          ),
      },
    ],
  },

  {
    name: "getJobsBlockers",
    cases: [
      {
        key: "getJobsBlockers/default",
        label: "default",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(stateAdapter.getJobsBlockers({ jobIds: [sentinels.fanIn.blockedJobId] }));
            }),
          ),
      },
      {
        key: "getJobsBlockers/manyBlockers",
        label: "100 blockers",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.getJobsBlockers({ jobIds: [sentinels.fanIn.manyBlockersJobId] }),
              );
            }),
          ),
      },
      {
        key: "getJobsBlockers/batch100",
        label: "batch of 100",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.getJobsBlockers({
                  jobIds: sentinels.fanIn.blockedJobIds.slice(0, BATCH_SIZE),
                }),
              );
            }),
          ),
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
          return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(
                  stateAdapter.withTransaction((txCtx) =>
                    stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId }),
                  ),
                );
              }),
            );
        },
      },
      {
        key: "unblockJobs/batch100",
        label: "100 dependents",
        run: (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              const blockerChainId = yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  runInModeOf(
                    stateAdapter,
                    syncAsync(function* () {
                      const [blocker] = yield* step(
                        stateAdapter.createJobs({
                          txCtx,
                          jobs: [
                            {
                              id: stateAdapter.config.generateJobId(),
                              typeName: "idx:unblocker",
                              input: {},
                            },
                          ],
                        }),
                      );
                      const dependents = yield* step(
                        stateAdapter.createJobs({
                          txCtx,
                          jobs: Array.from({ length: BATCH_SIZE }, () => ({
                            id: stateAdapter.config.generateJobId(),
                            typeName: "idx:unblock-target",
                            input: {},
                          })),
                        }),
                      );
                      yield* step(
                        stateAdapter.addJobsBlockers({
                          txCtx,
                          jobBlockers: dependents.map((dependent) => ({
                            jobId: dependent.head.id,
                            blockedByChainIds: [blocker.id],
                          })),
                        }),
                      );
                      yield* step(
                        stateAdapter.completeJobs({
                          txCtx,
                          jobs: [{ jobId: blocker.head.id, output: null }],
                        }),
                      );
                      return blocker.id;
                    }),
                  ),
                ),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.withTransaction((txCtx) =>
                        stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChainId }),
                      ),
                    );
                  }),
                );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.startWorker({
                  workerId: stateAdapter.config.generateWorkerId(),
                  typeNames: [],
                  concurrency: 1,
                  leaseMs: 60_000,
                }),
              );
            }),
          ),
      },
      {
        key: "startWorker/batch100",
        label: "100 type names",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.startWorker({
                  workerId: stateAdapter.config.generateWorkerId(),
                  typeNames: [
                    sentinels.throwaway.pendingTypeName,
                    ...Array.from({ length: BATCH_SIZE - 1 }, (_, index) => `idx:type:${index}`),
                  ],
                  concurrency: 1,
                  leaseMs: 60_000,
                }),
              );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              const worker = yield* step(
                stateAdapter.startWorker({
                  workerId: stateAdapter.config.generateWorkerId(),
                  typeNames: [],
                  concurrency: 1,
                  leaseMs: 60_000,
                }),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.extendWorkerLease({
                        workerId: worker.id,
                        workerToken: worker.token,
                        leaseMs: 3_600_000,
                      }),
                    );
                  }),
                );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              const worker = yield* step(
                stateAdapter.startWorker({
                  workerId: stateAdapter.config.generateWorkerId(),
                  typeNames: [],
                  concurrency: 1,
                  leaseMs: 60_000,
                }),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.stopWorker({
                        workerId: worker.id,
                        workerToken: worker.token,
                      }),
                    );
                  }),
                );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              const worker = yield* step(
                stateAdapter.startWorker({
                  workerId: stateAdapter.config.generateWorkerId(),
                  typeNames: ["seed:throwaway:pending"],
                  concurrency: 1,
                  leaseMs: 60_000,
                }),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.startJobAttempts({
                        typeNames: ["seed:throwaway:pending"],
                        workerId: worker.id,
                        workerToken: worker.token,
                        limit: 1,
                      }),
                    );
                  }),
                );
            }),
          ),
      },
      {
        key: "startJobAttempts/limit100",
        label: "limit 100",
        run: (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              const typeNames = ["idx:batch:start"];
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: Array.from({ length: BATCH_SIZE }, () => ({
                      id: stateAdapter.config.generateJobId(),
                      typeName: "idx:batch:start",
                      input: {},
                    })),
                  }),
                ),
              );
              const worker = yield* step(
                stateAdapter.startWorker({
                  workerId: stateAdapter.config.generateWorkerId(),
                  typeNames,
                  concurrency: BATCH_SIZE,
                  leaseMs: 60_000,
                }),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.startJobAttempts({
                        typeNames,
                        workerId: worker.id,
                        workerToken: worker.token,
                        limit: BATCH_SIZE,
                      }),
                    );
                  }),
                );
            }),
          ),
      },
      {
        key: "startJobAttempts/batch100",
        label: "100 type names",
        run: (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              const typeNames = [
                sentinels.throwaway.pendingTypeName,
                ...Array.from({ length: BATCH_SIZE - 1 }, (_, index) => `idx:type:${index}`),
              ];
              const worker = yield* step(
                stateAdapter.startWorker({
                  workerId: stateAdapter.config.generateWorkerId(),
                  typeNames,
                  concurrency: 10,
                  leaseMs: 60_000,
                }),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.startJobAttempts({
                        typeNames,
                        workerId: worker.id,
                        workerToken: worker.token,
                        limit: 10,
                      }),
                    );
                  }),
                );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
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
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.withTransaction((txCtx) =>
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
                  }),
                );
            }),
          ),
      },
      {
        key: "completeJobs/batch100",
        label: "batch of 100",
        run: (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: Array.from({ length: BATCH_SIZE }, () => ({
                      id: stateAdapter.config.generateJobId(),
                      typeName: "idx:batch:complete",
                      input: {},
                    })),
                  }),
                ),
              );
              const worker = yield* step(
                stateAdapter.startWorker({
                  workerId: stateAdapter.config.generateWorkerId(),
                  typeNames: ["idx:batch:complete"],
                  concurrency: BATCH_SIZE,
                  leaseMs: 60_000,
                }),
              );
              const acquired = yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.startJobAttempts({
                    txCtx,
                    typeNames: ["idx:batch:complete"],
                    workerId: worker.id,
                    workerToken: worker.token,
                    limit: BATCH_SIZE,
                  }),
                ),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.withTransaction((txCtx) =>
                        stateAdapter.completeJobs({
                          txCtx,
                          jobs: acquired.map((job) => ({
                            jobId: job.id,
                            output: { ok: true },
                            attemptToken: job.attemptToken!,
                            workerId: job.attemptBy!,
                          })),
                        }),
                      ),
                    );
                  }),
                );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.getStartAttemptDelayMs({
                    txCtx,
                    typeNames: ["seed:throwaway:pending"],
                  }),
                ),
              );
            }),
          ),
      },
      {
        key: "getStartAttemptDelayMs/batch100",
        label: "100 type names",
        run: () => (stateAdapter, sentinels) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.getStartAttemptDelayMs({
                    txCtx,
                    typeNames: [
                      sentinels.throwaway.pendingTypeName,
                      ...Array.from({ length: BATCH_SIZE - 1 }, (_, index) => `idx:type:${index}`),
                    ],
                  }),
                ),
              );
            }),
          ),
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
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.rescheduleJobs({
                  jobs: [{ jobId: sentinels.pending.jobId, schedule: { afterMs: 1000 } }],
                }),
              );
            }),
          ),
      },
      {
        key: "rescheduleJobs/batch100",
        label: "batch of 100",
        run: (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: Array.from({ length: BATCH_SIZE }, () => ({
                      id: stateAdapter.config.generateJobId(),
                      typeName: "idx:batch:reschedule",
                      input: {},
                    })),
                  }),
                ),
              );
              const worker = yield* step(
                stateAdapter.startWorker({
                  workerId: stateAdapter.config.generateWorkerId(),
                  typeNames: ["idx:batch:reschedule"],
                  concurrency: BATCH_SIZE,
                  leaseMs: 60_000,
                }),
              );
              const acquired = yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.startJobAttempts({
                    txCtx,
                    typeNames: ["idx:batch:reschedule"],
                    workerId: worker.id,
                    workerToken: worker.token,
                    limit: BATCH_SIZE,
                  }),
                ),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.withTransaction((txCtx) =>
                        stateAdapter.rescheduleJobs({
                          txCtx,
                          jobs: acquired.map((job) => ({
                            jobId: job.id,
                            schedule: { afterMs: 1000 },
                            attemptToken: job.attemptToken!,
                          })),
                        }),
                      ),
                    );
                  }),
                );
            }),
          ),
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
          return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(
                  stateAdapter.withTransaction((txCtx) =>
                    stateAdapter.deleteChains({ txCtx, chainIds: [chainId] }),
                  ),
                );
              }),
            );
        },
      },
      {
        key: "deleteChains/multiJob",
        label: "multi-job chain",
        run: (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              const chainId = yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  runInModeOf(
                    stateAdapter,
                    syncAsync(function* () {
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
                  ),
                ),
              );
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.withTransaction((txCtx) =>
                        stateAdapter.deleteChains({ txCtx, chainIds: [chainId] }),
                      ),
                    );
                  }),
                );
            }),
          ),
      },
      {
        key: "deleteChains/batch100",
        label: "batch of 100",
        run: (stateAdapter) =>
          runInModeOf(
            stateAdapter,
            syncAsync(function* () {
              const chains = yield* step(
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: Array.from({ length: BATCH_SIZE }, () => ({
                      id: stateAdapter.config.generateJobId(),
                      typeName: "idx:batch:delete",
                      input: {},
                    })),
                  }),
                ),
              );
              const chainIds = chains.map((chain) => chain.id);
              return (stateAdapter: StateAdapter<any, any, any, Mode>) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.withTransaction((txCtx) =>
                        stateAdapter.deleteChains({ txCtx, chainIds }),
                      ),
                    );
                  }),
                );
            }),
          ),
      },
    ],
  },
];

export const indexCoverageGroups: IndexCoverageGroup[] = [
  ...observabilityCoverageGroups,
  ...operationalCoverageGroups,
];
