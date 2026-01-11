// oxlint-disable no-empty-pattern
import inspector from "node:inspector";
import { MockedFunction, TestAPI, vi } from "vitest";
import { createConsoleLog, Log, NotifyAdapter } from "../index.js";
import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.js";
import { createNoopNotifyAdapter } from "../notify-adapter/notify-adapter.noop.js";
import {
  createMockObservabilityAdapter,
  MockObservabilityAdapter,
} from "../observability-adapter/observability-adapter.mock.js";
import { StateAdapter } from "../state-adapter/state-adapter.js";

export type TestSuiteContext = {
  stateAdapter: StateAdapter<{ $test: true }, { $test: true }, string>;
  notifyAdapter: NotifyAdapter;
  runInTransaction: <T>(cb: (context: { $test: true }) => Promise<T>) => Promise<T>;
  withWorkers: <T>(workers: (() => Promise<void>)[], cb: () => Promise<T>) => Promise<T>;
  log: MockedFunction<Log>;
  expectLogs: (
    expected: {
      type: string;
      data?: Record<string, unknown>;
      error?: unknown;
    }[],
  ) => void;
  observabilityAdapter: MockObservabilityAdapter;
  expectMetrics: (expected: { method: string; args?: Record<string, unknown> }[]) => Promise<void>;
  expectHistograms: (
    expected: { method: string; args?: Record<string, unknown> }[],
  ) => Promise<void>;
};

export const extendWithCommon = <
  T extends {
    stateAdapter: StateAdapter<{ $test: true }, { $test: true }, string>;
  },
>(
  it: TestAPI<T>,
): TestAPI<
  T &
    Pick<
      TestSuiteContext,
      | "runInTransaction"
      | "withWorkers"
      | "log"
      | "expectLogs"
      | "observabilityAdapter"
      | "expectMetrics"
      | "expectHistograms"
    >
> =>
  it.extend<
    Pick<
      TestSuiteContext,
      | "runInTransaction"
      | "withWorkers"
      | "log"
      | "expectLogs"
      | "observabilityAdapter"
      | "expectMetrics"
      | "expectHistograms"
    >
  >({
    runInTransaction: [
      async ({ stateAdapter }, use) => {
        await use(async (cb) => {
          return stateAdapter.provideContext(async (context) =>
            stateAdapter.runInTransaction(context, cb),
          );
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
    expectLogs: [
      async ({ log, expect }, use) => {
        await use((expected) => {
          expect(log.mock.calls.map((call) => call[0])).toEqual(
            expected.map((entry) => {
              const matcher: Record<string, unknown> = { type: entry.type };
              if (entry.data) {
                matcher.data = expect.objectContaining(entry.data);
              }
              if (entry.error !== undefined) {
                matcher.error = entry.error;
              }
              return expect.objectContaining(matcher);
            }),
          );
        });
      },
      { scope: "test" },
    ],
    observabilityAdapter: [
      async ({}, use) => {
        await use(createMockObservabilityAdapter());
      },
      { scope: "test" },
    ],
    expectMetrics: [
      async ({ observabilityAdapter, expect }, use) => {
        const histogramMethods = new Set([
          "jobSequenceDuration",
          "jobDuration",
          "jobAttemptDuration",
        ]);

        await use(async (expected: { method: string; args?: Record<string, unknown> }[]) => {
          const actual = observabilityAdapter._calls
            .filter((call) => !histogramMethods.has(call.method))
            .map((call) => ({
              method: call.method,
              data: call.args[0],
            }));

          expect(actual).toEqual(
            expected.map((entry) => {
              const matcher: Record<string, unknown> = { method: entry.method };
              if (entry.args) {
                matcher.data = expect.objectContaining(entry.args);
              }
              return expect.objectContaining(matcher);
            }),
          );
        });
      },
      { scope: "test" },
    ],
    expectHistograms: [
      async ({ observabilityAdapter, expect }, use) => {
        const histogramMethods = new Set([
          "jobSequenceDuration",
          "jobDuration",
          "jobAttemptDuration",
        ]);

        await use(async (expected: { method: string; args?: Record<string, unknown> }[]) => {
          const actual = observabilityAdapter._calls
            .filter((call) => histogramMethods.has(call.method))
            .map((call) => ({
              method: call.method,
              data: call.args[0],
            }));

          expect(actual).toEqual(
            expected.map((entry) => {
              const matcher: Record<string, unknown> = { method: entry.method };
              if (entry.args) {
                matcher.data = expect.objectContaining(entry.args);
              }
              return expect.objectContaining(matcher);
            }),
          );
        });
      },
      { scope: "test" },
    ],
  }) as any;

export const extendWithInProcessNotify = <T extends {}>(
  it: TestAPI<T>,
): TestAPI<T & Pick<TestSuiteContext, "notifyAdapter">> =>
  it.extend<Pick<TestSuiteContext, "notifyAdapter">>({
    notifyAdapter: [
      async ({}, use) => {
        await use(createInProcessNotifyAdapter());
      },
      { scope: "test" },
    ],
  }) as any;

export const extendWithNoopNotify = <T extends {}>(
  it: TestAPI<T>,
): TestAPI<T & Pick<TestSuiteContext, "notifyAdapter">> =>
  it.extend<Pick<TestSuiteContext, "notifyAdapter">>({
    notifyAdapter: [
      async ({}, use) => {
        await use(createNoopNotifyAdapter());
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
