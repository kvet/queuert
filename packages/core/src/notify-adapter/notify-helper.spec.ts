import { describe, expect, test } from "vitest";

import { type TxHooks, createTxHooks } from "../tx-hooks/tx-hooks.ts";
import { noopNotifyAdapter } from "./notify-adapter.noop.spec-helper.ts";
import { createSpyNotifyAdapter } from "./notify-adapter.spy.spec-helper.ts";
import type { NotifyAdapter } from "./notify-adapter.ts";
import { type NotifyHelper, createNotifyHelper } from "./notify-helper.ts";

const bufferNotifyAll = (txHooks: TxHooks, notifyHelper: NotifyHelper, id: string): void => {
  notifyHelper.notifyJobsScheduled(txHooks, [`type-${id}`]);
  notifyHelper.notifyChainsCompleted(txHooks, [`chain-${id}`]);
  notifyHelper.notifyJobAttemptsLost(txHooks, [id]);
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
  test("flushes buffered notifications in one call per kind", async () => {
    const notifyAdapter = createSpyNotifyAdapter(noopNotifyAdapter);
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });
    const { txHooks, flush } = createTxHooks();

    bufferNotifyAll(txHooks, notifyHelper, "a");
    bufferNotifyAll(txHooks, notifyHelper, "b");

    await flush();

    expect(notifyAdapter.calls).toEqual([
      { name: "notifyJobsScheduled", args: ["type-a", "type-b"] },
      { name: "notifyChainsCompleted", args: ["chain-a", "chain-b"] },
      { name: "notifyJobAttemptsLost", args: ["a", "b"] },
    ]);
  });

  test("merges batches from several calls into one adapter call without duplicates", async () => {
    const notifyAdapter = createSpyNotifyAdapter(noopNotifyAdapter);
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });
    const { txHooks, flush } = createTxHooks();

    notifyHelper.notifyJobsScheduled(txHooks, ["type-a", "type-b"]);
    notifyHelper.notifyJobsScheduled(txHooks, ["type-b", "type-c"]);

    await flush();

    expect(notifyAdapter.calls).toEqual([
      { name: "notifyJobsScheduled", args: ["type-a", "type-b", "type-c"] },
    ]);
  });

  test("merges notifications of transactions that flush together into one adapter call", async () => {
    const notifyAdapter = createSpyNotifyAdapter(noopNotifyAdapter);
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });
    const first = createTxHooks();
    const second = createTxHooks();

    notifyHelper.notifyJobsScheduled(first.txHooks, ["type-a"]);
    notifyHelper.notifyJobsScheduled(second.txHooks, ["type-a", "type-b"]);

    await Promise.all([first.flush(), second.flush()]);

    expect(notifyAdapter.calls).toEqual([
      { name: "notifyJobsScheduled", args: ["type-a", "type-b"] },
    ]);
  });

  test("registers no tx hooks for an empty batch", () => {
    const notifyHelper = createNotifyHelper({ adapter: noopNotifyAdapter });
    const registered: (() => void | Promise<void>)[] = [];
    const recordingTxHooks: Pick<TxHooks, "onCommit"> = {
      onCommit: (callback) => {
        registered.push(callback);
      },
    };

    notifyHelper.notifyJobsScheduled(recordingTxHooks, []);
    notifyHelper.notifyChainsCompleted(recordingTxHooks, []);
    notifyHelper.notifyJobAttemptsLost(recordingTxHooks, []);

    expect(registered).toEqual([]);
  });

  test("savepoint rollback drops notifications buffered in scope", async () => {
    const notifyAdapter = createSpyNotifyAdapter(noopNotifyAdapter);
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });
    const { txHooks, flush } = createTxHooks();

    bufferNotifyAll(txHooks, notifyHelper, "before");
    const sp = txHooks.createSavepoint();
    bufferNotifyAll(txHooks, notifyHelper, "inside");
    sp.rollback();

    await flush();

    expect(notifyAdapter.calls).toEqual([
      { name: "notifyJobsScheduled", args: ["type-before"] },
      { name: "notifyChainsCompleted", args: ["chain-before"] },
      { name: "notifyJobAttemptsLost", args: ["before"] },
    ]);
  });

  test("does not call the notify adapter when every notification was rolled back", async () => {
    const notifyAdapter = createSpyNotifyAdapter(noopNotifyAdapter);
    const notifyHelper = createNotifyHelper({ adapter: notifyAdapter });
    const { txHooks, flush } = createTxHooks();

    const sp = txHooks.createSavepoint();
    bufferNotifyAll(txHooks, notifyHelper, "inside");
    sp.rollback();

    await flush();

    expect(notifyAdapter.calls).toEqual([]);
  });

  test("swallows notify adapter failures", async () => {
    const notifyHelper = createNotifyHelper({ adapter: failingAdapter() });
    const { txHooks, flush } = createTxHooks();

    bufferNotifyAll(txHooks, notifyHelper, "a");

    await expect(flush()).resolves.toBeUndefined();
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
