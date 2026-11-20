import {
  type EntityManager,
  IsolationLevel,
  type MikroORM,
  type Transaction,
} from "@mikro-orm/mysql";
import type { MysqlStateProvider } from "@queuert/mysql";
import { CompiledQuery, type Kysely } from "kysely";
import { type TxHooks, createTxHooks } from "queuert";

export type MikroOrmMysqlContext = { em: EntityManager };

export const createMikroOrmMysqlStateProvider = ({
  orm,
}: {
  orm: MikroORM;
}): MysqlStateProvider<MikroOrmMysqlContext> => {
  const settlers = new WeakMap<
    Transaction,
    { txHooks: TxHooks; commit: () => Promise<void> | void; rollback: () => Promise<void> | void }
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
    afterTransactionRollback: async ({ transaction }) => {
      if (transaction === undefined) return;
      await takeSettler(transaction)?.rollback();
    },
  });

  const getTxHooks = (txCtx: MikroOrmMysqlContext): TxHooks => {
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
        return await orm.em.transactional(
          async (em) => {
            transaction = em.getTransactionContext();
            return fn({ em });
          },
          { isolationLevel: IsolationLevel.READ_COMMITTED },
        );
      } catch (error) {
        if (transaction !== undefined) await takeSettler(transaction)?.rollback();
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
      const driverError = error as { errno?: unknown; message?: unknown } | undefined;
      if (driverError?.errno === 1213 || driverError?.errno === 1020) {
        return { kind: "transaction_conflict" };
      }
      if (driverError?.errno !== 1146) return undefined;
      const tableName = /Table '([^']+)' doesn't exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql, params }) => {
      const transaction = txCtx?.em.getTransactionContext<Kysely<unknown>>();
      if (txCtx !== undefined && transaction === undefined) {
        throw new Error("Provided context is not in a transaction");
      }
      const connection = orm.em.getConnection();
      await connection.initClient();
      const client = transaction ?? connection.getClient<unknown>();
      const result = await client.executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
    },
  };
};
