import { type Operation, runOperation } from "@queuert/helpers";

import { type StateAdapter } from "../state-adapter/state-adapter.js";

export const transaction = async <T>(
  stateAdapter: StateAdapter<any, any, any>,
  body: (txCtx: any) => T | Promise<T>,
): Promise<T> => stateAdapter.withTransaction(body);

export const transactionOperation = async <T>(
  stateAdapter: StateAdapter<any, any, any>,
  body: (txCtx: any) => Operation<T>,
): Promise<T> =>
  stateAdapter.withTransaction((txCtx: unknown) =>
    runOperation(stateAdapter.mode, () => body(txCtx)),
  );

export const asyncOnly = (
  stateAdapter: StateAdapter<any, any, any>,
  expect: { skip: (reason: string) => never },
): StateAdapter<any, any> => {
  if (stateAdapter.mode === "sync") {
    expect.skip("holds a transaction open across awaits, which a sync adapter cannot do");
  }
  return stateAdapter as StateAdapter<any, any>;
};
