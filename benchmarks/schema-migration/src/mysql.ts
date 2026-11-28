import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { createMysqlStateAdapter } from "@queuert/mysql";
import { createMysqlStateAdapter as createLegacyMysqlStateAdapter } from "@queuert/mysql-schema-v1";
import { loadStateDump } from "@queuert/mysql-schema-v1/conformance-internal";
import {
  type Mysql2PoolContext,
  createMysql2PoolStateProvider,
} from "example-mysql-state-mysql2/provider";
import { type Connection, createConnection, createPool } from "mysql2/promise";
import { GenericContainer, Wait } from "testcontainers";

import {
  assertLegacyCore,
  createLog,
  createMeasured,
  createPlans,
  datasetCells,
  millis,
  scaleLabel,
  seconds,
  seedsFor,
  tableSpecs,
  writeMigrationResults,
} from "./results.ts";
import {
  type Mysql2PoolContext as LegacyMysql2PoolContext,
  createMysql2PoolStateProvider as createLegacyMysql2PoolStateProvider,
} from "./schema-v1/provider.mysql2.ts";
import { type Seed, parseScales } from "./seed.ts";
import { type Check, verifyFence, verifySeedReadback } from "./verify.ts";
import { type Writers, longestStall, startWriters, writeStats } from "./writers.ts";

assertLegacyCore("@queuert/mysql-schema-v1");

const dialect = process.argv.includes("--mariadb") ? "mariadb" : "mysql";
const backend = dialect === "mariadb" ? "MariaDB" : "MySQL";
const image = dialect === "mariadb" ? "mariadb:13" : "mysql:26";
const scales = parseScales();
const log = createLog(backend, `${image}, mysql2`);
const plans = createPlans(backend, `pnpm start:${dialect}`);
const { report } = log;
const { measured, set } = createMeasured();

console.log(`\nStarting ${image} container...`);
const container = await new GenericContainer(image)
  .withEnvironment({ MYSQL_ROOT_PASSWORD: "bench", MARIADB_ROOT_PASSWORD: "bench" })
  .withCommand(["--log-bin=binlog", "--sync-binlog=1", "--innodb-buffer-pool-size=1073741824"])
  .withExposedPorts(3306)
  .withResourcesQuota({ memory: 4, cpu: 8 })
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

const openDatabase = async (name: string) => {
  await admin.query(`CREATE DATABASE ${name}`);
  return (connectionLimit: number) =>
    createPool({ ...connectionOptions, database: name, connectionLimit });
};

const describeSchema = async (connection: Connection, database: string): Promise<string[]> => {
  const [rows] = await connection.query(
    `SELECT CONCAT('column ', table_name, '.', column_name, ' ', column_type, ' ', is_nullable, ' ', COALESCE(column_default, ''), ' ', extra) AS line
     FROM information_schema.columns WHERE table_schema = ?
     UNION ALL
     SELECT CONCAT('index ', table_name, '.', index_name, ' ', non_unique, ' ', seq_in_index, ' ', COALESCE(column_name, ''), ' ', COALESCE(sub_part, ''))
     FROM information_schema.statistics WHERE table_schema = ?
     UNION ALL
     SELECT CONCAT('table ', table_name, ' ', engine, ' ', table_collation)
     FROM information_schema.tables WHERE table_schema = ?`,
    [database, database, database],
  );
  return (rows as { line: string }[])
    .map(({ line }) => line)
    .filter((line) => !/queuert_migration(_lock)?\b/.test(line))
    .toSorted();
};

const freshConnect = await openDatabase("fresh");
const freshPool = freshConnect(2);
await createMysqlStateAdapter({
  stateProvider: createMysql2PoolStateProvider({ pool: freshPool }),
  dialect,
}).migrateToLatest();
const freshSchema = await describeSchema(admin, "fresh");
await freshPool.end();

type Statement = { sql: string; start: number; end: number };

const planWithoutEstimates = (rows: Record<string, unknown>[]): string =>
  rows
    .map((row) =>
      dialect === "mysql"
        ? String(row.EXPLAIN)
        : Object.entries(row)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join("  "),
    )
    .join("\n")
    .replaceAll(/\s*\((?:cost|rows)=[^)]*\)/g, "")
    .replaceAll(/\s+(?:rows|filtered)=\S+/g, "");

