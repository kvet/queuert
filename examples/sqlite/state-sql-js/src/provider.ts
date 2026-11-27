import type { AsyncRwLock, SqliteStateProvider } from "@queuert/sqlite";
import { type TxHooks, withTxHooks } from "queuert";
import type { Database, SqlValue } from "sql.js";

export type SqlJsContext = { db: Database; txHooks: TxHooks };

export const createSqlJsStateProvider = ({
  db,
  lock,
}: {
  db: Database;
  lock: AsyncRwLock;
}): SqliteStateProvider<SqlJsContext> => {
  const toSqlValue = (value: unknown): SqlValue => {
    if (value === undefined || value === null) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "bigint") return Number(value);
    return value as SqlValue;
  };

  const query = (sql: string, params: unknown[]): Record<string, unknown>[] => {
    const statement = db.prepare(sql);
    try {
      statement.bind(params.map(toSqlValue));
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  };

  return {
    withTransaction: async (fn) =>
      withTxHooks(async (txHooks) => {
        using _h = await lock.acquireWrite();
        db.run("BEGIN");
        try {
          const result = await fn({ db, txHooks });
          db.run("COMMIT");
          return result;
        } catch (error) {
          try {
            db.run("ROLLBACK");
          } catch {}
          throw error;
        }
      }),
    getTransaction: (txCtx) => (txCtx.txHooks?.isOpen ? txCtx.txHooks : undefined),
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const tableName = /no such table: (\S+)/.exec(
        String((error as { message?: unknown } | undefined)?.message),
      )?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql, params, readOnly }) => {
      if (txCtx?.txHooks?.isOpen) return query(sql, params);
      using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return query(sql, params);
    },
  };
};
