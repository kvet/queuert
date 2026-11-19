import { createMysqlStateAdapter } from "@queuert/mysql";
import { createMariadbPoolStateProvider } from "example-mysql-state-mariadb/provider";
import { createConnection, createPool } from "mariadb";
import { noopNotifyAdapter } from "queuert/conformance-internal";

import { benchmarkNamespace, requireEnv, runBenchmark } from "./utils.ts";

const connectionOptions = JSON.parse(requireEnv("BENCHMARK_MYSQL_OPTIONS")) as {
  host: string;
  port: number;
  user: string;
  password: string;
};
const database = benchmarkNamespace();
const admin = await createConnection(connectionOptions);
await admin.query(`CREATE DATABASE ${database}`);
const pool = createPool({ ...connectionOptions, database, connectionLimit: 20 });
const stateProvider = createMariadbPoolStateProvider({ pool });

const stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mariadb" });
await stateAdapter.migrateToLatest();

await runBenchmark({
  title: "PROCESSING CAPACITY — MariaDB (mariadb)",
  stateAdapter,
  notifyAdapter: noopNotifyAdapter,
});

await pool.end();
await admin.query(`DROP DATABASE ${database}`);
await admin.end();