const sqlChecks = async (
  database: string,
  expected: { jobs: number; blockers: number; workers: number },
): Promise<Check[]> => {
  const [[invariants]] = (await admin.query(`
    SELECT
      (SELECT COUNT(*) FROM ${database}.queuert_job j
        LEFT JOIN (
          SELECT jb.job_id, SUM(NOT (h.chain_status <=> 'completed')) AS remaining
          FROM ${database}.queuert_job_blocker jb
          LEFT JOIN ${database}.queuert_job h ON h.id = jb.blocked_by_chain_id
          GROUP BY jb.job_id
        ) r ON r.job_id = j.id
        WHERE j.status = 'blocked' AND j.blockers_remaining <> COALESCE(r.remaining, 0))
        AS \`blocked job's blockers_remaining differs from a recount\`,
      (SELECT COUNT(*) FROM ${database}.queuert_job WHERE status <> 'blocked' AND blockers_remaining <> 0)
        AS \`job that is not blocked has blockers_remaining\`,
      (SELECT COUNT(*) FROM ${database}.queuert_job j
        WHERE j.status = 'blocked' AND NOT EXISTS (
          SELECT 1 FROM ${database}.queuert_job_blocker jb
          LEFT JOIN ${database}.queuert_job h ON h.id = jb.blocked_by_chain_id
          WHERE jb.job_id = j.id AND NOT (h.chain_status <=> 'completed')))
        AS \`blocked job whose blockers all completed\`,
      (SELECT COUNT(*) FROM ${database}.queuert_job j
        WHERE j.chain_index = 0 AND j.blocking <> EXISTS (
          SELECT 1 FROM ${database}.queuert_job_blocker jb WHERE jb.blocked_by_chain_id = j.id))
        AS \`chain blocking differs from a recount\`,
      (SELECT COUNT(*) FROM ${database}.queuert_job WHERE chain_index > 0 AND blocking)
        AS \`continuation marked blocking\`,
      (SELECT COUNT(*) FROM ${database}.queuert_job
        WHERE consecutive_failures <> (last_attempt_error IS NOT NULL))
        AS \`consecutive_failures differs from last_attempt_error\`,
      (SELECT COUNT(*) FROM ${database}.queuert_job j
        WHERE j.status = 'running' AND NOT EXISTS (
          SELECT 1 FROM ${database}.queuert_worker w WHERE w.id = j.attempt_by))
        AS \`running job without a worker\`,
      ABS((SELECT COUNT(*) FROM ${database}.queuert_job) - ${expected.jobs}) AS \`job count differs\`,
      ABS((SELECT COUNT(*) FROM ${database}.queuert_job_blocker) - ${expected.blockers})
        AS \`blocker row count differs\`,
      ABS((SELECT COUNT(*) FROM ${database}.queuert_worker) - ${expected.workers})
        AS \`worker count differs\`,
      1 - (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = '${database}' AND table_name = 'queuert_schema_fence_v2')
        + (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = '${database}' AND table_name = 'queuert_schema_fence_v1')
        AS \`fence is not version 2 alone\`,
      2 - (SELECT COUNT(*) FROM ${database}.queuert_migration WHERE name IN ('001_schema_v1', '002_schema_v2'))
        AS \`migration not recorded\`
  `)) as unknown as [[Record<string, string | number>]];
  const schema = await describeSchema(admin, database);
  const added = schema.filter((line) => !freshSchema.includes(line));
  const removed = freshSchema.filter((line) => !schema.includes(line));
  return [
    ...Object.entries(invariants).map(([name, count]) => ({ name, violations: Number(count) })),
    {
      name: `schema differs from a new install (${[...added.map((line) => `+${line}`), ...removed.map((line) => `-${line}`)].join("; ")})`,
      violations: added.length + removed.length,
    },
  ];
};

