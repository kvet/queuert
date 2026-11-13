import { expect, it } from "vitest";

import type { StateAdapter } from "./state-adapter.ts";
import { normalizeTxCtx, requireTxCtx } from "./tx-context.ts";

const transaction = Symbol("queuert.test.transaction");

const stateAdapter = {
  isTransaction: (txCtx: Record<PropertyKey, unknown>) => txCtx[transaction] === true,
} as unknown as StateAdapter<any, any, any>;

it("keeps a context whose only key is a symbol", () => {
  const txCtx = { [transaction]: true };
  expect(normalizeTxCtx(txCtx)).toBe(txCtx);
  expect(requireTxCtx(stateAdapter, txCtx, "createChain")).toBe(txCtx);
});

it("treats an object with no keys as no context", () => {
  expect(normalizeTxCtx({})).toBeUndefined();
  expect(() => requireTxCtx(stateAdapter, {}, "createChain")).toThrow(
    "createChain requires a transaction context from the caller's transaction",
  );
});
