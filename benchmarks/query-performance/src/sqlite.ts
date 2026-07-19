import { mkdirSync, writeFileSync } from "node:fs";
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

mkdirSync(EXPLANATIONS_DIR, { recursive: true });

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
