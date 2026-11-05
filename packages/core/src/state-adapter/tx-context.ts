import { type TransactionHooks, withTransactionHooks } from "../transaction-hooks.js";
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
  stateAdapter: StateAdapter<any, any, any, any>,
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

export const resolveTransactionHooks = (
  stateAdapter: StateAdapter<any, any, any, any>,
  transactionHooks: TransactionHooks | undefined,
  txCtx: Record<string, unknown>,
  caller: string,
): TransactionHooks => {
  if (stateAdapter.getTransactionHooks === undefined) {
    if (transactionHooks === undefined) {
      throw new Error(`${caller} requires transactionHooks`);
    }
    return transactionHooks;
  }
  if (transactionHooks !== undefined) {
    throw new Error(
      `${caller} does not accept transactionHooks: the state adapter supplies the transactionHooks bound to the transaction`,
    );
  }
  const boundTransactionHooks = stateAdapter.getTransactionHooks(txCtx);
  if (boundTransactionHooks === undefined) {
    throw new Error(
      `${caller} requires a transaction with bound transactionHooks; open it through the state provider's transaction wrapper`,
    );
  }
  return boundTransactionHooks;
};

export const withStateAdapterTransaction = async <T>(
  stateAdapter: StateAdapter<any, any, any, any>,
  fn: (txCtx: Record<string, unknown>) => Promise<T>,
): Promise<T> =>
  stateAdapter.getTransactionHooks === undefined
    ? withTransactionHooks(async (transactionHooks) =>
        stateAdapter.withTransaction(async (txCtx) => fn({ ...txCtx, transactionHooks })),
      )
    : stateAdapter.withTransaction(fn);
