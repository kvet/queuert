import { type TransactionHooks } from "../transaction-hooks.js";

export const createSavepointContext = async <TTxContext>(
  parentRun: (
    callback: (txCtx: TTxContext, transactionHooks: TransactionHooks) => Promise<void>,
  ) => Promise<void>,
  withSavepoint: (txCtx: TTxContext, fn: (txCtx: TTxContext) => Promise<void>) => Promise<void>,
): Promise<{
  readonly status: "pending" | "resolved" | "rejected";
  run: <TReturn>(
    callback: (txCtx: TTxContext, transactionHooks: TransactionHooks) => Promise<TReturn>,
  ) => Promise<TReturn>;
  resolve: () => Promise<void>;
  reject: (error: unknown) => Promise<void>;
}> => {
  const openPromiseHandlers = Promise.withResolvers<void>();
  const closePromiseHandlers = Promise.withResolvers<void>();
  let status: "pending" | "resolved" | "rejected" = "pending";
  let chain = Promise.resolve();
  let hooksSavepoint: ReturnType<TransactionHooks["createSavepoint"]>;
  let runInContext: <T>(
    cb: (txCtx: TTxContext, transactionHooks: TransactionHooks) => Promise<T>,
  ) => Promise<T>;

  const savepointWork = parentRun(async (txCtx, transactionHooks) => {
    hooksSavepoint = transactionHooks.createSavepoint();
    return withSavepoint(txCtx, async (txCtx) => {
      runInContext = async <T>(
        cb: (txCtx: TTxContext, transactionHooks: TransactionHooks) => Promise<T>,
      ) => cb(txCtx, transactionHooks);

      openPromiseHandlers.resolve();
      await closePromiseHandlers.promise;
    });
  });

  await Promise.race([openPromiseHandlers.promise, savepointWork]);

  return {
    get status() {
      return status;
    },
    run: async <TReturn>(
      callback: (txCtx: TTxContext, transactionHooks: TransactionHooks) => Promise<TReturn>,
    ): Promise<TReturn> => {
      if (status !== "pending") throw new Error("Savepoint is already " + status);
      const { resolve, reject, promise } = Promise.withResolvers<TReturn>();
      chain = chain.then(async () => runInContext(callback).then(resolve, reject));
      return promise;
    },
    resolve: async () => {
      if (status !== "pending") return;
      status = "resolved";
      await chain;
      hooksSavepoint.release();
      closePromiseHandlers.resolve();
      await savepointWork;
    },
    reject: async (error: unknown) => {
      if (status !== "pending") return;
      status = "rejected";
      await chain;
      hooksSavepoint.rollback();
      closePromiseHandlers.reject(error);
      await savepointWork.catch(() => {});
    },
  };
};

export type SavepointContext<TTxContext> = Awaited<
  ReturnType<typeof createSavepointContext<TTxContext>>
>;
