import { expect, it } from "vitest";

import { type InProcessContext, createInProcessStateAdapter } from "./state-adapter.in-process.ts";

it("rejects callbacks on a context without txHooks", async () => {
  await using stateAdapter = createInProcessStateAdapter();
  const txCtx = { inTransaction: true } as InProcessContext;

  expect(() => {
    stateAdapter.onTransactionCommit(txCtx, () => {});
  }).toThrow("The transaction context has no txHooks");
  expect(() => {
    stateAdapter.onTransactionRollback(txCtx, () => {});
  }).toThrow("The transaction context has no txHooks");
});
