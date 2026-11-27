import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import { type SqlJsContext, createSqlJsStateProvider } from "example-sqlite-state-sql-js/provider";
import initSqlJs from "sql.js";

export const openDatabase = async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const lock = createAsyncRwLock();
  const stateProvider = createSqlJsStateProvider({ db, lock });
  const stateAdapter = createSqliteStateAdapter({ stateProvider });
  await stateAdapter.migrateToLatest();

  const sql =
    (txCtx?: SqlJsContext) =>
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
      using _h = await lock.acquireWrite();
      db.close();
    },
  };
};
