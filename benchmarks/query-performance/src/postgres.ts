import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createPgStateAdapter } from "@queuert/postgres";
import { fastSeedAllStatesV2 } from "@queuert/postgres/testing";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { type PgPoolContext, createPgPoolStateProvider } from "example-state-postgres-pg/provider";
import { Pool } from "pg";
import { observabilityCoverageGroups, operationalCoverageGroups } from "queuert/testing";

const ITERATIONS = 10;
const EXPLANATIONS_DIR = new URL("../explanations/postgres", import.meta.url).pathname;

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

type CapturedQuery = { id: string | undefined; sql: string; explain: string };

console.log("\nStarting PostgreSQL container...");
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

const pool = new Pool({ connectionString: pgContainer.getConnectionUri(), max: 20 });
const baseProvider = createPgPoolStateProvider({ pool });

let capturing = false;
const captured: CapturedQuery[] = [];
const stateProvider = {
  ...baseProvider,
  executeSql: async (args: Parameters<typeof baseProvider.executeSql>[0]) => {
    if (capturing) {
      try {
        const result = await pool.query(`EXPLAIN (VERBOSE, COSTS) ${args.sql}`, args.params);
        captured.push({
          id: args.id,
          sql: args.sql,
          explain: result.rows.map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"]).join("\n"),
        });
      } catch {
        // DDL / VACUUM / etc.
      }
    }
    return baseProvider.executeSql(args);
  },
};

const stateAdapter = await createPgStateAdapter<PgPoolContext, string>({ stateProvider });
await stateAdapter.migrateToLatest();

console.log(`Seeding data (scale=${scale})...`);
const sentinels = await fastSeedAllStatesV2(baseProvider, { scale });

await pool.query("VACUUM ANALYZE");
console.log("Seed complete.\n");

const sizeResult = await pool.query<{
  kind: string;
  name: string;
  table_name: string;
  size: string;
  rows: string;
}>(`
  SELECT 'table' AS kind, c.relname AS name, c.relname AS table_name,
         pg_size_pretty(pg_table_size(c.oid)) AS size,
         c.reltuples::bigint::text AS rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname LIKE 'queuert_%' AND c.relkind = 'r'
  UNION ALL
  SELECT 'index' AS kind, c.relname AS name, t.relname AS table_name,
         pg_size_pretty(pg_relation_size(c.oid)) AS size,
         c.reltuples::bigint::text AS rows
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_index i ON i.indexrelid = c.oid
  JOIN pg_class t ON t.oid = i.indrelid
  WHERE n.nspname = 'public' AND c.relname LIKE 'queuert_%' AND c.relkind = 'i'
  ORDER BY table_name, kind DESC, name
`);
console.log("  Table & index sizes (after VACUUM ANALYZE):");
const sizeLines: string[] = [`-- scale=${scale}`, ""];
let lastTable = "";
for (const row of sizeResult.rows) {
  if (row.table_name !== lastTable) {
    if (lastTable) {
      sizeLines.push("");
      console.log("");
    }
    lastTable = row.table_name;
  }
  const line = `${row.kind}  ${row.name.padEnd(50)} ${row.size.padStart(10)}  (${row.rows} rows)`;
  console.log(`    ${line}`);
  sizeLines.push(line);
}
console.log("");

capturing = true;

rmSync(EXPLANATIONS_DIR, { recursive: true, force: true });
mkdirSync(EXPLANATIONS_DIR, { recursive: true });
writeFileSync(`${EXPLANATIONS_DIR}/_table_sizes.txt`, sizeLines.join("\n") + "\n");

console.log("═══════════════════════════════════════════════════════════════════════════════════");
console.log("  QUERY PERFORMANCE — POSTGRESQL (pg)");
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
  console.log("");
}

await pool.end();
await pgContainer.stop();
