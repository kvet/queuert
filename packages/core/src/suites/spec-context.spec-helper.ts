// oxlint-disable no-empty-pattern
import inspector from "node:inspector";
import { type MockedFunction, type TestAPI, vi } from "vitest";
import {
  type Log,
  type NotifyAdapter,
  type ObservabilityAdapter,
  createConsoleLog,
} from "../index.js";
import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.js";
import { createNoopObservabilityAdapter } from "../observability-adapter/observability-adapter.noop.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { createFlakyBatchGenerator } from "./flaky-test-helper.spec-helper.js";

export type TestSuiteContext = {
  stateAdapter: StateAdapter<{ $test: true }, string>;
  notifyAdapter: NotifyAdapter | undefined;
  runInTransaction: <T>(cb: (txContext: { $test: true }) => Promise<T>) => Promise<T>;
  withWorkers: <T>(workers: (() => Promise<void>)[], cb: () => Promise<T>) => Promise<T>;
  log: MockedFunction<Log>;
  observabilityAdapter: ObservabilityAdapter;
};

export const extendWithCommon = <
  T extends {
    stateAdapter: StateAdapter<{ $test: true }, string>;
  },
>(
  it: TestAPI<T>,
): TestAPI<
  T & Pick<TestSuiteContext, "runInTransaction" | "withWorkers" | "log" | "observabilityAdapter">
> =>
  it.extend<
    Pick<TestSuiteContext, "runInTransaction" | "withWorkers" | "log" | "observabilityAdapter">
  >({
    runInTransaction: [
      async ({ stateAdapter }, use) => {
        await use(async (cb) => {
          return stateAdapter.runInTransaction(cb);
        });
      },
      { scope: "test" },
    ],
    withWorkers: [
      async ({}, use) => {
        await use(async (workers, cb) => {
          try {
            return await cb();
          } finally {
            await Promise.all(workers.map(async (w) => w()));
          }
        });
      },
      { scope: "test" },
    ],
    log: [
      async ({}, use) => {
        const log = createConsoleLog();
        await use(
          vi.fn<Log>((...args) => {
            if (process.env.DEBUG || inspector.url()) {
              log(...args);
            }
          }),
        );
      },
      { scope: "test" },
    ],
    observabilityAdapter: [
      async ({}, use) => {
        await use(createNoopObservabilityAdapter());
      },
      { scope: "test" },
    ],
  }) as any;

export const extendWithNotifyInProcess = <T extends {}>(
  it: TestAPI<T>,
): TestAPI<T & Pick<TestSuiteContext, "notifyAdapter"> & { flakyNotifyAdapter: NotifyAdapter }> =>
  it.extend<Pick<TestSuiteContext, "notifyAdapter"> & { flakyNotifyAdapter: NotifyAdapter }>({
    notifyAdapter: [
      async ({}, use) => {
        await use(createInProcessNotifyAdapter());
      },
      { scope: "test" },
    ],
    flakyNotifyAdapter: [
      async ({ notifyAdapter, expect }, use) => {
        if (!notifyAdapter) {
          throw new Error("notifyAdapter is required for flaky notify tests");
        }

        let totalCalls = 0;
        let errorCalls = 0;
        const shouldError = createFlakyBatchGenerator();

        const maybeThrow = (): void => {
          totalCalls++;

          if (shouldError()) {
            errorCalls++;
            const error = new Error("connection reset") as Error & { code: string };
            error.code = "ECONNRESET";
            throw error;
          }
        };

        const flakyNotifyAdapter: NotifyAdapter = {
          notifyJobScheduled: async (typeName, count) => {
            maybeThrow();
            return notifyAdapter.notifyJobScheduled(typeName, count);
          },
          listenJobScheduled: async (typeNames, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobScheduled(typeNames, onNotification);
          },
          notifyJobChainCompleted: async (chainId) => {
            maybeThrow();
            return notifyAdapter.notifyJobChainCompleted(chainId);
          },
          listenJobChainCompleted: async (chainId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobChainCompleted(chainId, onNotification);
          },
          notifyJobOwnershipLost: async (jobId) => {
            maybeThrow();
            return notifyAdapter.notifyJobOwnershipLost(jobId);
          },
          listenJobOwnershipLost: async (jobId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobOwnershipLost(jobId, onNotification);
          },
        };

        await use(flakyNotifyAdapter);

        if (totalCalls > 5) {
          expect(errorCalls).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
  }) as any;

export const extendWithNotifyNoop = <T extends {}>(
  it: TestAPI<T>,
): TestAPI<T & Pick<TestSuiteContext, "notifyAdapter">> =>
  it.extend<Pick<TestSuiteContext, "notifyAdapter">>({
    notifyAdapter: [
      async ({}, use) => {
        await use(undefined);
      },
      { scope: "test" },
    ],
  }) as any;

const ALLOWED_RESOURCE_TYPES = new Set([
  "TTYWrap", // stdin/stdout/stderr - always present
  "FSReqCallback", // File system callbacks - transient during test execution
  "GetAddrInfoReqWrap", // DNS lookups - transient
]);

export const extendWithResourceLeakDetection = <T extends {}>(
  it: TestAPI<T>,
  options?: { additionalAllowedTypes?: string[] },
): TestAPI<T> => {
  const allowedTypes = options?.additionalAllowedTypes
    ? new Set([...ALLOWED_RESOURCE_TYPES, ...options.additionalAllowedTypes])
    : ALLOWED_RESOURCE_TYPES;

  return it.extend({
    _resourceLeakCheck: [
      async ({}, use) => {
        const baselineCounts = new Map<string, number>();
        for (const resource of process.getActiveResourcesInfo()) {
          baselineCounts.set(resource, (baselineCounts.get(resource) ?? 0) + 1);
        }

        await use(undefined);

        // Small delay to let any cleanup handlers run
        await new Promise((resolve) => setImmediate(resolve));

        const afterCounts = new Map<string, number>();
        for (const resource of process.getActiveResourcesInfo()) {
          afterCounts.set(resource, (afterCounts.get(resource) ?? 0) + 1);
        }

        const leaked: string[] = [];
        for (const [resource, count] of afterCounts) {
          const baselineCount = baselineCounts.get(resource) ?? 0;
          const leakedCount = count - baselineCount;
          if (leakedCount > 0 && !allowedTypes.has(resource)) {
            leaked.push(`${resource} x${leakedCount}`);
          }
        }

        if (leaked.length > 0) {
          throw new Error(
            `Test leaked resources: ${leaked.join(", ")}\n` +
              `Full active resources: ${process.getActiveResourcesInfo().join(", ")}`,
          );
        }
      },
      { auto: true, scope: "test" },
    ],
  }) as any;
};
