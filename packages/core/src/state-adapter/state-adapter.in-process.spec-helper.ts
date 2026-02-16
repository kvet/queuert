import { type TestAPI } from "vitest";
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
  }
> => {
  return api.extend<{
    stateAdapter: InProcessStateAdapter;
    flakyStateAdapter: InProcessStateAdapter;
  }>({
    stateAdapter: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(createInProcessStateAdapter());
      },
      { scope: "test" },
    ],
    flakyStateAdapter: [
      async ({ stateAdapter, expect }, use) => {
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

        // Only inject errors on calls without txContext.
        // Calls within a transaction must not fail independently — the worker
        // loop retries the entire operation on transient errors.
        const wrap = <T extends (...args: never[]) => Promise<unknown>>(fn: T): T =>
          (async (...args: Parameters<T>) => {
            const params = args[0] as { txContext?: InProcessContext } | undefined;
            if (params?.txContext === undefined) {
              maybeThrow();
            }
            return fn(...args);
          }) as unknown as T;

        const flakyStateAdapter: InProcessStateAdapter = {
          runInTransaction: async (fn) => {
            maybeThrow();
            return stateAdapter.runInTransaction(fn);
          },
          getJobChainById: wrap(stateAdapter.getJobChainById),
          getJobById: wrap(stateAdapter.getJobById),
          createJob: wrap(stateAdapter.createJob),
          addJobBlockers: wrap(stateAdapter.addJobBlockers),
          scheduleBlockedJobs: wrap(stateAdapter.scheduleBlockedJobs),
          getJobBlockers: wrap(stateAdapter.getJobBlockers),
          getNextJobAvailableInMs: wrap(stateAdapter.getNextJobAvailableInMs),
          acquireJob: wrap(stateAdapter.acquireJob),
          renewJobLease: wrap(stateAdapter.renewJobLease),
          rescheduleJob: wrap(stateAdapter.rescheduleJob),
          completeJob: wrap(stateAdapter.completeJob),
          removeExpiredJobLease: wrap(stateAdapter.removeExpiredJobLease),
          deleteJobsByChainIds: wrap(stateAdapter.deleteJobsByChainIds),
          getJobForUpdate: wrap(stateAdapter.getJobForUpdate),
          getCurrentJobForUpdate: wrap(stateAdapter.getCurrentJobForUpdate),
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
  }) as ReturnType<typeof extendWithStateInProcess<T>>;
};
