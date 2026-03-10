import {
  type PgNotifyProvider,
  type PgStateProvider,
  createPgNotifyAdapter,
  createPgStateAdapter,
} from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — PG NOTIFY");

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

const notifyProvider: PgNotifyProvider = {
  publish: async (channel, message) => {
    await sql.notify(channel, message);
  },
  subscribe: async (channel, onMessage) => {
    const subscription = await sql.listen(channel, (payload) => {
      onMessage(payload);
    });
    return async () => {
      await subscription.unlisten();
    };
  },
};

const notifyAdapter = await createPgNotifyAdapter({ provider: notifyProvider });
console.log("PostgreSQL (state + notify) ready.");

await runBenchmark({
  stateAdapter,
  notifyAdapter,
  runInTransaction: stateProvider.runInTransaction,
  concurrency,
});

await sql.end();
await pgContainer.stop();
