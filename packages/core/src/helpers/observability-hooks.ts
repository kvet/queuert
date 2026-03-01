import { type TransactionHooks } from "../transaction-hooks.js";

const queuertObservabilityBuffer = Symbol("queuert.observabilityBuffer");

type ObservabilityBuffer = (() => void)[];

export const bufferObservabilityEvent = (
  transactionHooks: TransactionHooks,
  callback: () => void,
): void => {
  const state = transactionHooks.getOrInsert<ObservabilityBuffer>(
    queuertObservabilityBuffer,
    () => ({
      state: [],
      flush: (state) => {
        for (const cb of state) cb();
      },
      discard: () => {},
    }),
  );
  state.push(callback);
};

export const snapshotObservabilityBuffer = (transactionHooks: TransactionHooks): number => {
  if (!transactionHooks.has(queuertObservabilityBuffer)) return 0;
  return transactionHooks.get<ObservabilityBuffer>(queuertObservabilityBuffer).length;
};

export const rollbackObservabilityBuffer = (
  transactionHooks: TransactionHooks,
  snapshot: number,
): void => {
  if (!transactionHooks.has(queuertObservabilityBuffer)) return;
  transactionHooks.get<ObservabilityBuffer>(queuertObservabilityBuffer).length = snapshot;
};
