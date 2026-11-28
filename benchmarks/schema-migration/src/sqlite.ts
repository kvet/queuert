import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSqliteStateAdapter } from "@queuert/sqlite";
import { createSqliteStateAdapter as createLegacySqliteStateAdapter } from "@queuert/sqlite-schema-v1";
import { loadStateDump } from "@queuert/sqlite-schema-v1/conformance-internal";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-sqlite-state-better-sqlite3/provider";

import {
  assertLegacyCore,
  createLog,
  createMeasured,
  createPlans,
  datasetCells,
  scaleLabel,
  seconds,
  seedsFor,
  tableSpecs,
  writeMigrationResults,
} from "./results.ts";
import { createBetterSqlite3StateProvider as createLegacyBetterSqlite3StateProvider } from "./schema-v1/provider.better-sqlite3.ts";
import { type Seed, parseScales } from "./seed.ts";
import { type Check, verifyFence, verifySeedReadback } from "./verify.ts";

assertLegacyCore("@queuert/sqlite-schema-v1");

const scales = parseScales();
const log = createLog("SQLite", "better-sqlite3, file in WAL mode");
const plans = createPlans("SQLite", "pnpm start:sqlite");
const { report } = log;
const { measured, set } = createMeasured();
const directory = mkdtempSync(join(tmpdir(), "queuert-schema-migration-"));

const openDatabase = (name: string) => {
  const db = new Database(join(directory, `${name}.db`));
  db.pragma("journal_mode = WAL");
  return db;
};

const describeSchema = (db: Database.Database): string[] => {
  const objects = db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name LIKE 'queuert_%' AND name NOT LIKE 'queuert_migration%' ORDER BY name",
    )
    .all() as { type: string; name: string; tbl_name: string; sql: string | null }[];
  return objects
    .flatMap(({ type, name, sql }) =>
      type === "table"
        ? (
            db.prepare(`PRAGMA table_xinfo(${name})`).all() as {
              name: string;
              type: string;
              notnull: number;
              dflt_value: string | null;
              pk: number;
            }[]
          ).map(
            (column) =>
              `column ${name}.${column.name} ${column.type} ${column.notnull} ${column.dflt_value ?? ""} ${column.pk}`,
          )
        : [`${type} ${(sql ?? name).replaceAll(/\s+/g, " ")}`],
    )
    .toSorted();
};

const fresh = openDatabase("fresh");
createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db: fresh }),
}).migrateToLatest();
const freshSchema = describeSchema(fresh);
fresh.close();

const sqlChecks = (
  db: Database.Database,
  expected: { jobs: number; blockers: number; workers: number },
): Check[] => {
  const invariants = db
    .prepare(
      `SELECT
        (SELECT count(*) FROM queuert_job j WHERE j.chain_index = 0 AND j.blocking <> EXISTS (
          SELECT 1 FROM queuert_job_blocker jb WHERE jb.blocked_by_chain_id = j.id)
        ) AS "chain blocking differs from a recount",
        (SELECT count(*) FROM queuert_job WHERE chain_index > 0 AND blocking <> 0)
          AS "continuation marked blocking",
        (SELECT count(*) FROM queuert_job WHERE consecutive_failures <> (last_attempt_error IS NOT NULL))
          AS "consecutive_failures differs from last_attempt_error",
        abs((SELECT count(*) FROM queuert_job) - ${expected.jobs}) AS "job count differs",
        abs((SELECT count(*) FROM queuert_job_blocker) - ${expected.blockers})
          AS "blocker row count differs",
        abs((SELECT count(*) FROM queuert_worker) - ${expected.workers}) AS "worker count differs",
        1 - (SELECT count(*) FROM sqlite_master WHERE name = 'queuert_schema_fence_v2')
          + (SELECT count(*) FROM sqlite_master WHERE name = 'queuert_schema_fence_v1')
          AS "fence is not version 2 alone",
        2 - (SELECT count(*) FROM queuert_migration WHERE name IN ('001_schema_v1', '002_schema_v2'))
          AS "migration not recorded"`,
    )
    .get() as Record<string, number>;
  const schema = describeSchema(db);
  const added = schema.filter((line) => !freshSchema.includes(line));
  const removed = freshSchema.filter((line) => !schema.includes(line));
  return [
    ...Object.entries(invariants).map(([name, violations]) => ({ name, violations })),
    {
      name: `schema differs from a new install (${[...added.map((line) => `+${line}`), ...removed.map((line) => `-${line}`)].join("; ")})`,
      violations: added.length + removed.length,
    },
  ];
};

