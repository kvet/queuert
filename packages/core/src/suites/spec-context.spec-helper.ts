// oxlint-disable no-empty-pattern
import inspector from "node:inspector";
import { MockedFunction, TestAPI, vi } from "vitest";
import { createConsoleLog, Log, NotifyAdapter } from "../index.js";
import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.js";
import { createNoopNotifyAdapter } from "../notify-adapter/notify-adapter.noop.js";
import { StateAdapter } from "../state-adapter/state-adapter.js";

export type TestSuiteContext = {
  stateAdapter: StateAdapter<{ $test: true }, string>;
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
};

export const extendWithCommon = <
  T extends {
    stateAdapter: StateAdapter<{ $test: true }, string>;
  },
>(
  it: TestAPI<T>,
): TestAPI<T & Pick<TestSuiteContext, "runInTransaction" | "withWorkers" | "log" | "expectLogs">> =>
  it.extend<Pick<TestSuiteContext, "runInTransaction" | "withWorkers" | "log" | "expectLogs">>({
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
