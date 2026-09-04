import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import { fastSeedAllStatesV2 } from "@queuert/sqlite/testing";
import Database from "better-sqlite3";
import {
  type BetterSqlite3Context,
  createBetterSqlite3StateProvider,
} from "example-state-sqlite-better-sqlite3/provider";
import { observabilityCoverageGroups, operationalCoverageGroups } from "queuert/testing";

const ITERATIONS = 10;
const EXPLANATIONS_DIR = new URL("../explanations/sqlite", import.meta.url).pathname;

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

type CapturedQuery = { id: string | undefined; sql: string; plan: string[] };

console.log("\nSetting up SQLite (in-memory)...");
const db = new Database(":memory:");
db.pragma("journal_mode = WAL");
db.pragma("auto_vacuum = INCREMENTAL");
db.pragma("foreign_keys = ON");

const baseProvider = createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() });

const captured: CapturedQuery[] = [];
const stateProvider = {
  ...baseProvider,
  executeSql: async (args: Parameters<typeof baseProvider.executeSql>[0]) => {
    try {
      const stmt = db.prepare(`EXPLAIN QUERY PLAN ${args.sql}`);
      const rows = args.params && args.params.length > 0 ? stmt.all(...args.params) : stmt.all();
      const plan = (rows as { detail: string }[]).map((r) => r.detail);
      if (plan.length > 0) {
        captured.push({ id: args.id, sql: args.sql, plan });
      }
    } catch {
      // DDL etc.
    }
    return baseProvider.executeSql(args);
  },
};

const stateAdapter = await createSqliteStateAdapter<BetterSqlite3Context, string>({
  stateProvider,
});
await stateAdapter.migrateToLatest();

console.log(`Seeding data (scale=${scale})...`);
captured.length = 0;
const sentinels = await fastSeedAllStatesV2(baseProvider, { scale });

db.exec("ANALYZE");
console.log("Seed complete.\n");

const pageSize = (db.pragma("page_size") as { page_size: number }[])[0].page_size;
const pageCount = (db.pragma("page_count") as { page_count: number }[])[0].page_count;
const totalBytes = pageSize * pageCount;
const fmtBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};
console.log(`  Database size: ${fmtBytes(totalBytes)} (${pageCount} pages × ${pageSize} B)`);

const sizeLines: string[] = [
  `-- scale=${scale}`,
  "",
  `Database size: ${fmtBytes(totalBytes)} (${pageCount} pages × ${pageSize} B)`,
];

try {
  const sizeRows = db
    .prepare(
      `SELECT m.type AS kind, d.name, m.tbl_name AS table_name,
              SUM(d.pgsize) AS bytes,
              COALESCE(s.stat, '') AS stat
       FROM dbstat d
       JOIN sqlite_master m ON m.name = d.name
       LEFT JOIN sqlite_stat1 s ON s.tbl = d.name AND s.idx IS NULL
                                OR s.idx = d.name
       WHERE d.name LIKE 'queuert_%'
       GROUP BY d.name
       ORDER BY m.tbl_name, m.type DESC, d.name`,
    )
    .all() as { kind: string; name: string; table_name: string; bytes: number; stat: string }[];
  console.log("  Table & index sizes:");
  sizeLines.push("");
  let lastTable = "";
  for (const row of sizeRows) {
    if (row.table_name !== lastTable) {
      if (lastTable) {
        sizeLines.push("");
        console.log("");
      }
      lastTable = row.table_name;
    }
    const rows = row.stat ? row.stat.split(" ")[0] : "";
    const rowsSuffix = rows ? `  (${rows} rows)` : "";
    const line = `${row.kind.padEnd(5)}  ${row.name.padEnd(50)} ${fmtBytes(row.bytes).padStart(10)}${rowsSuffix}`;
    console.log(`    ${line}`);
    sizeLines.push(line);
  }
} catch {
  console.log(
    "  (dbstat not available — compile with SQLITE_ENABLE_DBSTAT_VTAB for per-table breakdown)",
  );
  sizeLines.push("(dbstat not available)");
}
console.log("");

rmSync(EXPLANATIONS_DIR, { recursive: true, force: true });
mkdirSync(EXPLANATIONS_DIR, { recursive: true });
writeFileSync(`${EXPLANATIONS_DIR}/_table_sizes.txt`, sizeLines.join("\n") + "\n");

console.log("═══════════════════════════════════════════════════════════════════════════════════");
console.log("  QUERY PERFORMANCE — SQLITE (better-sqlite3)");
console.log("═══════════════════════════════════════════════════════════════════════════════════");

for (const group of [...operationalCoverageGroups, ...observabilityCoverageGroups]) {
  console.log(`  ${group.name}`);
  for (const testCase of group.cases) {
    const times: number[] = [];
    let planCapture: CapturedQuery[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const act = await testCase.run(stateAdapter, sentinels);
      captured.length = 0;
      const start = performance.now();
      await act(stateAdapter, sentinels);
      times.push(performance.now() - start);
      if (i === 0) planCapture = [...captured];
    }
    times.sort((a, b) => a - b);
    const s = stats(times);
    console.log(
      `    ${testCase.key.padEnd(50)} p50=${fmt(s.p50).padStart(10)}  p95=${fmt(s.p95).padStart(10)}  max=${fmt(s.max).padStart(10)}`,
    );

    const filePath = `${EXPLANATIONS_DIR}/${testCase.key.replaceAll("/", "__")}.txt`;
    mkdirSync(dirname(filePath), { recursive: true });
    const sections = planCapture.map((q, i) => {
      const header = `-- Query ${i + 1}${q.id ? ` [${q.id}]` : ""}`;
      return `${header}\n${q.sql}\n\n${q.plan.join("\n")}`;
    });
    const content = [
      `-- ${testCase.key}`,
      `-- scale=${scale}  p50=${fmt(s.p50)}  p95=${fmt(s.p95)}  max=${fmt(s.max)}`,
      "",
      ...sections,
    ].join("\n\n");
    writeFileSync(filePath, content + "\n");
  }
  console.log("");
}

db.close();
