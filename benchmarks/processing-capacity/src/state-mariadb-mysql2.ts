import { createMysqlStateAdapter } from "@queuert/mysql";
import { createMysql2PoolStateProvider } from "example-state-mysql-mysql2/provider";
import { createConnection, createPool } from "mysql2/promise";

import { benchmarkNamespace, noopNotifyAdapter, requireEnv, runBenchmark } from "./utils.ts";

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
const stateProvider = createMysql2PoolStateProvider({ pool });

const stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mariadb" });
await stateAdapter.migrateToLatest();

await runBenchmark({
  title: "PROCESSING CAPACITY — MariaDB (mysql2)",
  stateAdapter,
  notifyAdapter: noopNotifyAdapter,
});

await pool.end();
await admin.query(`DROP DATABASE ${database}`);
await admin.end();
