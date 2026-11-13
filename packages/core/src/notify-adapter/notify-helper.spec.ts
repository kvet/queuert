import { describe, expect, test } from "vitest";

import { createSpyNotifyAdapter } from "../conformance.end-to-end/support/spy-notify-adapter.ts";
import { noopNotifyAdapter } from "./notify-adapter.noop.ts";
import type { AnyNotifyAdapter, NotifyAdapter, SyncNotifyAdapter } from "./notify-adapter.ts";
import { createNotifyHelper } from "./notify-helper.ts";

type Mode = "async" | "sync";

const fromSync = (mode: Mode, adapter: SyncNotifyAdapter): AnyNotifyAdapter => {
  if (mode === "sync") return adapter;
  const promisify =
    <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) =>
    async (...args: TArgs): Promise<TResult> =>
      fn(...args);
  const promisifyListen =
    <TArgs extends unknown[]>(fn: (...args: TArgs) => () => void) =>
    async (...args: TArgs): Promise<() => Promise<void>> =>
      promisify(fn(...args));
  const asyncAdapter: NotifyAdapter = {
    notifyJobsScheduled: promisify(adapter.notifyJobsScheduled),
    listenJobScheduled: promisifyListen(adapter.listenJobScheduled),
    notifyChainsCompleted: promisify(adapter.notifyChainsCompleted),
    listenChainCompleted: promisifyListen(adapter.listenChainCompleted),
    notifyJobAttemptsLost: promisify(adapter.notifyJobAttemptsLost),
    listenJobAttemptLost: promisifyListen(adapter.listenJobAttemptLost),
    close: promisify(adapter.close),
    [Symbol.asyncDispose]: promisify(adapter.close),
  };
  return asyncAdapter;
};

const createRecordingNotifyAdapter = (
  mode: Mode,
  overrides: Partial<Pick<SyncNotifyAdapter, "listenChainCompleted">> = {},
): { adapter: AnyNotifyAdapter; calls: string[][] } => {
  const calls: string[][] = [];
  const adapter: SyncNotifyAdapter = {
    sync: true,
    notifyJobsScheduled: (typeNames) => {
      calls.push(["notifyJobsScheduled", ...typeNames]);
    },
    listenJobScheduled: () => () => {},
    notifyChainsCompleted: (chainIds) => {
      calls.push(["notifyChainsCompleted", ...chainIds]);
    },
    listenChainCompleted: () => () => {},
    notifyJobAttemptsLost: (jobIds) => {
      calls.push(["notifyJobAttemptsLost", ...jobIds]);
    },
    listenJobAttemptLost: () => () => {},
    close: () => {},
    [Symbol.dispose]: () => {},
    ...overrides,
  };
  return { adapter: fromSync(mode, adapter), calls };
};

const createFailingNotifyAdapter = (mode: Mode): AnyNotifyAdapter => {
  const fail = (): never => {
    throw new Error("notify adapter down");
  };
  return fromSync(mode, {
    sync: true,
    notifyJobsScheduled: fail,
    listenJobScheduled: fail,
    notifyChainsCompleted: fail,
    listenChainCompleted: fail,
    notifyJobAttemptsLost: fail,
    listenJobAttemptLost: fail,
    close: fail,
    [Symbol.dispose]: fail,
  });
};

describe.each(["async", "sync"] as const)("createNotifyHelper over a %s adapter", (mode) => {
  test("notifies the adapter", async () => {
    const { adapter, calls } = createRecordingNotifyAdapter(mode);
    const notifyHelper = createNotifyHelper({ adapter });

    await notifyHelper.notifyJobsScheduled(["type-a"]);
    await notifyHelper.notifyChainsCompleted(["chain-a"]);
    await notifyHelper.notifyJobAttemptsLost(["job-a"]);

    expect(calls).toEqual([
      ["notifyJobsScheduled", "type-a"],
      ["notifyChainsCompleted", "chain-a"],
      ["notifyJobAttemptsLost", "job-a"],
    ]);
  });

  test("sends each value once per call", async () => {
    const { adapter, calls } = createRecordingNotifyAdapter(mode);
    const notifyHelper = createNotifyHelper({ adapter });

    await notifyHelper.notifyJobsScheduled(["type-a", "type-a", "type-b"]);

    expect(calls).toEqual([["notifyJobsScheduled", "type-a", "type-b"]]);
  });

  test("does not call the adapter for an empty batch", async () => {
    const { adapter, calls } = createRecordingNotifyAdapter(mode);
    const notifyHelper = createNotifyHelper({ adapter });

    await notifyHelper.notifyJobsScheduled([]);
    await notifyHelper.notifyChainsCompleted([]);
    await notifyHelper.notifyJobAttemptsLost([]);

    expect(calls).toEqual([]);
  });

  test("swallows notify adapter failures", async () => {
    const notifyHelper = createNotifyHelper({ adapter: createFailingNotifyAdapter(mode) });
    await notifyHelper.notifyJobsScheduled(["type-a"]);
    await notifyHelper.notifyChainsCompleted(["chain-a"]);
    await notifyHelper.notifyJobAttemptsLost(["job-a"]);

    const dispose = await notifyHelper.listenJobScheduled(["type-a"], () => {});
    await dispose();
  });

  test("calls the dispose function the adapter returned", async () => {
    const disposed: string[] = [];
    const { adapter } = createRecordingNotifyAdapter(mode, {
      listenChainCompleted: (chainId) => () => {
        disposed.push(chainId);
      },
    });
    const notifyHelper = createNotifyHelper({ adapter });

    const dispose = await notifyHelper.listenChainCompleted("chain-a", () => {});
    expect(disposed).toEqual([]);
    await dispose();

    expect(disposed).toEqual(["chain-a"]);
  });
});

describe("createNotifyHelper", () => {
  test("sends notifications made in the same tick in one call per kind", async () => {
    const notifyAdapter = createSpyNotifyAdapter(noopNotifyAdapter);
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });

    await Promise.all(
      ["a", "b"].map(async (id) =>
        Promise.all([
          notifyHelper.notifyJobsScheduled([`type-${id}`]),
          notifyHelper.notifyChainsCompleted([`chain-${id}`]),
          notifyHelper.notifyJobAttemptsLost([id]),
        ]),
      ),
    );

    expect(notifyAdapter.calls).toEqual([
      { name: "notifyJobsScheduled", args: ["type-a", "type-b"] },
      { name: "notifyChainsCompleted", args: ["chain-a", "chain-b"] },
      { name: "notifyJobAttemptsLost", args: ["a", "b"] },
    ]);
  });

  test("merges values of the same tick without duplicates", async () => {
    const notifyAdapter = createSpyNotifyAdapter(noopNotifyAdapter);
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });

    await Promise.all([
      notifyHelper.notifyJobsScheduled(["type-a", "type-b"]),
      notifyHelper.notifyJobsScheduled(["type-b", "type-c"]),
    ]);

    expect(notifyAdapter.calls).toEqual([
      { name: "notifyJobsScheduled", args: ["type-a", "type-b", "type-c"] },
    ]);
  });

  test("sends notifications of separate ticks in separate calls", async () => {
    const notifyAdapter = createSpyNotifyAdapter(noopNotifyAdapter);
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });

    await notifyHelper.notifyJobsScheduled(["type-a"]);
    await notifyHelper.notifyJobsScheduled(["type-b"]);

    expect(notifyAdapter.calls).toEqual([
      { name: "notifyJobsScheduled", args: ["type-a"] },
      { name: "notifyJobsScheduled", args: ["type-b"] },
    ]);
  });
});
