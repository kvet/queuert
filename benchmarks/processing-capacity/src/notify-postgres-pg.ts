import { createPgNotifyAdapter } from "@queuert/postgres";
import { createPgPoolNotifyProvider } from "example-postgresql-notify-pg/provider";
import { Pool } from "pg";
import { createInProcessStateAdapter } from "queuert";

import { benchmarkNamespace, requireEnv, runBenchmark } from "./utils.ts";

const pool = new Pool({ connectionString: requireEnv("BENCHMARK_POSTGRES_URL"), max: 20 });

await runBenchmark({
  title: "PROCESSING CAPACITY — PG NOTIFY (pg)",
  stateAdapter: createInProcessStateAdapter({ mode: "async" }),
  notifyAdapter: createPgNotifyAdapter({
    notifyProvider: createPgPoolNotifyProvider({ pool }),
    channelPrefix: benchmarkNamespace(),
  }),
});

await pool.end();
