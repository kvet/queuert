import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";
import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SavepointConformanceContext,
  type SchemaFenceConformanceContext,
  stateAdapterAsyncGroups,
  stateAdapterAsyncLockWaitGroups,
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
  stateAdapterConcurrentTransactionTwoConnectionGroups,
  stateAdapterConcurrentTransactionLockWaitGroups,
  stateAdapterSavepointGroups,
  stateAdapterSchemaFenceConcurrentTransactionGroups,
  stateAdapterSchemaFenceGroups,
  toConformanceTestCases,
} from "queuert/conformance-internal";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";

export type MysqlStateProviderConformanceContext = SchemaFenceConformanceContext &
  SavepointConformanceContext & {
    createStateProvider: () => Promise<MysqlStateProvider<any>>;
  };

export const classifyErrorGroup: ConformanceGroup<MysqlStateProviderConformanceContext> = {
  name: "classifyError",
  cases: [
    {
      name: "classifies a deadlock as transaction_conflict",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        const write = async (sql: string, txCtx?: unknown) =>
          stateProvider.executeSql({
            txCtx,
            sql,
            params: [],
            paramTypes: {},
            columnTypes: {},
            readOnly: false,
          });

        try {
          await write(
            "CREATE TABLE IF NOT EXISTS queuert_conformance_conflict (id INT NOT NULL PRIMARY KEY, value INT NOT NULL) ENGINE=InnoDB",
          );
          await write("INSERT IGNORE INTO queuert_conformance_conflict VALUES (1, 0), (2, 0)");
          const firstLocked = Promise.withResolvers<void>();
          const secondLocked = Promise.withResolvers<void>();
          const lockInOrder = async (
            first: number,
            second: number,
            locked: PromiseWithResolvers<void>,
            otherLocked: Promise<void>,
          ) =>
            stateProvider.withTransaction(async (txCtx) => {
              await write(
                `UPDATE queuert_conformance_conflict SET value = value + 1 WHERE id = ${first}`,
                txCtx,
              );
              locked.resolve();
              await otherLocked;
              await write(
                `UPDATE queuert_conformance_conflict SET value = value + 1 WHERE id = ${second}`,
                txCtx,
              );
            });

          const outcomes = await Promise.allSettled([
            lockInOrder(1, 2, firstLocked, secondLocked.promise),
            lockInOrder(2, 1, secondLocked, firstLocked.promise),
          ]);
          const errors = outcomes.flatMap((outcome) =>
            outcome.status === "rejected" ? [outcome.reason as unknown] : [],
          );
          assert.equal(errors.length, 1);
          assert.deepEqual(stateProvider.classifyError({ error: errors[0] }), {
            kind: "transaction_conflict",
          });
        } finally {
          await write("DROP TABLE IF EXISTS queuert_conformance_conflict");
          await stateProvider.close?.();
        }
      },
    },
  ],
};

export const isolationLevelGroup: ConformanceGroup<MysqlStateProviderConformanceContext> = {
  name: "isolationLevel",
  cases: [
    {
      name: "withTransaction opens transactions at READ COMMITTED",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        const query = async (sql: string, txCtx?: unknown) =>
          stateProvider.executeSql({
            txCtx,
            sql,
            params: [],
            paramTypes: {},
            columnTypes: {},
            readOnly: false,
          });

        try {
          await query(
            "CREATE TABLE IF NOT EXISTS queuert_conformance_probe (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB",
          );
          const rows = await stateProvider.withTransaction(async (txCtx) => {
            await query("SELECT id FROM queuert_conformance_probe LIMIT 1 FOR UPDATE", txCtx);
            // InnoDB serves innodb_trx from a server-wide cache refreshed at most every 100 ms,
            // so a read by another session just before this one can hide this transaction.
            for (let attempt = 1; ; attempt++) {
              const trxRows = await query(
                "SELECT trx_isolation_level AS level FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = CONNECTION_ID()",
                txCtx,
              );
              if (trxRows.length > 0 || attempt === 10) return trxRows;
              await sleep(150);
            }
          });
          assert.equal(rows.length, 1);
          assert.equal((rows[0] as { level: unknown }).level, "READ COMMITTED");
        } finally {
          await query("DROP TABLE IF EXISTS queuert_conformance_probe");
          await stateProvider.close?.();
        }
      },
    },
  ],
};

export const mysqlStateProviderConformanceGroups: ConformanceGroup<MysqlStateProviderConformanceContext>[] =
  [
    ...stateAdapterBaseGroups,
    ...stateAdapterAsyncGroups,
    ...stateAdapterAsyncLockWaitGroups,
    ...stateAdapterSchemaFenceGroups,
    ...stateAdapterConcurrentTransactionGroups,
    ...stateAdapterConcurrentTransactionTwoConnectionGroups,
    ...stateAdapterConcurrentTransactionLockWaitGroups,
    ...stateAdapterSchemaFenceConcurrentTransactionGroups,
    ...stateAdapterSavepointGroups,
    classifyErrorGroup,
    isolationLevelGroup,
  ];

