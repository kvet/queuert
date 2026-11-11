import type { StateAdapter } from "../../state-adapter/state-adapter.ts";
import type { EndToEndTxContext } from "../types.ts";

export const withCaseTransaction = async <T>(
  stateAdapter: StateAdapter<EndToEndTxContext, string, string>,
  callback: (txCtx: EndToEndTxContext) => Promise<T>,
): Promise<T> => stateAdapter.withTransaction(callback);
