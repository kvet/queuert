import assert from "node:assert/strict";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { SavepointConformanceContext, StateAdapterConformanceContext } from "../types.ts";

export const txCallbacksGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "onTransactionCommit and onTransactionRollback",
  cases: [
    {
      name: "runs commit callbacks after the transaction commits, before withTransaction resolves",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();
        const events: string[] = [];

        await stateAdapter.withTransaction(async (txCtx) => {
          stateAdapter.onTransactionCommit(txCtx, () => {
            events.push("commit");
          });
          stateAdapter.onTransactionRollback(txCtx, () => {
            events.push("rollback");
          });
          events.push("end of transaction");
        });
        events.push("resolved");

        assert.deepEqual(events, ["end of transaction", "commit", "resolved"]);
      },
    },
    {
      name: "awaits async commit callbacks before withTransaction resolves",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();
        const events: string[] = [];

        await stateAdapter.withTransaction(async (txCtx) => {
          stateAdapter.onTransactionCommit(txCtx, async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            events.push("commit");
          });
        });
        events.push("resolved");

        assert.deepEqual(events, ["commit", "resolved"]);
      },
    },
    {
      name: "runs rollback callbacks and no commit callbacks when the transaction rolls back",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();
        const events: string[] = [];

        await assert.rejects(
          stateAdapter.withTransaction(async (txCtx) => {
            stateAdapter.onTransactionCommit(txCtx, () => {
              events.push("commit");
            });
            stateAdapter.onTransactionRollback(txCtx, () => {
              events.push("rollback");
            });
            throw new Error("rolled back");
          }),
          /rolled back/,
        );

        assert.deepEqual(events, ["rollback"]);
      },
    },
    {
      name: "keeps the callbacks of each transaction to that transaction",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();
        const events: string[] = [];

        await assert.rejects(
          stateAdapter.withTransaction(async (txCtx) => {
            stateAdapter.onTransactionCommit(txCtx, () => {
              events.push("first commit");
            });
            throw new Error("rolled back");
          }),
          /rolled back/,
        );
        await stateAdapter.withTransaction(async (txCtx) => {
          stateAdapter.onTransactionRollback(txCtx, () => {
            events.push("second rollback");
          });
          stateAdapter.onTransactionCommit(txCtx, () => {
            events.push("second commit");
          });
        });

        assert.deepEqual(events, ["second commit"]);
      },
    },
  ],
};

export const txCallbacksSavepointGroup: ConformanceGroup<SavepointConformanceContext> = {
  name: "onTransactionCommit and onTransactionRollback in savepoints",
  cases: [
    {
      name: "a rolled-back savepoint runs its rollback callbacks and drops its commit callbacks",
      run: async ({ createStateAdapter, withSavepoint }) => {
        if (withSavepoint === undefined) return;
        await using stateAdapter = await createStateAdapter();
        const events: string[] = [];

        await stateAdapter.withTransaction(async (txCtx) => {
          stateAdapter.onTransactionCommit(txCtx, () => {
            events.push("outer commit");
          });
          await assert.rejects(
            withSavepoint(txCtx, async (savepointCtx) => {
              stateAdapter.onTransactionCommit(savepointCtx, () => {
                events.push("savepoint commit");
              });
              stateAdapter.onTransactionRollback(savepointCtx, () => {
                events.push("savepoint rollback");
              });
              throw new Error("savepoint rolled back");
            }),
            /savepoint rolled back/,
          );
        });

        assert.deepEqual(events, ["savepoint rollback", "outer commit"]);
      },
    },
    {
      name: "a released savepoint runs its commit callbacks only when the transaction commits",
      run: async ({ createStateAdapter, withSavepoint }) => {
        if (withSavepoint === undefined) return;
        await using stateAdapter = await createStateAdapter();
        const events: string[] = [];

        await stateAdapter.withTransaction(async (txCtx) => {
          await withSavepoint(txCtx, async (savepointCtx) => {
            stateAdapter.onTransactionCommit(savepointCtx, () => {
              events.push("savepoint commit");
            });
          });
          events.push("savepoint released");
        });

        assert.deepEqual(events, ["savepoint released", "savepoint commit"]);
      },
    },
    {
      name: "a released savepoint runs its rollback callbacks when the transaction rolls back",
      run: async ({ createStateAdapter, withSavepoint }) => {
        if (withSavepoint === undefined) return;
        await using stateAdapter = await createStateAdapter();
        const events: string[] = [];

        await assert.rejects(
          stateAdapter.withTransaction(async (txCtx) => {
            await withSavepoint(txCtx, async (savepointCtx) => {
              stateAdapter.onTransactionCommit(savepointCtx, () => {
                events.push("savepoint commit");
              });
              stateAdapter.onTransactionRollback(savepointCtx, () => {
                events.push("savepoint rollback");
              });
            });
            throw new Error("transaction rolled back");
          }),
          /transaction rolled back/,
        );

        assert.deepEqual(events, ["savepoint rollback"]);
      },
    },
  ],
};
