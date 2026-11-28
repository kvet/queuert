import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { createPgStateAdapter } from "@queuert/postgres";
import { createPgStateAdapter as createLegacyPgStateAdapter } from "@queuert/postgres-schema-v1";
import { loadStateDump } from "@queuert/postgres-schema-v1/conformance-internal";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  type PgPoolContext,
  createPgPoolStateProvider,
} from "example-postgresql-state-pg/provider";
import { Pool } from "pg";

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
  type PgPoolContext as LegacyPgPoolContext,
  createPgPoolStateProvider as createLegacyPgPoolStateProvider,
} from "./schema-v1/provider.pg.ts";
import { type Seed, parseScales } from "./seed.ts";
import { type Check, verifyFence, verifySeedReadback } from "./verify.ts";
import { type Writers, longestStall, startWriters, writeStats } from "./writers.ts";

assertLegacyCore("@queuert/postgres-schema-v1");

const scales = parseScales();
const log = createLog("PostgreSQL", "PostgreSQL 18, pg");
const plans = createPlans("PostgreSQL", "pnpm start:postgres");
const { report } = log;
const { measured, set } = createMeasured();

console.log("\nStarting PostgreSQL container...");
const container = await new PostgreSqlContainer("postgres:18")
  .withExposedPorts(5432)
  .withResourcesQuota({ memory: 4, cpu: 8 })
  .start();
const admin = new Pool({ connectionString: container.getConnectionUri(), max: 1 });

const openDatabase = async (name: string) => {
  await admin.query(`CREATE DATABASE ${name}`);
  const uri = new URL(container.getConnectionUri());
  uri.pathname = `/${name}`;
  return (max: number) => new Pool({ connectionString: uri.toString(), max });
};

const dropDatabase = async (name: string) => {
  await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
};

const describeSchema = async (pool: Pool): Promise<string[]> => {
  const { rows } = await pool.query<{ line: string }>(`
    SELECT 'column ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS line
    FROM information_schema.columns WHERE table_schema = 'public'
    UNION ALL
    SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
    UNION ALL
    SELECT 'constraint ' || c.relname || '.' || con.conname || ' ' || pg_get_constraintdef(con.oid)
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'options ' || c.relname || ' ' || coalesce(array_to_string(c.reloptions, ','), '')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    UNION ALL
    SELECT 'trigger ' || tgname FROM pg_trigger WHERE NOT tgisinternal
    UNION ALL
    SELECT 'function ' || proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY 1
  `);
  return rows.map(({ line }) => line).filter((line) => !/queuert_migration(_lock)?\b/.test(line));
};

const freshPool = (await openDatabase("fresh"))(2);
await createPgStateAdapter({
  stateProvider: createPgPoolStateProvider({ pool: freshPool }),
}).migrateToLatest();
const freshSchema = await describeSchema(freshPool);
await freshPool.end();

type Transaction = {
  start: number;
  end: number;
  statements: { sql: string; start: number; end: number }[];
};

/** Wraps the current provider so each transaction 002 runs is timed with its statements. */
const createRecordingProvider = (pool: Pool) => {
  const base = createPgPoolStateProvider({ pool });
  const transactions: Transaction[] = [];
  const open = new WeakMap<PgPoolContext, Transaction>();
  const stateProvider: typeof base = {
    ...base,
    withTransaction: async (fn) => {
      const transaction: Transaction = { start: performance.now(), end: 0, statements: [] };
      try {
        return await base.withTransaction(async (txCtx) => {
          open.set(txCtx, transaction);
          return fn(txCtx);
        });
      } finally {
        transaction.end = performance.now();
        transactions.push(transaction);
      }
    },
    executeSql: async (args) => {
      if (plans.wants(args.sql)) {
        const rows = (await base.executeSql({
          ...args,
          id: undefined,
          sql: `EXPLAIN (COSTS OFF) ${args.sql}`,
          columnTypes: {},
        })) as { "QUERY PLAN": string }[];
        plans.add(args.sql, rows.map((row) => row["QUERY PLAN"]).join("\n"));
      }
      const start = performance.now();
      try {
        return await base.executeSql(args);
      } finally {
        const transaction = args.txCtx === undefined ? undefined : open.get(args.txCtx);
        const statement = { sql: args.sql, start, end: performance.now() };
        if (transaction === undefined) {
          transactions.push({ start, end: statement.end, statements: [statement] });
        } else {
          transaction.statements.push(statement);
        }
      }
    },
  };
  return { stateProvider, transactions };
};

