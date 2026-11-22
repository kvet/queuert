import type { Mode } from "@queuert/sync-async";
import { describe, expect, test } from "vitest";

import { createSpyNotifyAdapter } from "../conformance.end-to-end/support/spy-notify-adapter.ts";
import { createInProcessNotifyAdapter } from "../notify-adapter.in-process/notify-adapter.in-process.ts";
import type { NotifyAdapter } from "./notify-adapter.ts";
import { createNotifyHelper } from "./notify-helper.ts";

const toAsyncNotifyAdapter = (adapter: NotifyAdapter<"sync">): NotifyAdapter<"async"> => {
  const promisifyDispose = (dispose: () => void) => async (): Promise<void> => {
    dispose();
  };
  const close = async (): Promise<void> => {
    adapter.close();
  };
  return {
    notifyJobsScheduled: async (typeNames) => {
      adapter.notifyJobsScheduled(typeNames);
    },
    listenJobsScheduled: async (typeNames, onNotification) =>
      promisifyDispose(adapter.listenJobsScheduled(typeNames, onNotification)),
    notifyChainsCompleted: async (chainIds) => {
      adapter.notifyChainsCompleted(chainIds);
    },
    listenChainsCompleted: async (chainIds, onNotification) =>
      promisifyDispose(adapter.listenChainsCompleted(chainIds, onNotification)),
    notifyJobAttemptsLost: async (jobIds) => {
      adapter.notifyJobAttemptsLost(jobIds);
    },
    listenJobAttemptsLost: async (jobIds, onNotification) =>
      promisifyDispose(adapter.listenJobAttemptsLost(jobIds, onNotification)),
    close,
    [Symbol.asyncDispose]: close,
  };
};

const createRecordingNotifyAdapter = (
  mode: Mode,
  overrides: Partial<Pick<NotifyAdapter<"sync">, "listenChainsCompleted">> = {},
): { adapter: NotifyAdapter<Mode>; calls: string[][] } => {
  const calls: string[][] = [];
  const adapter: NotifyAdapter<"sync"> = {
    sync: true,
    notifyJobsScheduled: (typeNames) => {
      calls.push(["notifyJobsScheduled", ...typeNames]);
    },
    listenJobsScheduled: () => () => {},
    notifyChainsCompleted: (chainIds) => {
      calls.push(["notifyChainsCompleted", ...chainIds]);
    },
    listenChainsCompleted: () => () => {},
    notifyJobAttemptsLost: (jobIds) => {
      calls.push(["notifyJobAttemptsLost", ...jobIds]);
    },
    listenJobAttemptsLost: () => () => {},
    close: () => {},
    [Symbol.dispose]: () => {},
    ...overrides,
  };
  return { adapter: mode === "sync" ? adapter : toAsyncNotifyAdapter(adapter), calls };
};

const createFailingNotifyAdapter = (mode: Mode): NotifyAdapter<Mode> => {
  const fail = (): never => {
    throw new Error("notify adapter down");
  };
  const adapter: NotifyAdapter<"sync"> = {
    sync: true,
    notifyJobsScheduled: fail,
    listenJobsScheduled: fail,
    notifyChainsCompleted: fail,
    listenChainsCompleted: fail,
    notifyJobAttemptsLost: fail,
    listenJobAttemptsLost: fail,
    close: fail,
    [Symbol.dispose]: fail,
  };
  return mode === "sync" ? adapter : toAsyncNotifyAdapter(adapter);
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

    const dispose = await notifyHelper.listenJobsScheduled(["type-a"], () => {});
    await dispose();
  });

  test("calls the dispose function the adapter returned", async () => {
    const disposed: string[] = [];
    const { adapter } = createRecordingNotifyAdapter(mode, {
      listenChainsCompleted: (chainIds) => () => {
        disposed.push(...chainIds);
      },
    });
    const notifyHelper = createNotifyHelper({ adapter });

    const dispose = await notifyHelper.listenChainsCompleted(["chain-a", "chain-b"], () => {});
    expect(disposed).toEqual([]);
    await dispose();

    expect(disposed).toEqual(["chain-a", "chain-b"]);
  });
});

describe("createNotifyHelper", () => {
  test("sends notifications made in the same tick in one call per kind", async () => {
    const notifyAdapter = createSpyNotifyAdapter(createInProcessNotifyAdapter({ mode: "async" }));
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
    const notifyAdapter = createSpyNotifyAdapter(createInProcessNotifyAdapter({ mode: "async" }));
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
    const notifyAdapter = createSpyNotifyAdapter(createInProcessNotifyAdapter({ mode: "async" }));
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });

    await notifyHelper.notifyJobsScheduled(["type-a"]);
    await notifyHelper.notifyJobsScheduled(["type-b"]);

    expect(notifyAdapter.calls).toEqual([
      { name: "notifyJobsScheduled", args: ["type-a"] },
      { name: "notifyJobsScheduled", args: ["type-b"] },
    ]);
  });
});
