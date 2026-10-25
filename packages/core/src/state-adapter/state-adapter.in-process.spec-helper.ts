import { type TestAPI, expect } from "vitest";

import { createFlakyBatchGenerator } from "../suites/flaky-test-helper.spec-helper.js";
import {
  type InProcessContext,
  type InProcessStateAdapter,
  createInProcessStateAdapter,
} from "./state-adapter.in-process.js";
import { type StateAdapter, type StateAdapterMode } from "./state-adapter.js";

export const extendWithStateInProcess = <T>(
  api: TestAPI<T>,
  { mode = "async" }: { mode?: StateAdapterMode } = {},
): TestAPI<
  T & {
    stateAdapter: StateAdapter<{ $test: true }, string, any>;
    transactionConcurrency: "concurrent" | "serialized";
    flakyStateAdapter: StateAdapter<{ $test: true }, string, any>;
    flakyDbStateAdapter: StateAdapter<{ $test: true }, string, any> | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
    withSavepoint:
      | (<T>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => T) => T)
      | undefined;
  }
> => {
  return api.extend<{
    stateAdapter: InProcessStateAdapter<StateAdapterMode>;
    transactionConcurrency: "concurrent" | "serialized";
    flakyStateAdapter: InProcessStateAdapter<StateAdapterMode>;
    flakyDbStateAdapter: InProcessStateAdapter<StateAdapterMode> | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
    withSavepoint:
      | (<T>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => T) => T)
      | undefined;
  }>({
    stateAdapter: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(createInProcessStateAdapter<StateAdapterMode>({ mode }));
      },
      { scope: "test" },
    ],
    transactionConcurrency: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use("serialized");
      },
      { scope: "test" },
    ],
    flakyStateAdapter: [
      async ({ stateAdapter }, use) => {
        let queryCount = 0;
        let errorCount = 0;
        let enabled = true;
        const shouldErrorBatch = createFlakyBatchGenerator();
        const shouldError = () => enabled && shouldErrorBatch();

        const maybeThrow = () => {
          queryCount++;
          if (shouldError()) {
            errorCount++;
            const error = new Error("connection reset") as Error & { code: string };
            error.code = "ECONNRESET";
            throw error;
          }
        };

        // Only inject errors on calls without txCtx.
        // Calls within a transaction must not fail independently — the worker
        // loop retries the entire operation on transient errors.
        const wrap = <T extends (...args: never[]) => unknown>(fn: T): T =>
          ((...args: Parameters<T>) => {
            const params = args[0] as { txCtx?: InProcessContext } | undefined;
            if (params?.txCtx !== undefined) return fn(...args);
            if (mode === "sync") {
              maybeThrow();
              return fn(...args);
            }
            return (async () => {
              maybeThrow();
              return fn(...args);
            })();
          }) as unknown as T;

        const flakyStateAdapter: InProcessStateAdapter<StateAdapterMode> = {
          config: stateAdapter.config,
          mode: stateAdapter.mode,
          withTransaction: wrap(stateAdapter.withTransaction),
          isTransaction: stateAdapter.isTransaction,
          getChains: wrap(stateAdapter.getChains),
          getJobs: wrap(stateAdapter.getJobs),
          createJobs: wrap(stateAdapter.createJobs),
          continueJobs: wrap(stateAdapter.continueJobs),
          completeJobs: wrap(stateAdapter.completeJobs),
          rescheduleJobs: wrap(stateAdapter.rescheduleJobs),
          deleteChains: wrap(stateAdapter.deleteChains),
          startJobAttempts: wrap(stateAdapter.startJobAttempts),
          getStartAttemptDelayMs: wrap(stateAdapter.getStartAttemptDelayMs),
          extendJobAttempt: wrap(stateAdapter.extendJobAttempt),
          reclaimExpiredJobAttempts: wrap(stateAdapter.reclaimExpiredJobAttempts),
          addJobsBlockers: wrap(stateAdapter.addJobsBlockers),
          getJobBlockers: wrap(stateAdapter.getJobBlockers),
          unblockJobs: wrap(stateAdapter.unblockJobs),
          listChainTypeNames: wrap(stateAdapter.listChainTypeNames),
          listJobTypeNames: wrap(stateAdapter.listJobTypeNames),
          countByChainTypeNames: wrap(stateAdapter.countByChainTypeNames),
          countByJobTypeNames: wrap(stateAdapter.countByJobTypeNames),
          listChains: wrap(stateAdapter.listChains),
          listJobs: wrap(stateAdapter.listJobs),
          listChainJobs: wrap(stateAdapter.listChainJobs),
          listBlockedJobs: wrap(stateAdapter.listBlockedJobs),
          close: stateAdapter.close,
        };

        await use(flakyStateAdapter);

        // Disable error generation during cleanup to avoid unhandled rejections
        // from background workers that are still finishing up
        enabled = false;
        await new Promise((resolve) => setTimeout(resolve, 50));

        if (queryCount > 5) {
          expect(errorCount).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
    withSavepoint: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(undefined);
      },
      { scope: "test" },
    ],
    poisonTransaction: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(undefined);
      },
      { scope: "test" },
    ],
    withNonTransactionContext: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(async (fn) => {
          const inProcessCtx: InProcessContext = { inTransaction: false };
          return fn(inProcessCtx as unknown as { $test: true });
        });
      },
      { scope: "test" },
    ],
    flakyDbStateAdapter: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(undefined);
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateInProcess<T>>;
};
