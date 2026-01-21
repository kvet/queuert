/**
 * Shared Setup
 *
 * Provides PostgreSQL container, database connection, adapters, and utilities
 * that are shared across all feature showcases.
 */

import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { PendingQuery, Row, Sql, TransactionSql as _TransactionSql } from "postgres";
import { Log } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// ============================================================================
// Type Definitions
// ============================================================================

type TransactionSql = _TransactionSql & {
  <T extends readonly (object | undefined)[] = Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly postgres.ParameterOrFragment<never>[]
  ): PendingQuery<T>;
};

export type DbContext = { sql: TransactionSql };

// ============================================================================
// Setup Context
// ============================================================================

export interface SetupContext {
  sql: Sql;
  stateAdapter: Awaited<ReturnType<typeof createPgStateAdapter<DbContext>>>;
  notifyAdapter: ReturnType<typeof createInProcessNotifyAdapter>;
  log: Log;
  stateProvider: PgStateProvider<DbContext>;
  cleanup: () => Promise<void>;
}

// ============================================================================
// Setup Function
// ============================================================================

export async function createSetup(): Promise<SetupContext> {
  console.log("Starting PostgreSQL...");
  const pgContainer: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:14")
    .withExposedPorts(5432)
    .start();

  const sql = postgres(pgContainer.getConnectionUri(), { max: 10 });

  const stateProvider: PgStateProvider<DbContext> = {
    runInTransaction: async <T>(cb: (txContext: DbContext) => Promise<T>): Promise<T> => {
      let result: T;
      await sql.begin(async (txSql) => {
        result = await cb({ sql: txSql as TransactionSql });
      });
      return result!;
    },
    executeSql: async ({ txContext, sql: query, params }) => {
      const client = txContext?.sql ?? sql;
      const normalizedParams = (params ?? []) as (string | number | boolean | null)[];
      return client.unsafe(
        query,
        normalizedParams.map((p) => (p === undefined ? null : p)),
      );
    },
  };

  const stateAdapter = await createPgStateAdapter({ stateProvider, schema: "public" });
  await stateAdapter.migrateToLatest();

  const notifyAdapter = createInProcessNotifyAdapter();
  const log: Log = () => {}; // Noop logger for cleaner output

  const cleanup = async (): Promise<void> => {
    await sql.end();
    await pgContainer.stop();
  };

  return {
    sql,
    stateAdapter,
    notifyAdapter,
    log,
    stateProvider,
    cleanup,
  };
}

// ============================================================================
// Utility: Run SQL in transaction
// ============================================================================

export function createTransactionRunner(sql: Sql) {
  return async <T>(cb: (txSql: TransactionSql) => Promise<T>): Promise<T> => {
    let result: T;
    await sql.begin(async (txSql) => {
      result = await cb(txSql as TransactionSql);
    });
    return result!;
  };
}
