/**
 * MariaDB State Adapter Memory Measurement
 */

import { runMysqlBenchmark } from "./mysql-benchmark.ts";

await runMysqlBenchmark({ name: "state-mariadb", image: "mariadb:13", dialect: "mariadb" });
