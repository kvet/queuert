import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — POSTGRESQL");

const concurrency = parseConcurrency();

console.log("\nStarting PostgreSQL container...");
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

const sql = postgres(pgContainer.getConnectionUri(), { max: 20 });

type DbContext = { sql: typeof sql };
const stateProvider: PgStateProvider<DbContext> = {
  runInTransaction: async (cb) => {
    let result: unknown;
    await sql.begin(async (txSql) => {
      result = await cb({ sql: txSql as unknown as typeof sql });
    });
    return result as never;
  },
  executeSql: async ({ txCtx, sql: query, params }) => {
    const sqlClient = txCtx?.sql ?? sql;
    const normalizedParams = params ? params.map((p) => (p === undefined ? null : p)) : [];
    const result = await sqlClient.unsafe(query, normalizedParams as never[]);
    return result as Record<string, unknown>[];
  },
};

const stateAdapter = await createPgStateAdapter({ stateProvider, schema: "public" });
await stateAdapter.migrateToLatest();
console.log("PostgreSQL ready.");

await runBenchmark({
  stateAdapter,
  notifyAdapter: createInProcessNotifyAdapter(),
  runInTransaction: stateProvider.runInTransaction,
  concurrency,
});

await sql.end();
await pgContainer.stop();
