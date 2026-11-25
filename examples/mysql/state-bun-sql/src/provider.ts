import type { MysqlStateProvider } from "@queuert/mysql";
import type { SQL, TransactionSQL } from "bun";
import { type TxHooks, withTxHooks } from "queuert";

export type BunSqlContext = { txSql: TransactionSQL; txHooks: TxHooks };

const missingTableFailuresByClient = new WeakMap<SQL, Map<string, number>>();

export const createBunSqlStateProvider = ({
  sql,
}: {
  sql: SQL;
}): MysqlStateProvider<BunSqlContext> => {
  const missingTableFailures = missingTableFailuresByClient.get(sql) ?? new Map<string, number>();
  missingTableFailuresByClient.set(sql, missingTableFailures);

  const classifyError: MysqlStateProvider<BunSqlContext>["classifyError"] = ({ error }) => {
    const driverError = error as { errno?: unknown; message?: unknown } | undefined;
    if (driverError?.errno === 1213 || driverError?.errno === 1020) {
      return { kind: "transaction_conflict" };
    }
    if (driverError?.errno !== 1146) return undefined;
    const tableName = /Table '([^']+)' doesn't exist/.exec(String(driverError.message))?.[1];
    return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
  };

  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) => {
        using reserved = await sql.reserve();
        await reserved`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`;
        return await reserved.begin(async (txSql) => cb({ txSql, txHooks }));
      }),
    getTransaction: (txCtx) =>
      typeof txCtx.txSql.savepoint === "function" && txCtx.txHooks.isOpen
        ? txCtx.txHooks
        : undefined,
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError,
    executeSql: async ({ txCtx, sql: query, params }) => {
      const failures = missingTableFailures.get(query) ?? 0;
      try {
        return await (txCtx?.txSql ?? sql).unsafe(
          failures === 0 ? query : `${query} /* reprepare ${failures} */`,
          params,
        );
      } catch (error) {
        if (classifyError({ error })?.kind === "undefined_table") {
          missingTableFailures.set(query, failures + 1);
        }
        throw error;
      }
    },
  };
};
