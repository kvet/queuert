import { type TransactionHooks, createTransactionHooks } from "../transaction-hooks.js";

export const createTransactionContext = async <TTxContext>(
  withTransaction: (callback: (txCtx: TTxContext) => Promise<void>) => Promise<void>,
): Promise<{
  readonly status: "pending" | "resolved" | "rejected";
  run: <TReturn>(
    callback: (txCtx: TTxContext, transactionHooks: TransactionHooks) => Promise<TReturn>,
  ) => Promise<TReturn>;
  resolve: () => Promise<void>;
  reject: (error: unknown) => Promise<void>;
}> => {
  const { transactionHooks, flush, discard } = createTransactionHooks();
  const openPromiseHandlers = Promise.withResolvers<void>();
  const closePromiseHandlers = Promise.withResolvers<void>();
  let status: "pending" | "resolved" | "rejected" = "pending";
  let chain = Promise.resolve();
  let runInContext: <T>(
    cb: (txCtx: TTxContext, transactionHooks: TransactionHooks) => Promise<T>,
  ) => Promise<T>;

  const transactionContext = withTransaction(async (txCtx) => {
    runInContext = async <T>(
      cb: (transactionContext: TTxContext, transactionHooks: TransactionHooks) => Promise<T>,
    ) => cb(txCtx, transactionHooks);

    openPromiseHandlers.resolve();
    await closePromiseHandlers.promise;
  });

  await Promise.race([openPromiseHandlers.promise, transactionContext]);

  return {
    get status() {
      return status;
    },
    run: async <TReturn>(
      callback: (txCtx: TTxContext, transactionHooks: TransactionHooks) => Promise<TReturn>,
    ): Promise<TReturn> => {
      if (status !== "pending") throw new Error("Transaction is already " + status);
      const { resolve, reject, promise } = Promise.withResolvers<TReturn>();
      chain = chain.then(async () => runInContext(callback).then(resolve, reject));
      return promise;
    },
    resolve: async () => {
      if (status !== "pending") return;
      status = "resolved";
      await chain;
      closePromiseHandlers.resolve();
      await transactionContext;
      await flush();
    },
    reject: async (error: unknown) => {
      if (status !== "pending") return;
      status = "rejected";
      await chain;
      closePromiseHandlers.reject(error);
      await transactionContext.catch(() => {});
      await discard().catch(() => {});
    },
  };
};

export type TransactionContext<TTxContext> = Awaited<
  ReturnType<typeof createTransactionContext<TTxContext>>
>;
