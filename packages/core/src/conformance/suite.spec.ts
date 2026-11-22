import { describe, expect, it } from "vitest";

import {
  createNotifyAdapterConformanceCases,
  createNotifyAdapterEndToEndConformanceCases,
} from "../conformance.notify-adapter/notify-adapter-cases.ts";
import {
  createStateAdapterConformanceCases,
  createStateAdapterEndToEndConformanceCases,
} from "../conformance.state-adapter/state-adapter-cases.ts";
import { createInProcessNotifyAdapter } from "../notify-adapter.in-process/notify-adapter.in-process.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import type { ConformanceGroup } from "./runner.ts";
import { type ConformanceTestCase, toConformanceTestCases } from "./suite.ts";

type Ctx = { log: string[] };

const groups: ConformanceGroup<Ctx>[] = [
  {
    name: "first",
    cases: [
      {
        name: "a",
        run: async (ctx) => {
          ctx.log.push("run a");
        },
      },
      {
        name: "b",
        run: async (ctx) => {
          ctx.log.push("run b");
        },
      },
    ],
  },
  {
    name: "second",
    cases: [
      {
        name: "fails",
        run: async () => {
          throw new Error("boom");
        },
      },
    ],
  },
];

describe("toConformanceTestCases", () => {
  it("lists every case with its group and title, in order, and runs each against the context", async () => {
    const log: string[] = [];
    const cases = toConformanceTestCases(groups, { log });

    expect(cases.map(({ group, name, title }) => ({ group, name, title }))).toEqual([
      { group: "first", name: "a", title: "first > a" },
      { group: "first", name: "b", title: "first > b" },
      { group: "second", name: "fails", title: "second > fails" },
    ]);
    await cases[0].run();
    await cases[1].run();
    await expect(cases[2].run()).rejects.toThrow("boom");
    expect(log).toEqual(["run a", "run b"]);
  });
});

const withPromiseFrom = <TAdapter extends object>(
  adapter: TAdapter,
  method: keyof TAdapter & string,
): TAdapter => {
  const call = (adapter[method] as (...args: unknown[]) => unknown).bind(adapter);
  return { ...adapter, [method]: async (...args: unknown[]) => call(...args) };
};

const failuresOf = async (cases: ConformanceTestCase[], group: string): Promise<string[]> => {
  const failures: string[] = [];
  for (const conformanceCase of cases.filter((testCase) => testCase.group === group)) {
    try {
      await conformanceCase.run();
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  return failures;
};

describe("conformance cases check the adapter's mode", () => {
  it("fail a sync state adapter that returns a promise", async () => {
    const failures = await failuresOf(
      createStateAdapterConformanceCases({
        mode: "sync",
        createStateAdapter: () => withPromiseFrom(createInProcessStateAdapter(), "getJobs"),
        withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
      }),
      "getJobs",
    );

    expect(failures).toContain("A synchronous step got a promise: the value must be synchronous");
  });

  it("fail an async state adapter that returns plain values", async () => {
    const failures = await failuresOf(
      createStateAdapterConformanceCases({
        mode: "async",
        createStateAdapter: () =>
          ({ ...createInProcessStateAdapter(), sync: undefined }) as unknown as StateAdapter<
            any,
            any,
            any,
            "async"
          >,
        withNonTransactionContext: async (fn) => fn({ outsideTransaction: true }),
      }),
      "getJobs",
    );

    expect(failures).toContain(
      "An asynchronous step got a plain value: the value must be a promise",
    );
  });

  it("fail a sync notify adapter that returns a promise", async () => {
    const failures = await failuresOf(
      createNotifyAdapterConformanceCases({
        createNotifyAdapter: () =>
          withPromiseFrom(createInProcessNotifyAdapter(), "notifyJobsScheduled"),
        mode: "sync",
      }),
      "notifyJobsScheduled / listenJobsScheduled",
    );

    expect(failures).toContain("A synchronous step got a promise: the value must be synchronous");
  });

  it("fail a notify adapter whose sync marker does not match the mode", async () => {
    for (const context of [
      {
        createNotifyAdapter: async () => createInProcessNotifyAdapter({ mode: "async" }),
        mode: "sync",
      },
      { createNotifyAdapter: () => createInProcessNotifyAdapter(), mode: "async" },
    ] as const) {
      const [modeCase] = createNotifyAdapterConformanceCases(context).filter(
        ({ name }) =>
          name === "marks the adapter sync: true exactly when the suite runs in sync mode",
      );
      await expect(modeCase.run()).rejects.toThrow("Expected values to be strictly equal");
    }
  });

  it("fail a sync state adapter that returns a promise end to end", async () => {
    const failures = await failuresOf(
      createStateAdapterEndToEndConformanceCases({
        mode: "sync",
        createStateAdapter: () => withPromiseFrom(createInProcessStateAdapter(), "getChains"),
        withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
      }),
      "client-queries",
    );

    expect(failures).toContain("A synchronous step got a promise: the value must be synchronous");
  });
});

describe("the base case lists pass an adapter of either mode", () => {
  it("passes a sync state adapter", async () => {
    const failures = await failuresOf(
      createStateAdapterConformanceCases({
        mode: "sync",
        createStateAdapter: () => createInProcessStateAdapter(),
        withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
      }),
      "withTransaction",
    );

    expect(failures).toEqual([]);
  });

  it("passes a sync state adapter end to end", async () => {
    const failures = await failuresOf(
      createStateAdapterEndToEndConformanceCases({
        mode: "sync",
        createStateAdapter: () => createInProcessStateAdapter(),
        withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
      }),
      "deletion",
    );

    expect(failures).toEqual([]);
  });

  it("passes a sync notify adapter end to end", async () => {
    const failures = await failuresOf(
      createNotifyAdapterEndToEndConformanceCases({
        createNotifyAdapter: () => createInProcessNotifyAdapter(),
        mode: "sync",
      }),
      "notify",
    );

    expect(failures).toEqual([]);
  });
});
