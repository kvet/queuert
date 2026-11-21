import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { dynamicSyncAsync, resource, step, wait } from "@queuert/sync-async";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const getTransactionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getTransaction",
  cases: [
    {
      name: "returns an object for a withTransaction context",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const transaction = yield* step(
          stateAdapter.withTransaction((txCtx) => stateAdapter.getTransaction(txCtx)),
        );
        assert.equal(typeof transaction, "object");
      }),
    },
    {
      name: "returns undefined for a context outside a transaction",
      run: dynamicSyncAsync(function* ({ createStateAdapter, ...context }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const transaction = yield* wait(
          context.withNonTransactionContext((txCtx) => stateAdapter.getTransaction(txCtx)),
        );
        assert.equal(transaction, undefined);
      }),
    },
    {
      name: "returns the same object for every context of one transaction and a different one for another transaction",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [first, firstAgain] = yield* step(
          stateAdapter.withTransaction((txCtx) => [
            stateAdapter.getTransaction(txCtx),
            stateAdapter.getTransaction({ ...txCtx }),
          ]),
        );
        const second = yield* step(
          stateAdapter.withTransaction((txCtx) => stateAdapter.getTransaction(txCtx)),
        );

        assert.equal(first, firstAgain);
        assert.notEqual(first, second);
      }),
    },
    {
      name: "returns undefined in the commit callbacks and after a transaction commits",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());
        const inCommit: unknown[] = [];

        const txCtx = yield* step(
          stateAdapter.withTransaction((txCtx) => {
            stateAdapter.onTransactionCommit(txCtx, () => {
              inCommit.push(stateAdapter.getTransaction(txCtx));
            });
            return txCtx;
          }),
        );

        assert.deepEqual(inCommit, [undefined]);
        assert.equal(stateAdapter.getTransaction(txCtx), undefined);
      }),
    },
    {
      name: "returns undefined in the rollback callbacks and after a transaction rolls back",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());
        const inRollback: unknown[] = [];
        const captured: unknown[] = [];

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) => {
                captured.push(txCtx);
                stateAdapter.onTransactionRollback(txCtx, () => {
                  inRollback.push(stateAdapter.getTransaction(txCtx));
                });
                throw new Error("rolled back");
              }),
            /rolled back/,
          ),
        );

        assert.deepEqual(inRollback, [undefined]);
        assert.equal(
          stateAdapter.getTransaction(
            captured[0] as Parameters<typeof stateAdapter.getTransaction>[0],
          ),
          undefined,
        );
      }),
    },
  ],
};
