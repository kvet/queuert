import type { Mode } from "@queuert/sync-async";

import type { StateAdapter } from "./state-adapter.ts";

export const normalizeTxCtx = <T extends Record<string, unknown>>(rest: T): T | undefined =>
  Reflect.ownKeys(rest).length > 0 ? rest : undefined;

export const requireTxCtx = <T extends Record<string, unknown>>(
  stateAdapter: StateAdapter<any, any, any, Mode>,
  rest: T,
  caller: string,
): T => {
  if (Reflect.ownKeys(rest).length === 0) {
    throw new Error(`${caller} requires a transaction context from the caller's transaction`);
  }
  if (stateAdapter.getTransaction(rest) === undefined) {
    throw new Error(
      `${caller} requires a transaction context inside an open transaction; the provided context is not in a transaction`,
    );
  }
  return rest;
};
