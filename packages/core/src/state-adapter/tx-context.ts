import { type StateAdapter } from "./state-adapter.js";

/** The transaction context fields spread into an options object, or `undefined` when none were. */
export const normalizeTxCtx = <T extends Record<string, unknown>>(rest: T): T | undefined =>
  Object.keys(rest).length > 0 ? rest : undefined;

/**
 * Returns the transaction context fields spread into an options object, and throws when there
 * are none or they are not inside an open transaction. The types already require the context;
 * this is the backstop for callers that bypass them.
 */
export const requireTxCtx = <T extends Record<string, unknown>>(
  stateAdapter: StateAdapter<any, any>,
  rest: T,
  caller: string,
): T => {
  if (Object.keys(rest).length === 0) {
    throw new Error(`${caller} requires a transaction context from the caller's transaction`);
  }
  if (!stateAdapter.isTransaction(rest)) {
    throw new Error(
      `${caller} requires a transaction context inside an open transaction; the provided context is not in a transaction`,
    );
  }
  return rest;
};
