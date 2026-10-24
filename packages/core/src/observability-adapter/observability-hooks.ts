import { type TransactionHooks } from "../transaction-hooks.js";

type Callback = () => void | Promise<void>;

const runCallbacks = async (callbacks: Callback[]): Promise<void> => {
  let firstError: unknown;
  for (const callback of callbacks) {
    try {
      await callback();
    } catch (error) {
      firstError ??= error;
    }
  }
  // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
  if (firstError) throw firstError;
};

const observabilityCommitKey = Symbol("queuert.observability.commit");

export const bufferObservabilityEvent = (
  transactionHooks: TransactionHooks,
  callback: Callback,
): void => {
  transactionHooks
    .getOrInsert<Callback[]>(observabilityCommitKey, () => ({
      state: [],
      flush: runCallbacks,
      checkpoint: (state) => {
        const mark = state.length;
        return () => {
          state.length = mark;
        };
      },
    }))
    .push(callback);
};

const observabilityRollbackKey = Symbol("queuert.observability.rollback");

export const bufferObservabilityRollback = (
  transactionHooks: TransactionHooks,
  callback: Callback,
): void => {
  transactionHooks
    .getOrInsert<Callback[]>(observabilityRollbackKey, () => ({
      state: [],
      flush: () => {},
      discard: runCallbacks,
      checkpoint: (state) => {
        const mark = state.length;
        return () => {
          const scope = state.splice(mark);
          for (const cb of scope) {
            try {
              void cb();
            } catch {}
          }
        };
      },
    }))
    .push(callback);
};