export const createMysqlStateProviderConformanceContext = ({
  createStateProvider,
  dialect,
  withNonTransactionContext,
  withSavepoint,
  stateAdapterOptions,
}: Parameters<
  typeof createMysqlStateProviderConformanceCases
>[0]): MysqlStateProviderConformanceContext => {
  const tables = `${stateAdapterOptions?.schema === undefined ? "" : `${stateAdapterOptions.schema}.`}${stateAdapterOptions?.tablePrefix ?? "queuert_"}`;
  const executeStatements = async (statements: string[]): Promise<void> => {
    const stateProvider = await createStateProvider();
    try {
      for (const sql of statements) {
        await stateProvider.executeSql({
          sql,
          params: [],
          paramTypes: {},
          columnTypes: {},
          readOnly: false,
        });
      }
    } finally {
      await stateProvider.close?.();
    }
  };

  let migrated: Promise<void> | undefined;
  const migrate = async (): Promise<void> => {
    migrated ??= (async () => {
      await using stateAdapter = createMysqlStateAdapter({
        ...stateAdapterOptions,
        stateProvider: await createStateProvider(),
        dialect,
      });
      await stateAdapter.migrateToLatest();
    })();
    return migrated;
  };

  return {
    createStateProvider,
    withNonTransactionContext,
    withSavepoint,
    createStateAdapter: async () => {
      await migrate();
      await executeStatements([
        `DELETE FROM ${tables}job_blocker`,
        `DELETE FROM ${tables}job`,
        `DELETE FROM ${tables}worker`,
      ]);
      return createMysqlStateAdapter({
        ...stateAdapterOptions,
        stateProvider: await createStateProvider(),
        dialect,
      });
    },
    withWritesFenced: async (fn) => {
      await migrate();
      await executeStatements([`DROP TABLE ${tables}schema_fence_v2`]);
      try {
        return await fn();
      } finally {
        await executeStatements([
          `CREATE TABLE ${tables}schema_fence_v2 (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
        ]);
      }
    },
  };
};

/**
 * Prepares the state adapter contract cases for a provider, ready to run. The cases are every state
 * adapter contract case run through `createMysqlStateAdapter` over a provider, plus checks that the
 * provider's `classifyError` reports a deadlock and that its `withTransaction` opens transactions at
 * READ COMMITTED. The cases open their transactions through the provider, so they run at READ
 * COMMITTED, and only the statements the adapter runs outside a transaction take the connection's
 * default level; to cover several defaults, create the cases once per level over providers whose
 * connections default to it, and register each list under its own name, since the case titles
 * repeat. The cases migrate the schema once, before the first case, through a provider from
 * `createStateProvider`; each case then builds its own adapter over a new provider from it, with
 * the tables cleared. Works with any test runner.
 *
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { afterAll, beforeAll, test } from "vitest";
 *
 * let pool: Pool;
 * const cases = createMysqlStateProviderConformanceCases({
 *   createStateProvider: async () => createMysql2PoolStateProvider({ pool }),
 *   dialect: "mysql",
 *   withNonTransactionContext: async (fn) => {
 *     const connection = await pool.getConnection();
 *     try {
 *       return await fn({ connection });
 *     } finally {
 *       connection.release();
 *     }
 *   },
 * });
 * beforeAll(async () => {
 *   pool = createPool(connectionOptions);
 * });
 * afterAll(async () => pool.end());
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run();
 *   });
 * }
 * ```
 *
 * @experimental
 */
export const createMysqlStateProviderConformanceCases = (options: {
  /** Creates the provider under test, over a database the suite may create tables in. */
  createStateProvider: () => Promise<MysqlStateProvider<any>>;
  /** The server the provider connects to. */
  dialect: "mysql" | "mariadb";
  /** Runs the callback with a context of the provider's shape that is not inside a transaction. */
  withNonTransactionContext: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /** Runs `fn` in a savepoint of `txCtx`'s transaction, opened the way the application opens one. */
  withSavepoint?: <T>(txCtx: any, fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /**
   * Options every adapter of the suite is created with, besides its provider and `dialect`, such
   * as the `schema`, `tablePrefix` and ID types your application configures. The suite migrates
   * and clears the tables they name.
   */
  stateAdapterOptions?: Omit<
    Parameters<typeof createMysqlStateAdapter<any, string, string>>[0],
    "stateProvider" | "dialect"
  >;
}): ConformanceTestCase[] =>
  toConformanceTestCases(
    mysqlStateProviderConformanceGroups,
    createMysqlStateProviderConformanceContext(options),
  );
