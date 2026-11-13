import { expect, it } from "vitest";

import { createInProcessStateAdapter } from "./state-adapter.in-process.ts";

it("passes a transaction context with no string keys that survives a spread", async () => {
  await using stateAdapter = createInProcessStateAdapter();
  const spread = await stateAdapter.withTransaction(async (txCtx) => {
    expect(Object.keys(txCtx)).toEqual([]);
    expect(JSON.stringify(txCtx)).toBe("{}");
    expect(stateAdapter.isTransaction({ ...txCtx })).toBe(true);
    return { ...txCtx };
  });
  expect(stateAdapter.isTransaction(spread)).toBe(false);
});

it("treats a context without the adapter's transaction as outside a transaction", async () => {
  await using stateAdapter = createInProcessStateAdapter();
  const forged = { inTransaction: true, journal: [], txHooks: {} };
  expect(stateAdapter.isTransaction(forged as never)).toBe(false);
  expect(() => {
    stateAdapter.onTransactionCommit(forged as never, () => {});
  }).toThrow("The context has no in-process transaction");
  expect(() => {
    stateAdapter.onTransactionRollback(forged as never, () => {});
  }).toThrow("The context has no in-process transaction");
});
