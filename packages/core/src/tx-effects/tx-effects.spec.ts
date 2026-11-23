import { describe, expect, test, vi } from "vitest";

import { createHelpers } from "../client/setup-helpers.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import { createInProcessNotifyAdapter } from "../notify-adapter.in-process/notify-adapter.in-process.ts";
import { requireTxHooks } from "../state-adapter.in-process/in-process-state.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import { createTxEffects, registerTxEffects, registerTxEffectsAfterError } from "./tx-effects.ts";

const jobTypes = defineJobTypes<{ foo: { entry: true; input: null; output: null } }>();

const setup = () => {
  const stateAdapter = createInProcessStateAdapter();
  const notifyAdapter = createInProcessNotifyAdapter();
  const onTransactionCommit = vi.fn(stateAdapter.onTransactionCommit);
  const onTransactionRollback = vi.fn(stateAdapter.onTransactionRollback);
  const notifyJobsScheduled = vi.fn(notifyAdapter.notifyJobsScheduled);
  const helpers = createHelpers({
    stateAdapter: { ...stateAdapter, onTransactionCommit, onTransactionRollback },
    notifyAdapter: { ...notifyAdapter, notifyJobsScheduled },
    jobTypes,
  });
  return { stateAdapter, helpers, onTransactionCommit, onTransactionRollback, notifyJobsScheduled };
};

