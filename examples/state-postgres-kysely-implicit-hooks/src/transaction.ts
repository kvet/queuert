import { type ControlledTransaction, type Kysely } from "kysely";
import { type TransactionHooks, createTransactionHooks } from "queuert";

export type KyselyPgContext<TDatabase> = { db: ControlledTransaction<TDatabase, string[]> };

export type KyselyTransactions<TDatabase> = {
  transaction: <T>(fn: (txCtx: KyselyPgContext<TDatabase>) => Promise<T>) => Promise<T>;
  savepoint: <T>(
    txCtx: KyselyPgContext<TDatabase>,
    fn: (txCtx: KyselyPgContext<TDatabase>) => Promise<T>,
  ) => Promise<T>;
  getTransactionHooks: (txDb: Kysely<TDatabase>) => TransactionHooks | undefined;
};

export const createKyselyTransactions = <TDatabase>({
  db,
}: {
  db: Kysely<TDatabase>;
}): KyselyTransactions<TDatabase> => {
  const transactionHooksByTransaction = new WeakMap<Kysely<TDatabase>, TransactionHooks>();

  return {
    transaction: async (fn) => {
      const { transactionHooks, flush, discard } = createTransactionHooks();
      const txDb = await db.startTransaction().execute();
      transactionHooksByTransaction.set(txDb, transactionHooks);
      const result = await fn({ db: txDb }).catch(async (error: unknown) => {
        await txDb.rollback().execute();
        await discard();
        throw error;
      });
      await txDb
        .commit()
        .execute()
        .catch(async (error: unknown) => {
          await discard();
          throw error;
        });
      await flush();
      return result;
    },

    savepoint: async ({ db: parentDb }, fn) => {
      const parentHooks = transactionHooksByTransaction.get(parentDb);
      if (parentHooks === undefined) {
        throw new Error("savepoint requires a transaction opened by transaction()");
      }
      const savepointName = `sp_${crypto.randomUUID().replaceAll("-", "")}`;
      const hooksSavepoint = parentHooks.createSavepoint();
      const txDb = await parentDb.savepoint(savepointName).execute();
      transactionHooksByTransaction.set(txDb, hooksSavepoint.transactionHooks);
      const result = await fn({ db: txDb }).catch(async (error: unknown) => {
        await txDb.rollbackToSavepoint(savepointName).execute();
        hooksSavepoint.rollback();
        throw error;
      });
      await txDb.releaseSavepoint(savepointName).execute();
      hooksSavepoint.release();
      return result;
    },

    getTransactionHooks: (txDb) => transactionHooksByTransaction.get(txDb),
  };
};