const run = async (seed: Seed, withWriters: boolean) => {
  const name = `bench_${seed.scale}_${withWriters ? "writers" : "idle"}`;
  const connect = await openDatabase(name);
  const legacyPool = connect(20);
  const pool = connect(4);
  const legacyProvider = createLegacyMysql2PoolStateProvider({ pool: legacyPool });
  const legacyAdapter = createLegacyMysqlStateAdapter<LegacyMysql2PoolContext, string, string>({
    stateProvider: legacyProvider,
    dialect,
  });
  await legacyAdapter.migrateToLatest();
  const loadStart = performance.now();
  await loadStateDump(legacyProvider, seed.dump, { offsetMs: seed.offsetMs });
  await pool.query("ANALYZE TABLE queuert_job, queuert_job_blocker, queuert_worker");
  report(
    `  ${scaleLabel(seed.scale)}${withWriters ? ", schema v1 writers" : ""}: loaded as schema v1 in ${seconds(performance.now() - loadStart)}s`,
  );

  let writers: Writers | undefined;
  let writersFrom = 0;
  if (withWriters) {
    writers = await startWriters({
      stateAdapter: legacyAdapter,
      gateChainIds: seed.gateChainIds,
      producers: 4,
      workers: 4,
    });
    writersFrom = performance.now();
    await sleep(5000);
  }

  const base = createMysql2PoolStateProvider({ pool });
  const statements: Statement[] = [];
  const stateAdapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
    stateProvider: {
      ...base,
      executeSql: async (args) => {
        if (plans.wants(args.sql)) {
          const [rows] = await (args.txCtx?.connection ?? pool).query(
            `${dialect === "mysql" ? "EXPLAIN FORMAT=TREE" : "EXPLAIN"} ${args.sql}`,
            args.params,
          );
          plans.add(args.sql, planWithoutEstimates(rows as Record<string, unknown>[]));
        }
        const start = performance.now();
        try {
          return await base.executeSql(args);
        } finally {
          statements.push({ sql: args.sql, start, end: performance.now() });
        }
      },
    },
    dialect,
  });
  plans.start(`${scaleLabel(seed.scale)}${withWriters ? ", schema v1 writers" : ""}`);
  const start = performance.now();
  const result = await stateAdapter.migrateToLatest();
  const totalMs = performance.now() - start;
  plans.stop();
  await writers?.stop();
  if (!result.applied.includes("002_schema_v2") || result.applied.includes("001_schema_v1")) {
    throw new Error(`Unexpected migration result: ${JSON.stringify(result)}`);
  }

  const fence = statements.find(({ sql }) => /DROP TABLE IF EXISTS \S*schema_fence_v1/.test(sql))!;
  const row = `${backend}, ${scaleLabel(seed.scale).toLowerCase()}${withWriters ? ", schema v1 writers" : ""}`;
  report(
    `    migrateToLatest ${seconds(totalMs)}s: ${seconds(fence.end - start)}s before the fence, ${seconds(totalMs - (fence.end - start))}s after`,
  );
  for (const { sql, start: from, end } of statements.filter(
    ({ start: from, end }) => end - from >= 50,
  )) {
    report(
      `      ${millis(end - from).padStart(9)}ms  ${sql.replaceAll(/\s+/g, " ").trim().slice(0, 110)}`,
    );
  }
  set(tableSpecs.mysqlPhases, row, {
    "Before fence": seconds(fence.end - start),
    "After fence": seconds(totalMs - (fence.end - start)),
  });

  let stallMs: number | undefined;
  if (writers !== undefined) {
    const before = writeStats(writers.ops, writersFrom, start);
    const untilFence = writeStats(writers.ops, start, fence.end);
    stallMs = longestStall(writers.ops, start, fence.end);
    report(
      `    schema v1 writes: before ${before.opsPerSecond.toFixed(0)} ops/s (p99 ${millis(before.p99)}ms), until the fence ${untilFence.opsPerSecond.toFixed(0)} ops/s (p99 ${millis(untilFence.p99)}ms), longest stall ${millis(stallMs)}ms, ${writers.ops.filter(({ outcome }) => outcome === "ok").length} committed, ${writers.ops.filter(({ outcome }) => outcome === "fenced").length} fenced, ${writers.errors.length} other errors`,
    );
    for (const error of writers.errors.slice(0, 5)) report(`      error: ${error}`);
    set(tableSpecs.mysqlWrites, `${backend}, ${scaleLabel(seed.scale).toLowerCase()}`, {
      "Before (ops/s)": before.opsPerSecond.toFixed(0),
      "Before p99 (ms)": millis(before.p99),
      "Until fence (ops/s)": untilFence.opsPerSecond.toFixed(0),
      "Until fence p99 (ms)": millis(untilFence.p99),
    });
  }

  const readJobs = async (jobIds: string[]) => stateAdapter.getJobs({ jobIds });
  const violations =
    log.reportChecks(
      "invariants",
      await sqlChecks(name, {
        jobs: seed.dump.jobs.length + (writers?.expectedJobCount() ?? 0),
        blockers: seed.dump.blockers.length + (writers?.expectedBlockerRowCount() ?? 0),
        workers: seed.dump.workers.length + (writers === undefined ? 0 : 1),
      }),
    ) +
    log.reportChecks(
      `read back ${seed.dump.jobs.length} seeded jobs`,
      await verifySeedReadback({
        readJobs,
        readBlockers: async (jobIds) => stateAdapter.getJobsBlockers({ jobIds }),
        seed,
        repairs: { releasesOrphans: true, unblocksStranded: true },
      }),
    ) +
    (writers === undefined
      ? 0
      : log.reportChecks(
          `read back ${writers.expectedJobCount()} jobs schema v1 writers wrote`,
          await writers.verifyReadback(readJobs),
        )) +
    log.reportChecks(
      "fence",
      await verifyFence({
        legacyWrite: async () =>
          legacyAdapter.withTransaction(async (txCtx) =>
            legacyAdapter.createJobs({
              txCtx,
              jobs: [{ id: randomUUID(), typeName: "fence:legacy", input: null }],
            }),
          ),
        currentWrite: async () =>
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: randomUUID(), typeName: "fence:current", input: null }],
            }),
          ),
      }),
    );

  await pool.end();
  await legacyPool.end();
  await admin.query(`DROP DATABASE ${name}`);
  return { totalMs, stallMs, violations };
};

log.start();
let violations = 0;
for (const { seed, counts } of seedsFor(scales, report)) {
  set(tableSpecs.dataset, scaleLabel(seed.scale), datasetCells(counts));
  const idle = await run(seed, false);
  const loaded = await run(seed, true);
  violations += idle.violations + loaded.violations;
  set(tableSpecs.idle, scaleLabel(seed.scale), { [backend]: seconds(idle.totalMs) });
  set(tableSpecs.writers, scaleLabel(seed.scale), { [backend]: seconds(loaded.totalMs) });
  set(tableSpecs.stall, scaleLabel(seed.scale), { [backend]: millis(loaded.stallMs!) });
  report("");
}

log.write();
plans.write();
await admin.end();
await container.stop();
writeMigrationResults({ backend, scales, measured });
if (violations > 0) {
  throw new Error(`${violations} invariant checks failed after 002_schema_v2 on ${backend}`);
}
