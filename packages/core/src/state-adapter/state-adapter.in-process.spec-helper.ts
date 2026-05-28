import { type TestAPI, expect } from "vitest";

import { createFlakyBatchGenerator } from "../suites/flaky-test-helper.spec-helper.js";
import {
  type InProcessContext,
  type InProcessStateAdapter,
  createInProcessStateAdapter,
} from "./state-adapter.in-process.js";
import { type StateAdapter } from "./state-adapter.js";

export const extendWithStateInProcess = <T>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    stateAdapter: StateAdapter<{ $test: true }, string>;
    flakyStateAdapter: StateAdapter<{ $test: true }, string>;
    flakyDbStateAdapter: StateAdapter<{ $test: true }, string> | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    poisonExecute:
      | ((cb: (adapter: StateAdapter<{ $test: true }, string>) => Promise<void>) => Promise<void>)
      | undefined;
  }
> => {
  return api.extend<{
    stateAdapter: InProcessStateAdapter;
    flakyStateAdapter: InProcessStateAdapter;
    flakyDbStateAdapter: InProcessStateAdapter | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    poisonExecute:
      | ((cb: (adapter: StateAdapter<{ $test: true }, string>) => Promise<void>) => Promise<void>)
      | undefined;
  }>({
    stateAdapter: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(await createInProcessStateAdapter());
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
        const wrap = <T extends (...args: never[]) => Promise<unknown>>(fn: T): T =>
          (async (...args: Parameters<T>) => {
            const params = args[0] as { txCtx?: InProcessContext } | undefined;
            if (params?.txCtx === undefined) {
              maybeThrow();
            }
            return fn(...args);
          }) as unknown as T;

        const flakyStateAdapter: InProcessStateAdapter = {
          transactionConcurrency: stateAdapter.transactionConcurrency,
          withTransaction: async (fn) => {
            maybeThrow();
            return stateAdapter.withTransaction(fn);
          },
          withSavepoint: async (txCtx, fn) => {
            maybeThrow();
            return stateAdapter.withSavepoint(txCtx, fn);
          },
          getChains: wrap(stateAdapter.getChains),
          getJobs: wrap(stateAdapter.getJobs),
          createJobs: wrap(stateAdapter.createJobs),
          addJobsBlockers: wrap(stateAdapter.addJobsBlockers),
          unblockJobs: wrap(stateAdapter.unblockJobs),
          getJobBlockers: wrap(stateAdapter.getJobBlockers),
          getNextJobAvailableInMs: wrap(stateAdapter.getNextJobAvailableInMs),
          acquireJob: wrap(stateAdapter.acquireJob),
          renewJobLease: wrap(stateAdapter.renewJobLease),
          rescheduleJob: wrap(stateAdapter.rescheduleJob),
          completeJob: wrap(stateAdapter.completeJob),
          reapExpiredJobLease: wrap(stateAdapter.reapExpiredJobLease),
          deleteChains: wrap(stateAdapter.deleteChains),
          listChains: wrap(stateAdapter.listChains),
          listJobs: wrap(stateAdapter.listJobs),
          listChainJobs: wrap(stateAdapter.listChainJobs),
          listBlockedJobs: wrap(stateAdapter.listBlockedJobs),
          triggerJobs: wrap(stateAdapter.triggerJobs),
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
    poisonTransaction: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(undefined);
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
    poisonExecute: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(undefined);
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateInProcess<T>>;
};
