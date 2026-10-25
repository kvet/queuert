import { createPgStateAdapter } from "@queuert/postgres";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";

import { benchmarkNamespace, requireEnv, runBenchmark } from "./utils.js";

const sql = postgres(requireEnv("BENCHMARK_POSTGRES_URL"), { max: 20 });
const schema = benchmarkNamespace();
await sql.unsafe(`CREATE SCHEMA ${schema}`);
const stateProvider = createPostgresJsStateProvider({ sql });

const stateAdapter = createPgStateAdapter({ stateProvider, schema });
await stateAdapter.migrateToLatest();

await runBenchmark({
  title: "PROCESSING CAPACITY — POSTGRESQL (postgres-js)",
  stateAdapter,
});

await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`);
await sql.end();
