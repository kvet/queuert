import { expect, expectTypeOf, it } from "vitest";

import {
  type InProcessStateAdapter,
  createInProcessStateAdapter,
} from "./state-adapter.in-process.ts";

it("passes a transaction context with no string keys that survives a spread", async () => {
  await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
  const spread = await stateAdapter.withTransaction(async (txCtx) => {
    expect(Object.keys(txCtx)).toEqual([]);
    expect(JSON.stringify(txCtx)).toBe("{}");
    expect(stateAdapter.getTransaction({ ...txCtx })).toBeDefined();
    return { ...txCtx };
  });
  expect(stateAdapter.getTransaction(spread)).toBeUndefined();
});

it("treats a context without the adapter's transaction as outside a transaction", async () => {
  await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
  const forged = { inTransaction: true, journal: [], txHooks: {} };
  expect(stateAdapter.getTransaction(forged as never)).toBeUndefined();
  expect(() => {
    stateAdapter.onTransactionCommit(forged as never, () => {});
  }).toThrow("The context has no in-process transaction");
  expect(() => {
    stateAdapter.onTransactionRollback(forged as never, () => {});
  }).toThrow("The context has no in-process transaction");
});

it("rejects a call outside the open sync transaction and keeps its rollback from undoing it", () => {
  using stateAdapter = createInProcessStateAdapter();
  const worker = stateAdapter.startWorker({
    workerId: "w1",
    typeNames: ["a"],
    concurrency: 1,
    leaseMs: 60_000,
  });

  expect(() =>
    stateAdapter.withTransaction((txCtx) => {
      stateAdapter.stopWorker({ txCtx, workerId: worker.id, workerToken: worker.token });
      expect(() => stateAdapter.getWorkers({ workerIds: ["w1"] })).toThrow(
        "A call ran outside the open in-process transaction",
      );
      expect(() =>
        stateAdapter.startWorker({
          workerId: "w1",
          typeNames: ["c"],
          concurrency: 1,
          leaseMs: 60_000,
        }),
      ).toThrow("A call ran outside the open in-process transaction");
      expect(() => stateAdapter.withTransaction(() => "nested")).toThrow(
        "A call ran outside the open in-process transaction",
      );
      throw new Error("roll back");
    }),
  ).toThrow("roll back");

  const [stored] = stateAdapter.getWorkers({ workerIds: ["w1"] });
  expect(stored?.typeNames).toEqual(["a"]);
});

it("is synchronous by default and asynchronous with mode: async", async () => {
  using syncAdapter = createInProcessStateAdapter();
  expectTypeOf(syncAdapter).toEqualTypeOf<InProcessStateAdapter>();
  expect(syncAdapter.sync).toBe(true);
  expect(syncAdapter.withTransaction(() => "done")).toBe("done");
  expect(() => syncAdapter.withTransaction(async () => "done")).toThrow(
    "A synchronous step got a promise: the value must be synchronous",
  );
  expect(syncAdapter.withTransaction(() => "after")).toBe("after");

  await using asyncAdapter = createInProcessStateAdapter({ mode: "async" });
  expectTypeOf(asyncAdapter).toEqualTypeOf<InProcessStateAdapter<"async">>();
  expect("sync" in asyncAdapter).toBe(false);
  await expect(asyncAdapter.withTransaction(async () => "done")).resolves.toBe("done");
});