const run = async (seed: Seed) => {
  const name = `bench_${seed.scale}`;
  const db = openDatabase(name);
  const legacyProvider = createLegacyBetterSqlite3StateProvider({ db });
  const legacyAdapter = createLegacySqliteStateAdapter({ stateProvider: legacyProvider });
  legacyAdapter.migrateToLatest();
  const loadStart = performance.now();
  await loadStateDump(legacyProvider, seed.dump, { offsetMs: seed.offsetMs });
  db.exec("ANALYZE");
  db.pragma("wal_checkpoint(TRUNCATE)");
  report(
    `  ${scaleLabel(seed.scale)}: loaded as schema v1 in ${seconds(performance.now() - loadStart)}s, database file ${(statSync(join(directory, `${name}.db`)).size / 2 ** 20).toFixed(0)} MB`,
  );

  const base = createBetterSqlite3StateProvider({ db });
  const stateProvider: typeof base = {
    ...base,
    executeSql: (args) => {
      if (plans.wants(args.sql)) {
        const rows = db.prepare(`EXPLAIN QUERY PLAN ${args.sql}`).all(...args.params) as {
          detail: string;
        }[];
        plans.add(args.sql, rows.map(({ detail }) => detail).join("\n"));
      }
      return base.executeSql(args);
    },
  };
  const stateAdapter = createSqliteStateAdapter<typeof stateProvider, string, string>({
    stateProvider,
  });
  plans.start(scaleLabel(seed.scale));
  const start = performance.now();
  const result = stateAdapter.migrateToLatest();
  const totalMs = performance.now() - start;
  plans.stop();
  if (!result.applied.includes("002_schema_v2") || result.applied.includes("001_schema_v1")) {
    throw new Error(`Unexpected migration result: ${JSON.stringify(result)}`);
  }
  report(`    migrateToLatest ${seconds(totalMs)}s, one transaction`);

  const violations =
    log.reportChecks(
      "invariants",
      sqlChecks(db, {
        jobs: seed.dump.jobs.length,
        blockers: seed.dump.blockers.length,
        workers: seed.dump.workers.length,
      }),
    ) +
    log.reportChecks(
      `read back ${seed.dump.jobs.length} seeded jobs`,
      await verifySeedReadback({
        readJobs: async (jobIds) => stateAdapter.getJobs({ jobIds }),
        readBlockers: async (jobIds) => stateAdapter.getJobsBlockers({ jobIds }),
        seed,
        repairs: { releasesOrphans: false, unblocksStranded: false },
      }),
    ) +
    log.reportChecks(
      "fence",
      await verifyFence({
        legacyWrite: async () =>
          legacyAdapter.withTransaction((txCtx) =>
            legacyAdapter.createJobs({
              txCtx,
              jobs: [{ id: randomUUID(), typeName: "fence:legacy", input: null }],
            }),
          ),
        currentWrite: async () =>
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: randomUUID(), typeName: "fence:current", input: null }],
            }),
          ),
      }),
    );
  db.close();
  rmSync(join(directory, `${name}.db`), { force: true });
  return { totalMs, violations };
};

log.start();
let violations = 0;
for (const { seed, counts } of seedsFor(scales, report)) {
  set(tableSpecs.dataset, scaleLabel(seed.scale), datasetCells(counts));
  const idle = await run(seed);
  violations += idle.violations;
  set(tableSpecs.idle, scaleLabel(seed.scale), { SQLite: seconds(idle.totalMs) });
  report("");
}

log.write();
plans.write();
rmSync(directory, { recursive: true, force: true });
writeMigrationResults({ backend: "SQLite", scales, measured });
if (violations > 0) {
  throw new Error(`${violations} invariant checks failed after 002_schema_v2 on SQLite`);
}
