import { describe, expect, test } from "vitest";

import { type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks, createTransactionHooks } from "../transaction-hooks.js";
import { type NotifyAdapter } from "./notify-adapter.js";
import { createNoopNotifyAdapter } from "./notify-adapter.noop.js";
import { createSpyNotifyAdapter } from "./notify-adapter.spy.spec-helper.js";
import {
  bufferNotifyChainCompletion,
  bufferNotifyJobAttemptLost,
  bufferNotifyJobScheduled,
} from "./notify-hooks.js";

const bufferNotifyAll = (
  transactionHooks: TransactionHooks,
  notifyAdapter: NotifyAdapter,
  id: string,
): void => {
  const job = { id, typeName: `type-${id}`, chainId: `chain-${id}` } as StateJob;
  bufferNotifyJobScheduled(transactionHooks, notifyAdapter, job);
  bufferNotifyChainCompletion(transactionHooks, notifyAdapter, job);
  bufferNotifyJobAttemptLost(transactionHooks, notifyAdapter, id);
};

describe("notify hooks", () => {
  test("savepoint rollback drops notifications buffered in scope", async () => {
    const notifyAdapter = createSpyNotifyAdapter(createNoopNotifyAdapter());
    const { transactionHooks, flush } = createTransactionHooks();

    bufferNotifyAll(transactionHooks, notifyAdapter, "before");
    const sp = transactionHooks.createSavepoint();
    bufferNotifyAll(transactionHooks, notifyAdapter, "inside");
    sp.rollback();

    await flush();

    expect(notifyAdapter.calls).toEqual([
      { name: "notifyJobsScheduled", args: ["type-before"] },
      { name: "notifyChainsCompleted", args: ["chain-before"] },
      { name: "notifyJobAttemptsLost", args: ["before"] },
    ]);
  });

  test("does not call the notify adapter when every notification was rolled back", async () => {
    const notifyAdapter = createSpyNotifyAdapter(createNoopNotifyAdapter());
    const { transactionHooks, flush } = createTransactionHooks();

    const sp = transactionHooks.createSavepoint();
    bufferNotifyAll(transactionHooks, notifyAdapter, "inside");
    sp.rollback();

    await flush();

    expect(notifyAdapter.calls).toEqual([]);
  });
});
