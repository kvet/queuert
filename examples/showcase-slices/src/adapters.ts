import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, {
  type PendingQuery,
  type Row,
  type TransactionSql as _TransactionSql,
} from "postgres";
import { createInProcessNotifyAdapter } from "queuert/internal";

type TransactionSql = _TransactionSql & {
  <T extends readonly (object | undefined)[] = Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly postgres.ParameterOrFragment<never>[]
  ): PendingQuery<T>;
};

export type DbContext = { sql: TransactionSql };

const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
export const sql = postgres(pgContainer.getConnectionUri(), { max: 10 });

const stateProvider: PgStateProvider<DbContext> = {
  withTransaction: async (cb) =>
    sql.begin(async (txSql) => cb({ sql: txSql as TransactionSql }) as any),
  withSavepoint: async (txCtx, fn) =>
    txCtx.sql.savepoint(async (savepointSql) => fn({ sql: savepointSql as TransactionSql })) as any,
  executeSql: async ({ txCtx, sql: query, params }) => {
    const client = txCtx?.sql ?? sql;
    return client.unsafe(
      query,
      (params ?? []).map((p) => (p === undefined ? null : p)) as (
        | string
        | number
        | boolean
        | null
      )[],
    );
  },
};

export const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

export const notifyAdapter = createInProcessNotifyAdapter();

export const stopContainer = async () => {
  await sql.end();
  await pgContainer.stop();
};
