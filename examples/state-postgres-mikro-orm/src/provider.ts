import type { EntityManager, MikroORM, Transaction } from "@mikro-orm/postgresql";
import type { PgStateProvider } from "@queuert/postgres";
import { CompiledQuery, type Kysely } from "kysely";
import { type TxHooks, createTxHooks } from "queuert";

export type MikroOrmPgContext = { em: EntityManager };

export const createMikroOrmPgStateProvider = ({
  orm,
}: {
  orm: MikroORM;
}): PgStateProvider<MikroOrmPgContext> => {
  const settlers = new WeakMap<
    Transaction,
    { txHooks: TxHooks; commit: () => Promise<void> | void; rollback: () => void }
  >();
  const parents = new WeakMap<object>();
  const takeSettler = (transaction: Transaction) => {
    const settler = settlers.get(transaction);
    settlers.delete(transaction);
    return settler;
  };

  orm.em.getEventManager().registerSubscriber({
    beforeTransactionStart: ({ em, transaction }) => {
      if (transaction === undefined) parents.delete(em);
      else parents.set(em, transaction);
    },
    afterTransactionStart: ({ em, transaction }) => {
      if (transaction === undefined) return;
      const parent = parents.get(em);
      parents.delete(em);
      const parentSettler = parent === undefined ? undefined : settlers.get(parent);
      if (parentSettler === undefined) {
        const { txHooks, flush, discard } = createTxHooks();
        settlers.set(transaction, { txHooks, commit: flush, rollback: discard });
        return;
      }
      const savepoint = parentSettler.txHooks.createSavepoint();
      settlers.set(transaction, {
        txHooks: savepoint.txHooks,
        commit: () => {
          savepoint.release();
        },
        rollback: () => {
          savepoint.rollback();
        },
      });
    },
    afterTransactionCommit: async ({ transaction }) => {
      if (transaction === undefined) return;
      await takeSettler(transaction)?.commit();
    },
    beforeTransactionRollback: ({ transaction }) => {
      if (transaction === undefined) return;
      takeSettler(transaction)?.rollback();
    },
  });

  const getTxHooks = (txCtx: MikroOrmPgContext): TxHooks => {
    const transaction = txCtx.em.getTransactionContext();
    const settler = transaction === undefined ? undefined : settlers.get(transaction);
    if (settler === undefined) {
      throw new Error("The context is not in a transaction opened through MikroORM");
    }
    return settler.txHooks;
  };

  return {
    withTransaction: async (fn) => {
      let transaction: Transaction = undefined;
      try {
        return await orm.em.transactional(async (em) => {
          transaction = em.getTransactionContext();
          return fn({ em });
        });
      } catch (error) {
        if (transaction !== undefined) takeSettler(transaction)?.rollback();
        throw error;
      }
    },
    isTransaction: (txCtx) => txCtx.em.isInTransaction(),
    onTransactionCommit: (txCtx, callback) => {
      getTxHooks(txCtx).onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      getTxHooks(txCtx).onRollback(callback);
    },
    classifyError: ({ error }) => {
      const driverError = error as { code?: unknown; message?: unknown } | undefined;
      if (driverError?.code !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql, params }) => {
      const transaction = txCtx?.em.getTransactionContext<Kysely<unknown>>();
      if (txCtx !== undefined && transaction === undefined) {
        throw new Error("Provided context is not in a transaction");
      }
      const client = transaction ?? orm.em.getConnection().getClient<unknown>();
      const result = await client.executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
    },
  };
};
