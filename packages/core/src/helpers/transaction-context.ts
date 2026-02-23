// Preserve caller's async context (e.g., OTEL traces) across transaction callbacks.
// Falls back to identity when async_hooks is unavailable (e.g., Bun).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
const asyncResourceBindPromise: Promise<<T extends AnyFn>(fn: T) => T> = import("node:async_hooks")
  .then(
    ({ AsyncResource }) =>
      <T extends AnyFn>(fn: T): T =>
        AsyncResource.bind(fn),
  )
  .catch(
    () =>
      <T extends AnyFn>(fn: T): T =>
        fn,
  );

export const createTransactionContext = async <TTxContext>(
  runInTransaction: (callback: (txCtx: TTxContext) => Promise<void>) => Promise<void>,
) => {
  const bind = await asyncResourceBindPromise;
  const openPromiseHandlers = Promise.withResolvers<void>();
  const closePromiseHandlers = Promise.withResolvers<void>();
  let status: "pending" | "resolved" | "rejected" = "pending";
  let chain = Promise.resolve();
  let runInContext: <T>(cb: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  const transactionContext = runInTransaction(async (txCtx) => {
    runInContext = bind(async <T>(cb: (transactionContext: TTxContext) => Promise<T>) => cb(txCtx));

    openPromiseHandlers.resolve();
    await closePromiseHandlers.promise;
  });

  await Promise.race([openPromiseHandlers.promise, transactionContext]);

  return {
    get status() {
      return status;
    },
    run: async <TReturn>(callback: (txCtx: TTxContext) => Promise<TReturn>): Promise<TReturn> => {
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
