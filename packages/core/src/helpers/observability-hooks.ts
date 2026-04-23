import { type TransactionHooks } from "../transaction-hooks.js";

type Callback = () => void | Promise<void>;

const observabilityCommitKey = Symbol("queuert.observability.commit");

export const bufferObservabilityEvent = (
  transactionHooks: TransactionHooks,
  callback: Callback,
): void => {
  transactionHooks
    .getOrInsert<Callback[]>(observabilityCommitKey, () => ({
      state: [],
      flush: async (cbs) => {
        let firstError: unknown;
        for (const cb of cbs) {
          try {
            await cb();
          } catch (error) {
            firstError ??= error;
          }
        }
        // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
        if (firstError) throw firstError;
      },
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
      discard: async (cbs) => {
        let firstError: unknown;
        for (const cb of cbs) {
          try {
            await cb();
          } catch (error) {
            firstError ??= error;
          }
        }
        // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
        if (firstError) throw firstError;
      },
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