const phasesOf = (transactions: Transaction[]) => {
  const contains = (transaction: Transaction, pattern: RegExp) =>
    transaction.statements.some(({ sql }) => pattern.test(sql));
  const copies = transactions.filter((transaction) => contains(transaction, /FOR KEY SHARE/));
  const swap = transactions.find((transaction) => contains(transaction, /ACCESS EXCLUSIVE MODE/))!;
  const lock = swap.statements.find(({ sql }) => /ACCESS EXCLUSIVE MODE/.test(sql))!;
  const analyze = transactions.find((transaction) => contains(transaction, /^\s*ANALYZE/))!;
  const batches = copies.map(({ start, end }) => end - start).toSorted((a, b) => a - b);
  return {
    slowSwapStatements: swap.statements.filter(({ start, end }) => end - start >= 20),
    copyStart: copies[0].start,
    copyEnd: copies.at(-1)!.end,
    batches,
    lockStart: lock.start,
    lockWaitMs: lock.end - lock.start,
    swapMs: swap.end - lock.end,
    fenceAt: swap.end,
    analyzeMs: analyze.end - analyze.start,
  };
};

const sqlChecks = async (
  pool: Pool,
  expected: { jobs: number; blockers: number; workers: number },
): Promise<Check[]> => {
  const [invariants] = (
    await pool.query<Record<string, string>>(`
      WITH remaining AS (
        SELECT jb.job_id,
          count(*) FILTER (WHERE h.chain_status IS DISTINCT FROM 'completed')::integer AS remaining
        FROM queuert_job_blocker jb
        LEFT JOIN queuert_job h ON h.id = jb.blocked_by_chain_id
        GROUP BY jb.job_id
      )
      SELECT
        count(*) FILTER (WHERE j.status = 'blocked' AND j.blockers_remaining <> coalesce(r.remaining, 0))
          AS "blocked job's blockers_remaining differs from a recount",
        count(*) FILTER (WHERE j.status <> 'blocked' AND j.blockers_remaining <> 0)
          AS "job that is not blocked has blockers_remaining",
        count(*) FILTER (WHERE j.status = 'blocked' AND coalesce(r.remaining, 0) = 0)
          AS "blocked job whose blockers all completed",
        count(*) FILTER (WHERE j.chain_index = 0 AND j.blocking <> EXISTS (
          SELECT 1 FROM queuert_job_blocker jb WHERE jb.blocked_by_chain_id = j.id))
          AS "chain blocking differs from a recount",
        count(*) FILTER (WHERE j.chain_index > 0 AND j.blocking)
          AS "continuation marked blocking",
        count(*) FILTER (WHERE j.consecutive_failures <> (j.last_attempt_error IS NOT NULL)::integer)
          AS "consecutive_failures differs from last_attempt_error",
        count(*) FILTER (WHERE j.status = 'running' AND NOT EXISTS (
          SELECT 1 FROM queuert_worker w WHERE w.id = j.attempt_by))
          AS "running job without a worker",
        abs(count(*) - ${expected.jobs}) AS "job count differs",
        abs((SELECT count(*) FROM queuert_job_blocker) - ${expected.blockers}) AS "blocker row count differs",
        abs((SELECT count(*) FROM queuert_worker) - ${expected.workers}) AS "worker count differs",
        (SELECT count(*) FROM pg_class WHERE relname LIKE 'queuert_job_v2%')
          AS "copy tables left behind",
        1 - (SELECT count(*) FROM pg_class WHERE relname = 'queuert_schema_fence_v2')
          + (SELECT count(*) FROM pg_class WHERE relname = 'queuert_schema_fence_v1')
          AS "fence is not version 2 alone",
        2 - (SELECT count(*) FROM queuert_migration WHERE name IN ('001_schema_v1', '002_schema_v2'))
          AS "migration not recorded"
      FROM queuert_job j
      LEFT JOIN remaining r ON r.job_id = j.id
    `)
  ).rows;
  const schema = await describeSchema(pool);
  return [
    ...Object.entries(invariants).map(([name, count]) => ({ name, violations: Number(count) })),
    {
      name: `schema differs from a new install (${[
        ...schema.filter((line) => !freshSchema.includes(line)).map((line) => `+${line}`),
        ...freshSchema.filter((line) => !schema.includes(line)).map((line) => `-${line}`),
      ].join("; ")})`,
      violations:
        schema.filter((line) => !freshSchema.includes(line)).length +
        freshSchema.filter((line) => !schema.includes(line)).length,
    },
  ];
};

