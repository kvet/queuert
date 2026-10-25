import { createPgStateAdapter } from "@queuert/postgres";
import { createPgPoolStateProvider } from "example-state-postgres-pg/provider";
import { Pool } from "pg";

import { benchmarkNamespace, requireEnv, runBenchmark } from "./utils.js";

const pool = new Pool({ connectionString: requireEnv("BENCHMARK_POSTGRES_URL"), max: 20 });
const schema = benchmarkNamespace();
await pool.query(`CREATE SCHEMA ${schema}`);
const stateProvider = createPgPoolStateProvider({ pool });

const stateAdapter = await createPgStateAdapter({ stateProvider, schema });
await stateAdapter.migrateToLatest();

await runBenchmark({
  title: "PROCESSING CAPACITY — POSTGRESQL (pg)",
  stateAdapter,
});

await pool.query(`DROP SCHEMA ${schema} CASCADE`);
await pool.end();
