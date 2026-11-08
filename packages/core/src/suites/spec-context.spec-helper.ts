// oxlint-disable no-empty-pattern
import inspector from "node:inspector";

import { type MockedFunction, type TestAPI, expect, vi } from "vitest";

import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.ts";
import { noopNotifyAdapter } from "../notify-adapter/notify-adapter.noop.spec-helper.ts";
import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import { createConsoleLog } from "../observability-adapter/log.console.ts";
import type { Log } from "../observability-adapter/log.ts";
import { createNoopObservabilityAdapter } from "../observability-adapter/observability-adapter.noop.ts";
import type { ObservabilityAdapter } from "../observability-adapter/observability-adapter.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import { type TxHooks, withTxHooks } from "../tx-hooks/tx-hooks.ts";
import { createFlakyBatchGenerator } from "./flaky-test-helper.spec-helper.ts";

export type TestSuiteContext = {
  stateAdapter: StateAdapter<{ $test: true }, string, string>;
  transactionConcurrency: "concurrent" | "serialized";
  generateJobId: () => string;
  notifyAdapter: NotifyAdapter;
  withTransaction: <T>(cb: (txCtx: { $test: true }, txHooks: TxHooks) => Promise<T>) => Promise<T>;
  poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
  withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
  withSavepoint:
    | (<T>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>)
    | undefined;
  flakyStateAdapter: StateAdapter<{ $test: true }, string, string>;
  flakyDbStateAdapter: StateAdapter<{ $test: true }, string, string> | undefined;
  withWorkerRunners: <T>(
    stopWorkerRunners: (() => Promise<void>)[],
    cb: () => Promise<T>,
  ) => Promise<T>;
  log: MockedFunction<Log>;
  observabilityAdapter: ObservabilityAdapter;
};

export const extendWithCommon = <
  T extends {
    stateAdapter: StateAdapter<{ $test: true }, string, string>;
  },
>(
  it: TestAPI<T>,
): TestAPI<
  T &
    Pick<
      TestSuiteContext,
      | "withTransaction"
      | "withWorkerRunners"
      | "log"
      | "observabilityAdapter"
      | "generateJobId"
      | "notifyAdapter"
    >
> =>
  it.extend<
    Pick<
      TestSuiteContext,
      | "withTransaction"
      | "withWorkerRunners"
      | "log"
      | "observabilityAdapter"
      | "generateJobId"
      | "notifyAdapter"
    >
  >({
    generateJobId: [
      async ({ stateAdapter }, use) => {
        await use(stateAdapter.config.generateJobId);
      },
      { scope: "test" },
    ],
    withTransaction: [
      async ({ stateAdapter }, use) => {
        await use(async (cb) =>
          withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(
              txHooks.retryBoundary(async (txCtx) => cb(txCtx, txHooks)),
            ),
          ),
        );
      },
      { scope: "test" },
    ],
    withWorkerRunners: [
      async ({}, use) => {
        await use(async (stopWorkerRunners, cb) => {
          try {
            return await cb();
          } finally {
            await Promise.all(
              stopWorkerRunners.map(async (stopWorkerRunner) => stopWorkerRunner()),
            );
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
    notifyAdapter: [
      async ({}, use) => {
        await use(noopNotifyAdapter);
      },
      { scope: "test" },
    ],
  }) as any;

export const extendWithNotifyInProcess = <T extends Record<string, unknown>>(
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
      async ({ notifyAdapter }, use) => {
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
          notifyJobsScheduled: async (typeNames) => {
            maybeThrow();
            return notifyAdapter.notifyJobsScheduled(typeNames);
          },
          listenJobScheduled: async (typeNames, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobScheduled(typeNames, onNotification);
          },
          notifyChainsCompleted: async (chainIds) => {
            maybeThrow();
            return notifyAdapter.notifyChainsCompleted(chainIds);
          },
          listenChainCompleted: async (chainId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenChainCompleted(chainId, onNotification);
          },
          notifyJobAttemptsLost: async (jobIds) => {
            maybeThrow();
            return notifyAdapter.notifyJobAttemptsLost(jobIds);
          },
          listenJobAttemptLost: async (jobId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobAttemptLost(jobId, onNotification);
          },
          close: notifyAdapter.close,
        };

        await use(flakyNotifyAdapter);

        if (totalCalls > 5) {
          expect(errorCalls).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
  }) as any;

const ALLOWED_RESOURCE_TYPES = new Set([
  "TTYWrap", // stdin/stdout/stderr - always present
  "FSReqCallback", // File system callbacks - transient during test execution
  "GetAddrInfoReqWrap", // DNS lookups - transient
]);

export const extendWithResourceLeakDetection = <T extends Record<string, unknown>>(
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
