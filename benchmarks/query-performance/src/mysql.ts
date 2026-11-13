import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createMysqlStateAdapter } from "@queuert/mysql";
import { fastSeedAllStates } from "@queuert/mysql/conformance-internal";
import {
  type Mysql2PoolContext,
  createMysql2PoolStateProvider,
} from "example-state-mysql-mysql2/provider";
import { createConnection, createPool } from "mysql2/promise";
import {
  observabilityCoverageGroups,
  operationalCoverageGroups,
} from "queuert/conformance-internal";
import { GenericContainer, Wait } from "testcontainers";

const ITERATIONS = 10;

const dialect = process.argv.includes("--mariadb") ? "mariadb" : "mysql";
const image = dialect === "mariadb" ? "mariadb:13" : "mysql:26";
const title = dialect === "mariadb" ? "MARIADB 11.4 (mysql2)" : "MYSQL 8.4 (mysql2)";
const EXPLANATIONS_DIR = new URL(`../explanations/${dialect}`, import.meta.url).pathname;
const RESULTS_DIR = new URL("../results", import.meta.url).pathname;
const RESULTS_FILE = `${RESULTS_DIR}/${dialect}.txt`;

const parseScale = (): number => {
  const flag = process.argv.find((a) => a.startsWith("--scale="));
  return flag ? parseInt(flag.split("=")[1], 10) : 100;
};

const scale = parseScale();

const stats = (times: number[]) => ({
  p50: times[Math.floor(times.length * 0.5)],
  p95: times[Math.floor(times.length * 0.95)],
  max: times[times.length - 1],
});

const fmt = (ms: number) => `${ms.toFixed(2)}ms`;

const resultLines: string[] = [];
const report = (line = "") => {
  console.log(line);
  resultLines.push(line);
};

type CapturedQuery = { id: string | undefined; sql: string; explain: string };

console.log(`\nStarting ${image} container...`);
const container = await new GenericContainer(image)
  .withEnvironment({ MYSQL_ROOT_PASSWORD: "bench", MARIADB_ROOT_PASSWORD: "bench" })
  .withCommand(["--log-bin=binlog", "--sync-binlog=1", "--innodb-buffer-pool-size=1073741824"])
  .withExposedPorts(3306)
  .withWaitStrategy(Wait.forLogMessage(/port: 3306/))
  .withStartupTimeout(180_000)
  .start();

const connectionOptions = {
  host: container.getHost(),
  port: container.getMappedPort(3306),
  user: "root",
  password: "bench",
};
const admin = await createConnection(connectionOptions);
await admin.query("CREATE DATABASE queuert_bench");
await admin.end();

const pool = createPool({ ...connectionOptions, database: "queuert_bench", connectionLimit: 20 });
const baseProvider = createMysql2PoolStateProvider({ pool });

const explain = async (
  txCtx: Mysql2PoolContext | undefined,
  sql: string,
  params: unknown[],
): Promise<string> => {
  const connection = txCtx?.connection ?? pool;
  if (dialect === "mysql") {
    const [rows] = await connection.query(`EXPLAIN FORMAT=TREE ${sql}`, params);
    return (rows as { EXPLAIN: string }[]).map((row) => row.EXPLAIN).join("\n");
  }
  const [rows] = await connection.query(`EXPLAIN ${sql}`, params);
  return (rows as Record<string, unknown>[])
    .map((row) =>
      Object.entries(row)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join("  "),
    )
    .join("\n");
};

let capturing = false;
const captured: CapturedQuery[] = [];
const stateProvider = {
  ...baseProvider,
  executeSql: async (args: Parameters<typeof baseProvider.executeSql>[0]) => {
    if (capturing && /^\s*(SELECT|UPDATE|DELETE|INSERT)/i.test(args.sql)) {
      try {
        captured.push({
          id: args.id,
          sql: args.sql,
          explain: await explain(args.txCtx, args.sql, args.params),
        });
      } catch (error) {
        captured.push({
          id: args.id,
          sql: args.sql,
          explain: `-- EXPLAIN failed: ${String(error)}`,
        });
      }
    }
    return baseProvider.executeSql(args);
  },
};

const stateAdapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
  stateProvider,
  dialect,
});
await stateAdapter.migrateToLatest();

console.log(`Seeding data (scale=${scale})...`);
const seedStart = performance.now();
const sentinels = await fastSeedAllStates(baseProvider, { scale });
await pool.query("ANALYZE TABLE queuert_job, queuert_job_blocker, queuert_worker");
console.log(`Seed complete in ${((performance.now() - seedStart) / 1000).toFixed(1)}s.\n`);

const [sizeRows] = await pool.query(`
  SELECT TABLE_NAME AS table_name, TABLE_ROWS AS table_rows,
         ROUND(DATA_LENGTH / 1024 / 1024, 1) AS data_mb, ROUND(INDEX_LENGTH / 1024 / 1024, 1) AS index_mb
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'queuert_bench' AND TABLE_NAME LIKE 'queuert_%'
  ORDER BY TABLE_NAME
`);
const sizeLines: string[] = [`-- scale=${scale}`, ""];
console.log("  Table sizes (after ANALYZE TABLE):");
for (const row of sizeRows as {
  table_name: string;
  table_rows: number;
  data_mb: string;
  index_mb: string;
}[]) {
  const line = `table  ${row.table_name.padEnd(40)} data=${row.data_mb.padStart(8)} MB  indexes=${row.index_mb.padStart(8)} MB  (~${row.table_rows} rows)`;
  console.log(`    ${line}`);
  sizeLines.push(line);
}
console.log("");

capturing = true;

rmSync(EXPLANATIONS_DIR, { recursive: true, force: true });
mkdirSync(EXPLANATIONS_DIR, { recursive: true });
writeFileSync(`${EXPLANATIONS_DIR}/_table_sizes.txt`, sizeLines.join("\n") + "\n");

report("═══════════════════════════════════════════════════════════════════════════════════");
report(`  QUERY PERFORMANCE — ${title}`);
report("═══════════════════════════════════════════════════════════════════════════════════");

for (const group of [...operationalCoverageGroups, ...observabilityCoverageGroups]) {
  report(`  ${group.name}`);
  for (const testCase of group.cases) {
    const times: number[] = [];
    let planCapture: CapturedQuery[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const act = await testCase.run(stateAdapter, sentinels);
      captured.length = 0;
      capturing = i === 0;
      const start = performance.now();
      await act(stateAdapter, sentinels);
      times.push(performance.now() - start);
      if (i === 0) planCapture = [...captured];
    }
    times.sort((a, b) => a - b);
    const s = stats(times);
    report(
      `    ${testCase.key.padEnd(50)} p50=${fmt(s.p50).padStart(10)}  p95=${fmt(s.p95).padStart(10)}  max=${fmt(s.max).padStart(10)}`,
    );

    const filePath = `${EXPLANATIONS_DIR}/${testCase.key.replaceAll("/", "__")}.txt`;
    mkdirSync(dirname(filePath), { recursive: true });
    const sections = planCapture.map((q, i) => {
      const header = `-- Query ${i + 1}${q.id ? ` [${q.id}]` : ""}`;
      return `${header}\n${q.sql}\n\n${q.explain}`;
    });
    const content = [
      `-- ${testCase.key}`,
      `-- scale=${scale}  p50=${fmt(s.p50)}  p95=${fmt(s.p95)}  max=${fmt(s.max)}`,
      "",
      ...sections,
    ].join("\n\n");
    writeFileSync(filePath, content + "\n");
  }
  report("");
}

mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(RESULTS_FILE, [`-- scale=${scale}`, "", ...resultLines].join("\n") + "\n");
console.log(`  Results written to ${RESULTS_FILE}`);
console.log(`  Explanations written to ${EXPLANATIONS_DIR}\n`);

await pool.end();
await container.stop();