describe("registerTxEffects", () => {
  test("registers one commit and one rollback callback per call, however many effects it has", () => {
    const { stateAdapter, helpers, onTransactionCommit, onTransactionRollback } = setup();
    const committed = [vi.fn(), vi.fn(), vi.fn()];
    const rolledBack = vi.fn();

    stateAdapter.withTransaction((txCtx) => {
      const effects = createTxEffects();
      for (const effect of committed) effects.onCommit(effect);
      effects.onRollback(rolledBack);
      registerTxEffects(helpers, txCtx, effects);
    });

    expect(onTransactionCommit).toHaveBeenCalledOnce();
    expect(onTransactionRollback).toHaveBeenCalledOnce();
    for (const effect of committed) expect(effect).toHaveBeenCalledOnce();
    expect(rolledBack).not.toHaveBeenCalled();
  });

  test("runs every commit effect after one throws and rethrows the first error", () => {
    const { stateAdapter, helpers } = setup();
    const later = vi.fn();

    expect(() => {
      stateAdapter.withTransaction((txCtx) => {
        const effects = createTxEffects();
        effects.onCommit(() => {
          throw new Error("first effect failed");
        });
        effects.onCommit(() => {
          throw new Error("second effect failed");
        });
        effects.onCommit(later);
        registerTxEffects(helpers, txCtx, effects);
      });
    }).toThrow("first effect failed");
    expect(later).toHaveBeenCalledOnce();
  });

  test("runs rollback effects newest first when the transaction rolls back", () => {
    const { stateAdapter, helpers } = setup();
    const older = vi.fn();
    const newer = vi.fn();
    const committed = vi.fn();

    expect(() =>
      stateAdapter.withTransaction((txCtx) => {
        const effects = createTxEffects();
        effects.onRollback(older);
        effects.onRollback(newer);
        effects.onCommit(committed);
        registerTxEffects(helpers, txCtx, effects);
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect(newer.mock.invocationCallOrder[0]).toBeLessThan(older.mock.invocationCallOrder[0]);
    expect(committed).not.toHaveBeenCalled();
  });

  test("registers nothing for a call without effects or notifications", () => {
    const { stateAdapter, helpers, onTransactionCommit, onTransactionRollback } = setup();

    stateAdapter.withTransaction((txCtx) => {
      registerTxEffects(helpers, txCtx, createTxEffects());
    });

    expect(onTransactionCommit).not.toHaveBeenCalled();
    expect(onTransactionRollback).not.toHaveBeenCalled();
  });

  test("drops the commit effects and runs the rollback effects of a call in a savepoint that rolls back", () => {
    const { stateAdapter, helpers } = setup();
    const committed = vi.fn();
    const rolledBack = vi.fn();

    stateAdapter.withTransaction((txCtx) => {
      const savepoint = requireTxHooks(txCtx).createSavepoint();
      const effects = createTxEffects();
      effects.onCommit(committed);
      effects.onRollback(rolledBack);
      registerTxEffects(helpers, txCtx, effects);
      savepoint.rollback();
    });

    expect(rolledBack).toHaveBeenCalledOnce();
    expect(committed).not.toHaveBeenCalled();
  });

  test("wakes the pending jobs a call locked when the transaction rolls back", () => {
    const {
      stateAdapter,
      helpers,
      onTransactionCommit,
      onTransactionRollback,
      notifyJobsScheduled,
    } = setup();

    expect(() => {
      stateAdapter.withTransaction((txCtx) => {
        const effects = createTxEffects();
        effects.onCommit(() => {});
        effects.notify({ lockedPendingJobs: [{ id: "job-1", typeName: "foo" }] });
        registerTxEffects(helpers, txCtx, effects);
        throw new Error("rolled back");
      });
    }).toThrow("rolled back");

    expect(onTransactionCommit).toHaveBeenCalledOnce();
    expect(onTransactionRollback).toHaveBeenCalledOnce();
    expect(notifyJobsScheduled).toHaveBeenCalledWith(["foo"]);
  });

  test("runs the commit work of several calls once and merges their notifications", () => {
    const { stateAdapter, helpers, notifyJobsScheduled } = setup();
    const first = vi.fn();
    const second = vi.fn();

    stateAdapter.withTransaction((txCtx) => {
      const firstCall = createTxEffects();
      firstCall.onCommit(first);
      firstCall.notify({ jobsScheduled: ["foo"] });
      registerTxEffects(helpers, txCtx, firstCall);
      const secondCall = createTxEffects();
      secondCall.onCommit(second);
      secondCall.notify({ jobsScheduled: ["bar"] });
      registerTxEffects(helpers, txCtx, secondCall);
    });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(notifyJobsScheduled).toHaveBeenCalledOnce();
    expect(notifyJobsScheduled).toHaveBeenCalledWith(["foo", "bar"]);
  });

  test("does not wake a locked pending job that another call in the transaction settled", () => {
    const { stateAdapter, helpers, notifyJobsScheduled } = setup();

    stateAdapter.withTransaction((txCtx) => {
      const lockingCall = createTxEffects();
      lockingCall.notify({
        lockedPendingJobs: [
          { id: "settled", typeName: "foo" },
          { id: "untouched", typeName: "bar" },
        ],
      });
      registerTxEffects(helpers, txCtx, lockingCall);
      const settlingCall = createTxEffects();
      settlingCall.notify({ settledJobIds: ["settled"] });
      registerTxEffects(helpers, txCtx, settlingCall);
    });

    expect(notifyJobsScheduled).toHaveBeenCalledExactlyOnceWith(["bar"]);
  });

  test("sends the notifications after a commit effect throws, then rethrows its error", async () => {
    const stateAdapter = createInProcessStateAdapter({ mode: "async" });
    const notifyAdapter = createInProcessNotifyAdapter({ mode: "async" });
    const notifyJobsScheduled = vi.fn(notifyAdapter.notifyJobsScheduled);
    const helpers = createHelpers({
      stateAdapter,
      notifyAdapter: { ...notifyAdapter, notifyJobsScheduled },
      jobTypes,
    });

    await expect(
      stateAdapter.withTransaction(async (txCtx) => {
        const effects = createTxEffects();
        effects.onCommit(() => {
          throw new Error("effect failed");
        });
        effects.notify({ jobsScheduled: ["foo"] });
        registerTxEffects(helpers, txCtx, effects);
      }),
    ).rejects.toThrow("effect failed");
    expect(notifyJobsScheduled).toHaveBeenCalledExactlyOnceWith(["foo"]);
  });

  test("runs the rollback effects of every call and wakes every locked job once on a full rollback", () => {
    const { stateAdapter, helpers, notifyJobsScheduled } = setup();
    const firstRolledBack = vi.fn();
    const secondRolledBack = vi.fn();

    expect(() => {
      stateAdapter.withTransaction((txCtx) => {
        const firstCall = createTxEffects();
        firstCall.onRollback(firstRolledBack);
        firstCall.notify({ lockedPendingJobs: [{ id: "job-1", typeName: "foo" }] });
        registerTxEffects(helpers, txCtx, firstCall);
        const secondCall = createTxEffects();
        secondCall.onRollback(secondRolledBack);
        secondCall.notify({ lockedPendingJobs: [{ id: "job-2", typeName: "bar" }] });
        registerTxEffects(helpers, txCtx, secondCall);
        throw new Error("rolled back");
      });
    }).toThrow("rolled back");

    expect(firstRolledBack).toHaveBeenCalledOnce();
    expect(secondRolledBack).toHaveBeenCalledOnce();
    expect(notifyJobsScheduled).toHaveBeenCalledExactlyOnceWith(["foo", "bar"]);
  });

  test("rejects effects registered after the transaction ended, unless an error is already propagating", () => {
    const { stateAdapter, helpers, onTransactionCommit } = setup();
    const endedTxCtx = stateAdapter.withTransaction((txCtx) => txCtx);
    const effects = createTxEffects();
    effects.onCommit(vi.fn());

    expect(() => {
      registerTxEffects(helpers, endedTxCtx, effects);
    }).toThrow("Transaction effects require a context inside an open transaction");
    expect(() => {
      registerTxEffectsAfterError(helpers, endedTxCtx, effects);
    }).not.toThrow();
    expect(onTransactionCommit).not.toHaveBeenCalled();
  });
});
