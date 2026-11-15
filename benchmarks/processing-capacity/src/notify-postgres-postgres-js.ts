import { createPgNotifyAdapter } from "@queuert/postgres";
import { createPostgresJsNotifyProvider } from "example-postgresql-notify-postgres-js/provider";
import postgres from "postgres";
import { createInProcessStateAdapter } from "queuert";

import { benchmarkNamespace, requireEnv, runBenchmark } from "./utils.ts";

const sql = postgres(requireEnv("BENCHMARK_POSTGRES_URL"), { max: 20 });

await runBenchmark({
  title: "PROCESSING CAPACITY — PG NOTIFY (postgres-js)",
  stateAdapter: createInProcessStateAdapter({ mode: "async" }),
  notifyAdapter: createPgNotifyAdapter({
    notifyProvider: createPostgresJsNotifyProvider({ sql }),
    channelPrefix: benchmarkNamespace(),
  }),
});

await sql.end();
