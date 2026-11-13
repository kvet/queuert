/**
 * MySQL State Adapter Memory Measurement
 */

import { runMysqlBenchmark } from "./mysql-benchmark.ts";

await runMysqlBenchmark({ name: "state-mysql", image: "mysql:26", dialect: "mysql" });
