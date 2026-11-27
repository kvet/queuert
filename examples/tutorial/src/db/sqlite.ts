import { createSqliteStateAdapter, type SqliteStateProvider } from "@queuert/sqlite";
import { type TxHooks, withTxHooks } from "queuert";
import initSqlJs, { type Database, type SqlValue } from "sql.js";

export type TxContext = { db: Database; txHooks: TxHooks };

export const openDatabase = async () => {
  const SQL = await initSqlJs({ useOldExtensionFunctions: false });
  const db = new SQL.Database();
  const stateProvider = createSqlJsStateProvider({ db });
  const stateAdapter = createSqliteStateAdapter({ stateProvider });
  await stateAdapter.migrateToLatest();

  const sql =
    (txCtx?: TxContext) =>
    async <TRow = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<TRow[]> =>
      (await stateProvider.executeSql({
        txCtx,
        sql: strings.join("?"),
        params: values,
        paramTypes: {},
        columnTypes: {},
        readOnly: false,
      })) as TRow[];

  return {
    stateAdapter,
    sql,
    [Symbol.asyncDispose]: async () => {
      await stateAdapter[Symbol.asyncDispose]();
      await stateProvider[Symbol.asyncDispose]();
    },
  };
};

export const createSqlJsStateProvider = ({
  db,
}: {
  db: Database;
}): SqliteStateProvider<TxContext> & AsyncDisposable => {
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

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
      withTxHooks(async (txHooks) =>
        exclusive(async () => {
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
      ),
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
    executeSql: async ({ txCtx, sql, params }) =>
      txCtx?.txHooks === undefined ? exclusive(async () => query(sql, params)) : query(sql, params),
    [Symbol.asyncDispose]: async () => {
      await exclusive(async () => {
        db.close();
      });
    },
  };
};
