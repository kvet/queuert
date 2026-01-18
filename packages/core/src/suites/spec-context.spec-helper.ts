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
  stateAdapter: StateAdapter<{ $test: true }, string>;
  notifyAdapter: NotifyAdapter;
  runInTransaction: <T>(cb: (txContext: { $test: true }) => Promise<T>) => Promise<T>;
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
  expectGauges: (expected: {
    jobTypeIdleChange?: Array<{ delta: number; typeName?: string; workerId?: string }>;
    jobTypeProcessingChange?: Array<{ delta: number; typeName?: string; workerId?: string }>;
  }) => Promise<void>;
};

export const extendWithCommon = <
  T extends {
    stateAdapter: StateAdapter<{ $test: true }, string>;
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
      | "expectGauges"
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
      | "expectGauges"
    >
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
        const excludedMethods = new Set([
          // histograms
          "jobChainDuration",
          "jobDuration",
          "jobAttemptDuration",
          // gauges
          "jobTypeIdleChange",
          "jobTypeProcessingChange",
        ]);

        await use(async (expected: { method: string; args?: Record<string, unknown> }[]) => {
          const actual = observabilityAdapter._calls
            .filter((call) => !excludedMethods.has(call.method))
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
        const histogramMethods = new Set(["jobChainDuration", "jobDuration", "jobAttemptDuration"]);

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
    expectGauges: [
      async ({ observabilityAdapter, expect }, use) => {
        await use(
          async (expected: {
            jobTypeIdleChange?: Array<{
              delta: number;
              typeName?: string;
              workerId?: string;
            }>;
            jobTypeProcessingChange?: Array<{
              delta: number;
              typeName?: string;
              workerId?: string;
            }>;
          }) => {
            // Collect actual gauge calls and remove them from the calls array
            const actualCalls: Record<
              string,
              Array<{ delta: number; typeName: string; workerId: string }>
            > = {
              jobTypeIdleChange: [],
              jobTypeProcessingChange: [],
            };

            // Extract gauge calls and remove them from the adapter
            const remainingCalls: typeof observabilityAdapter._calls = [];
            for (const call of observabilityAdapter._calls) {
              if (
                call.method === "jobTypeIdleChange" ||
                call.method === "jobTypeProcessingChange"
              ) {
                const data = call.args[0] as {
                  delta: number;
                  typeName: string;
                  workerId: string;
                };

                // Verify required attributes are present
                expect(data).toEqual(
                  expect.objectContaining({
                    delta: expect.any(Number),
                    typeName: expect.any(String),
                    workerId: expect.any(String),
                  }),
                );

                actualCalls[call.method].push({
                  delta: data.delta,
                  typeName: data.typeName,
                  workerId: data.workerId,
                });
              } else {
                // Keep non-gauge calls
                remainingCalls.push(call);
              }
            }

            // Clear gauge calls from the adapter for the next check
            observabilityAdapter._calls.length = 0;
            observabilityAdapter._calls.push(...remainingCalls);

            // Verify each gauge type with explicit attribute checking
            for (const [method, expectedCalls] of Object.entries(expected) as Array<
              [
                "jobTypeIdleChange" | "jobTypeProcessingChange",
                Array<{ delta: number; typeName?: string; workerId?: string }>,
              ]
            >) {
              if (expectedCalls === undefined) continue;

              const actualCallsForMethod = actualCalls[method];

              expect(actualCallsForMethod).toEqual(
                expectedCalls.map((exp) =>
                  expect.objectContaining({
                    delta: exp.delta,
                    ...(exp.typeName !== undefined && { typeName: exp.typeName }),
                    ...(exp.workerId !== undefined && { workerId: exp.workerId }),
                  }),
                ),
              );
            }
          },
        );
      },
      { scope: "test" },
    ],
  }) as any;

export const extendWithNotifyInProcess = <T extends {}>(
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

export const extendWithNotifyNoop = <T extends {}>(
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
