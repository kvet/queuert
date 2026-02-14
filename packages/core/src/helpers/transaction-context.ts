export const createTransactionContext = async <TTxContext>(
  runInTransaction: (callback: (txContext: TTxContext) => Promise<void>) => Promise<void>,
) => {
  const openPromiseHandlers = Promise.withResolvers<void>();
  const closePromiseHandlers = Promise.withResolvers<void>();
  let status: "pending" | "resolved" | "rejected" = "pending";
  let chain = Promise.resolve();
  let runInContext: <T>(cb: (txContext: TTxContext) => Promise<T>) => Promise<T>;

  const transactionContext = runInTransaction(async (txContext) => {
    // TODO: return AsyncResource.bind support
    runInContext = async <T>(cb: (transactionContext: TTxContext) => Promise<T>) => cb(txContext);

    openPromiseHandlers.resolve();
    await closePromiseHandlers.promise;
  });

  await Promise.race([openPromiseHandlers.promise, transactionContext]);

  return {
    get status() {
      return status;
    },
    run: async <TReturn>(
      callback: (txContext: TTxContext) => Promise<TReturn>,
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
    },
    reject: async (error: unknown) => {
      if (status !== "pending") return;
      status = "rejected";
      await chain;
      closePromiseHandlers.reject(error);
      await transactionContext.catch(() => {});
    },
  };
};

export type TransactionContext<TTxContext> = Awaited<
  ReturnType<typeof createTransactionContext<TTxContext>>
>;
