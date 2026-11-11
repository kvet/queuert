import { describe, expect, test } from "vitest";

import { createSpyNotifyAdapter } from "../conformance.end-to-end/support/spy-notify-adapter.ts";
import { noopNotifyAdapter } from "./notify-adapter.noop.ts";
import type { NotifyAdapter } from "./notify-adapter.ts";
import { type NotifyHelper, createNotifyHelper } from "./notify-helper.ts";

const notifyAll = async (notifyHelper: NotifyHelper, id: string): Promise<void> => {
  await Promise.all([
    notifyHelper.notifyJobsScheduled([`type-${id}`]),
    notifyHelper.notifyChainsCompleted([`chain-${id}`]),
    notifyHelper.notifyJobAttemptsLost([id]),
  ]);
};

const failingAdapter = (): NotifyAdapter => {
  const fail = async (): Promise<never> => {
    throw new Error("notify adapter down");
  };
  return {
    notifyJobsScheduled: fail,
    listenJobScheduled: fail,
    notifyChainsCompleted: fail,
    listenChainCompleted: fail,
    notifyJobAttemptsLost: fail,
    listenJobAttemptLost: fail,
    close: fail,
    [Symbol.asyncDispose]: fail,
  };
};

describe("notify helper", () => {
  test("sends notifications made in the same tick in one call per kind", async () => {
    const notifyAdapter = createSpyNotifyAdapter(noopNotifyAdapter);
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });

    await Promise.all([notifyAll(notifyHelper, "a"), notifyAll(notifyHelper, "b")]);

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

  test("does not call the notify adapter for an empty batch", async () => {
    const notifyAdapter = createSpyNotifyAdapter(noopNotifyAdapter);
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });

    await notifyHelper.notifyJobsScheduled([]);
    await notifyHelper.notifyChainsCompleted([]);
    await notifyHelper.notifyJobAttemptsLost([]);

    expect(notifyAdapter.calls).toEqual([]);
  });

  test("swallows notify adapter failures", async () => {
    const notifyHelper = createNotifyHelper({ adapter: failingAdapter() });

    await expect(notifyAll(notifyHelper, "a")).resolves.toBeUndefined();
    const disposers = await Promise.all([
      notifyHelper.listenJobScheduled(["type-a"], () => {}),
      notifyHelper.listenChainCompleted("chain-a", () => {}),
      notifyHelper.listenJobAttemptLost("a", () => {}),
    ]);
    await expect(Promise.all(disposers.map(async (dispose) => dispose()))).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
