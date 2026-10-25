// oxlint-disable no-empty-pattern
import inspector from "node:inspector";

import { type Operation, isThenable, runOperation } from "@queuert/helpers";
import { type MockedFunction, type TestAPI, expect, vi } from "vitest";

import { transaction, transactionOperation } from "../conformance/transaction.js";
import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { createConsoleLog } from "../observability-adapter/log.console.js";
import { type Log } from "../observability-adapter/log.js";
import { type ObservabilityAdapter } from "../observability-adapter/observability-adapter.js";
import { createNoopObservabilityAdapter } from "../observability-adapter/observability-adapter.noop.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type TransactionHooks, withTransactionHooks } from "../transaction-hooks.js";
import { createFlakyBatchGenerator } from "./flaky-test-helper.spec-helper.js";

export type TestSuiteContext = {
  stateAdapter: StateAdapter<{ $test: true }, string, any>;
  transactionConcurrency: "concurrent" | "serialized";
  generateId: () => string;
  notifyAdapter: NotifyAdapter | undefined;
  withTransaction: <T>(
    cb: (txCtx: { $test: true }, transactionHooks: TransactionHooks) => T | Promise<T>,
  ) => Promise<T>;
  runInMode: <T>(operation: () => Operation<T>) => T | Promise<T>;
  withTransactionOperation: <T>(
    cb: (txCtx: { $test: true }, transactionHooks: TransactionHooks) => Operation<T>,
  ) => Promise<T>;
  poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
  withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
  withSavepoint: (<T>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => T) => T) | undefined;
  flakyDbStateAdapter: StateAdapter<{ $test: true }, string, any> | undefined;
  withWorkers: <T>(workers: (() => Promise<void>)[], cb: () => Promise<T>) => Promise<T>;
  log: MockedFunction<Log>;
  observabilityAdapter: ObservabilityAdapter;
};

export const extendWithCommon = <
  T extends {
    stateAdapter: StateAdapter<{ $test: true }, string, any>;
  },
>(
  it: TestAPI<T>,
): TestAPI<
  T &
    Pick<
      TestSuiteContext,
      | "withTransaction"
      | "withTransactionOperation"
      | "runInMode"
      | "withWorkers"
      | "log"
      | "observabilityAdapter"
      | "generateId"
    >
> =>
  it.extend<
    Pick<
      TestSuiteContext,
      | "withTransaction"
      | "withTransactionOperation"
      | "runInMode"
      | "withWorkers"
      | "log"
      | "observabilityAdapter"
      | "generateId"
    >
  >({
    generateId: [
      async ({ stateAdapter }, use) => {
        await use(stateAdapter.config.generateId);
      },
      { scope: "test" },
    ],
    withTransaction: [
      async ({ stateAdapter }, use) => {
        await use(async (cb) =>
          withTransactionHooks(async (transactionHooks) =>
            transaction(stateAdapter, (txCtx) => cb(txCtx, transactionHooks)),
          ),
        );
      },
      { scope: "test" },
    ],
    runInMode: [
      async ({ stateAdapter }, use) => {
        await use((operation) => runOperation(stateAdapter.mode, operation));
      },
      { scope: "test" },
    ],
    withTransactionOperation: [
      async ({ stateAdapter }, use) => {
        await use(async (cb) =>
          withTransactionHooks(async (transactionHooks) =>
            transactionOperation(stateAdapter, (txCtx) => cb(txCtx, transactionHooks)),
          ),
        );
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
          notifyJobScheduled: async (typeName) => {
            maybeThrow();
            return notifyAdapter.notifyJobScheduled(typeName);
          },
          listenJobScheduled: async (typeNames, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobScheduled(typeNames, onNotification);
          },
          provideWakeHint: async (typeName, count) => {
            maybeThrow();
            return notifyAdapter.provideWakeHint(typeName, count);
          },
          consumeWakeHint: async (typeName) => {
            maybeThrow();
            return notifyAdapter.consumeWakeHint(typeName);
          },
          notifyChainCompleted: async (chainId) => {
            maybeThrow();
            return notifyAdapter.notifyChainCompleted(chainId);
          },
          listenChainCompleted: async (chainId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenChainCompleted(chainId, onNotification);
          },
          notifyJobAttemptLost: async (jobId) => {
            maybeThrow();
            return notifyAdapter.notifyJobAttemptLost(jobId);
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

export const extendWithNotifyNoop = <T extends Record<string, unknown>>(
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

export const captureFailure = (fn: () => unknown): unknown => {
  try {
    const result = fn();
    return isThenable(result)
      ? Promise.resolve(result).then(
          () => undefined,
          (error: unknown) => error,
        )
      : undefined;
  } catch (error) {
    return error;
  }
};

export const expectFailure = function* (
  fn: () => unknown,
  expected?: string | RegExp | (abstract new (...args: never[]) => Error),
): Operation<void> {
  const failure = yield captureFailure(fn);
  if (failure === undefined) throw new Error("expected the call to fail");
  expect(() => {
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing the captured failure for the matcher
    throw failure;
  }).toThrow(expected);
};