const run = async (seed: Seed, withWriters: boolean) => {
  const name = `bench_${seed.scale}_${withWriters ? "writers" : "idle"}`;
  const connect = await openDatabase(name);
  const legacyPool = connect(20);
  const pool = connect(4);
  for (const each of [legacyPool, pool]) each.on("error", () => {});
  const legacyProvider = createLegacyPgPoolStateProvider({ pool: legacyPool });
  const legacyAdapter = createLegacyPgStateAdapter<LegacyPgPoolContext, string, string>({
    stateProvider: legacyProvider,
  });
  await legacyAdapter.migrateToLatest();
  const loadStart = performance.now();
  await loadStateDump(legacyProvider, seed.dump, { offsetMs: seed.offsetMs });
  await pool.query("VACUUM ANALYZE");
  const {
    rows: [{ size }],
  } = await pool.query<{ size: string }>(
    "SELECT pg_size_pretty(pg_total_relation_size('queuert_job')) AS size",
  );
  report(
    `  ${scaleLabel(seed.scale)}${withWriters ? ", schema v1 writers" : ""}: loaded as schema v1 in ${seconds(performance.now() - loadStart)}s, job table ${size}`,
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

  const { stateProvider, transactions } = createRecordingProvider(pool);
  const stateAdapter = createPgStateAdapter<PgPoolContext, string, string>({ stateProvider });
  const start = performance.now();
  const failures: string[] = [];
  let attemptStart = start;
  let result: Awaited<ReturnType<typeof stateAdapter.migrateToLatest>> | undefined;
  plans.start(`${scaleLabel(seed.scale)}${withWriters ? ", schema v1 writers" : ""}`);
  while (result === undefined) {
    attemptStart = performance.now();
    try {
      result = await stateAdapter.migrateToLatest();
    } catch (error) {
      failures.push(
        String(error instanceof Error && error.cause !== undefined ? error.cause : error),
      );
      report(`    migrateToLatest attempt ${failures.length} failed: ${failures.at(-1)}`);
      if (failures.length === 3) throw error;
    }
  }
  const totalMs = performance.now() - start;
  plans.stop();
  await writers?.stop();
  if (!result.applied.includes("002_schema_v2") || result.applied.includes("001_schema_v1")) {
    throw new Error(`Unexpected migration result: ${JSON.stringify(result)}`);
  }

  const phases = phasesOf(transactions.filter(({ start: from }) => from >= attemptStart));
  report(
    `    migrateToLatest ${seconds(totalMs)}s: copy ${seconds(phases.copyEnd - phases.copyStart)}s in ${phases.batches.length} batches (p50 ${millis(phases.batches[Math.floor(phases.batches.length / 2)])}ms, max ${millis(phases.batches.at(-1)!)}ms), ACCESS EXCLUSIVE wait ${millis(phases.lockWaitMs)}ms, held ${millis(phases.swapMs)}ms, ANALYZE ${seconds(phases.analyzeMs)}s`,
  );
  for (const { sql, start: from, end } of phases.slowSwapStatements) {
    report(
      `      swap ${millis(end - from).padStart(9)}ms  ${sql.replaceAll(/\s+/g, " ").trim().slice(0, 110)}`,
    );
  }
  const row = `${scaleLabel(seed.scale)}${withWriters ? ", schema v1 writers" : ""}`;
  set(tableSpecs.postgresPhases, row, {
    "Copy (s)": seconds(phases.copyEnd - phases.copyStart),
    "Copy batches": String(phases.batches.length),
    "Batch p50 (ms)": millis(phases.batches[Math.floor(phases.batches.length / 2)]),
    "Batch max (ms)": millis(phases.batches.at(-1)!),
    "Lock wait (ms)": millis(phases.lockWaitMs),
    "Swap (ms)": millis(phases.swapMs),
    "ANALYZE (s)": seconds(phases.analyzeMs),
  });

  let stallMs: number | undefined;
  if (writers !== undefined) {
    const before = writeStats(writers.ops, writersFrom, start);
    const during = writeStats(writers.ops, phases.copyStart, phases.copyEnd);
    stallMs = longestStall(writers.ops, start, phases.fenceAt);
    const fenced = writers.ops.filter(({ outcome }) => outcome === "fenced").length;
    report(
      `    schema v1 writes: before ${before.opsPerSecond.toFixed(0)} ops/s (p99 ${millis(before.p99)}ms), during copy ${during.opsPerSecond.toFixed(0)} ops/s (p50 ${millis(during.p50)}ms, p99 ${millis(during.p99)}ms), longest stall ${millis(stallMs)}ms, ${writers.ops.filter(({ outcome }) => outcome === "ok").length} committed, ${fenced} fenced, ${writers.errors.length} other errors`,
    );
    for (const error of writers.errors.slice(0, 5)) report(`      error: ${error}`);
    set(tableSpecs.postgresWrites, scaleLabel(seed.scale), {
      "Before (ops/s)": before.opsPerSecond.toFixed(0),
      "Before p99 (ms)": millis(before.p99),
      "During copy (ops/s)": during.opsPerSecond.toFixed(0),
      "During copy p50 (ms)": millis(during.p50),
      "During copy p99 (ms)": millis(during.p99),
    });
  }

  const readJobs = async (jobIds: string[]) => stateAdapter.getJobs({ jobIds });
  const violations =
    log.reportChecks("migrateToLatest", [
      { name: `failed and was rerun (${failures.join("; ")})`, violations: failures.length },
    ]) +
    log.reportChecks(
      "invariants",
      await sqlChecks(pool, {
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
  await dropDatabase(name);
  return { totalMs, stallMs, violations };
};

log.start();
let violations = 0;
for (const { seed, counts } of seedsFor(scales, report)) {
  set(tableSpecs.dataset, scaleLabel(seed.scale), datasetCells(counts));
  const idle = await run(seed, false);
  const loaded = await run(seed, true);
  violations += idle.violations + loaded.violations;
  set(tableSpecs.idle, scaleLabel(seed.scale), { PostgreSQL: seconds(idle.totalMs) });
  set(tableSpecs.writers, scaleLabel(seed.scale), { PostgreSQL: seconds(loaded.totalMs) });
  set(tableSpecs.stall, scaleLabel(seed.scale), { PostgreSQL: millis(loaded.stallMs!) });
  report("");
}

log.write();
plans.write();
await admin.end();
await container.stop();
writeMigrationResults({ backend: "PostgreSQL", scales, measured });
if (violations > 0) {
  throw new Error(`${violations} invariant checks failed after 002_schema_v2 on PostgreSQL`);
}
