import type { StateAdapter } from "../../state-adapter/state-adapter.ts";
import { type TxHooks, withTxHooks } from "../../tx-hooks/tx-hooks.ts";
import type { EndToEndTxContext } from "../types.ts";

export const withCaseTransaction = async <T>(
  stateAdapter: StateAdapter<EndToEndTxContext, string, string>,
  callback: (txCtx: EndToEndTxContext, txHooks: TxHooks) => Promise<T>,
): Promise<T> =>
  withTxHooks(async (txHooks) =>
    stateAdapter.withTransaction(txHooks.retryBoundary(async (txCtx) => callback(txCtx, txHooks))),
  );
