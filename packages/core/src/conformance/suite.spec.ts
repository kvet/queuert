import { describe, expect, it } from "vitest";

import {
  notifyAdapterConformanceCases,
  notifyAdapterEndToEndConformanceCases,
} from "../conformance.notify-adapter/notify-adapter-cases.ts";
import {
  stateAdapterConformanceCases,
  stateAdapterEndToEndConformanceCases,
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
  it("lists every case with its group and title, in order", () => {
    expect(
      toConformanceTestCases(groups).map(({ group, name, title }) => ({ group, name, title })),
    ).toEqual([
      { group: "first", name: "a", title: "first > a" },
      { group: "first", name: "b", title: "first > b" },
      { group: "second", name: "fails", title: "second > fails" },
    ]);
  });

  it("rejects naming the case when the context is undefined", async () => {
    const context = undefined as unknown as Ctx;

    await expect(toConformanceTestCases(groups)[0].run(context)).rejects.toThrow(
      'No conformance context for "first > a": the hook that creates it did not run or failed',
    );
  });

  it("runs each case against the context as given", async () => {
    const log: string[] = [];

    for (const conformanceCase of toConformanceTestCases(groups.slice(0, 1))) {
      await conformanceCase.run({ log });
    }

    expect(log).toEqual(["run a", "run b"]);
  });

  it("rejects with the case's error when it fails", async () => {
    const [conformanceCase] = toConformanceTestCases<Ctx>([
      {
        name: "g",
        cases: [
          {
            name: "throws",
            run: async () => {
              throw new Error("boom");
            },
          },
        ],
      },
    ]);

    await expect(conformanceCase.run({ log: [] })).rejects.toThrow("boom");
  });
});

const withPromiseFrom = <TAdapter extends object>(
  adapter: TAdapter,
  method: keyof TAdapter & string,
): TAdapter => {
  const call = (adapter[method] as (...args: unknown[]) => unknown).bind(adapter);
  return { ...adapter, [method]: async (...args: unknown[]) => call(...args) };
};

const failuresOf = async <TContext>(
  cases: ConformanceTestCase<TContext>[],
  group: string,
  context: TContext,
): Promise<string[]> => {
  const failures: string[] = [];
  for (const conformanceCase of cases.filter((testCase) => testCase.group === group)) {
    try {
      await conformanceCase.run(context);
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  return failures;
};

describe("conformance cases check the adapter's mode", () => {
  it("fail a sync state adapter that returns a promise", async () => {
    const failures = await failuresOf(stateAdapterConformanceCases, "getJobs", {
      createStateAdapter: () => withPromiseFrom(createInProcessStateAdapter(), "getJobs"),
      withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
    });

    expect(failures).toContain("A synchronous step got a promise: the value must be synchronous");
  });

  it("fail an async state adapter that returns plain values", async () => {
    const failures = await failuresOf(stateAdapterConformanceCases, "getJobs", {
      createStateAdapter: () =>
        ({ ...createInProcessStateAdapter(), sync: undefined }) as unknown as StateAdapter<
          any,
          any,
          any,
          "async"
        >,
      withNonTransactionContext: async (fn) => fn({ outsideTransaction: true }),
    });

    expect(failures).toContain(
      "An asynchronous step got a plain value: the value must be a promise",
    );
  });

  it("fail a sync notify adapter that returns a promise", async () => {
    const failures = await failuresOf(
      notifyAdapterConformanceCases,
      "notifyJobsScheduled / listenJobScheduled",
      {
        createNotifyAdapter: () =>
          withPromiseFrom(createInProcessNotifyAdapter(), "notifyJobsScheduled"),
      },
    );

    expect(failures).toContain("A synchronous step got a promise: the value must be synchronous");
  });

  it("fail a sync state adapter that returns a promise end to end", async () => {
    const failures = await failuresOf(stateAdapterEndToEndConformanceCases, "client-queries", {
      createStateAdapter: () => withPromiseFrom(createInProcessStateAdapter(), "getChains"),
      withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
    });

    expect(failures).toContain("A synchronous step got a promise: the value must be synchronous");
  });
});

describe("the base case lists pass an adapter of either mode", () => {
  it("passes a sync state adapter", async () => {
    const failures = await failuresOf(stateAdapterConformanceCases, "withTransaction", {
      createStateAdapter: () => createInProcessStateAdapter(),
      withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
    });

    expect(failures).toEqual([]);
  });

  it("passes a sync state adapter end to end", async () => {
    const failures = await failuresOf(stateAdapterEndToEndConformanceCases, "deletion", {
      createStateAdapter: () => createInProcessStateAdapter(),
      withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
    });

    expect(failures).toEqual([]);
  });

  it("passes a sync notify adapter end to end", async () => {
    const failures = await failuresOf(notifyAdapterEndToEndConformanceCases, "notify", {
      createNotifyAdapter: () => createInProcessNotifyAdapter(),
    });

    expect(failures).toEqual([]);
  });
});
