import type { MysqlStateProvider } from "@queuert/mysql";
import type { SQL, TransactionSQL } from "bun";
import { type TxHooks, withTxHooks } from "queuert";

export type BunSqlContext = { txSql: TransactionSQL; txHooks: TxHooks };

// Bun caches a statement whose prepare failed on the connection and replays the error on every
// later run, even after the table exists, so a statement that hit a missing table is sent with a
// new comment to prepare it again. The count is kept per client, as its connections hold the cache.
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
    if (driverError?.errno !== 1146) return undefined;
    const tableName = /Table '([^']+)' doesn't exist/.exec(String(driverError.message))?.[1];
    return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
  };

  return {
    // MySQL's START TRANSACTION takes no isolation level, so the level is set on a reserved
    // connection just before `begin` opens the transaction on it.
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) => {
        using reserved = await sql.reserve();
        await reserved`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`;
        return await reserved.begin(async (txSql) => cb({ txSql, txHooks }));
      }),
    isTransaction: (txCtx) => typeof txCtx.txSql.savepoint === "function",
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError,
    executeStatements: async ({ txCtx, statements }) => {
      const client = txCtx?.txSql ?? sql;
      const results: unknown[][] = [];
      for (const { sql: query, params } of statements) {
        const failures = missingTableFailures.get(query) ?? 0;
        try {
          results.push(
            await client.unsafe(
              failures === 0 ? query : `${query} /* reprepare ${failures} */`,
              params,
            ),
          );
        } catch (error) {
          if (classifyError({ error }) !== undefined) missingTableFailures.set(query, failures + 1);
          throw error;
        }
      }
      return results;
    },
  };
};
