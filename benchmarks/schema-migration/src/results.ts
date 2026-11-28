import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { type ResultsTable, notMeasured } from "benchmark-results/results-file";
import { writePlansFile } from "benchmark-results/write-plans-file";
import { writeResultsFile } from "benchmark-results/write-results-file";

import { type SeedCounts, countSeed, createSeed } from "./seed.ts";
import type { Check } from "./verify.ts";

export const backends = ["PostgreSQL", "SQLite", "MySQL", "MariaDB", "Redis"] as const;
export type Backend = (typeof backends)[number];
export const writerBackends = ["PostgreSQL", "MySQL", "MariaDB"] as const;

/** The schema v1 adapter must run on the published core its alias pins, not on the workspace one. */
export const assertLegacyCore = (adapterPackage: string): void => {
  const require = createRequire(import.meta.resolve(`${adapterPackage}/package.json`));
  const path = realpathSync(require.resolve("queuert/package.json"));
  const { version } = JSON.parse(readFileSync(path, "utf8")) as { version: string };
  if (version !== "0.18.0" || !path.includes("/node_modules/")) {
    throw new Error(
      `${adapterPackage} resolves queuert ${version} at ${path}, not the published 0.18.0`,
    );
  }
};

export const seconds = (ms: number) => (ms / 1000).toFixed(2);
export const millis = (ms: number) => ms.toFixed(1);

const rule = "═".repeat(83);

/** Prints every reported line and writes them to results/<backend>.md under a heading. */
export const createLog = (backend: Backend, setup: string) => {
  const heading = `Schema migration 002_schema_v2 on ${backend}`;
  const lines: string[] = [];
  const report = (line = "") => {
    console.log(line);
    lines.push(line);
  };
  return {
    start: () => {
      console.log([rule, `  ${heading} (${setup})`, rule].join("\n"));
    },
    report,
    reportChecks: (label: string, checks: Check[]) => {
      const violations = checks.filter(({ violations }) => violations > 0);
      const compared = checks.find(({ name }) => name.endsWith("values compared"));
      report(
        `    ${label}: ${compared === undefined ? `${checks.length} checks` : compared.name}, ${violations.length} violated`,
      );
      for (const { name, violations: count } of violations) report(`      ✗ ${name}: ${count}`);
      return violations.length;
    },
    write: () => {
      const dir = new URL("../results", import.meta.url).pathname;
      mkdirSync(dir, { recursive: true });
      const path = `${dir}/${backend.toLowerCase()}.md`;
      writeFileSync(
        path,
        [`# ${heading}`, "", setup, "", "```text", lines.join("\n").trimEnd(), "```"].join("\n") +
          "\n",
      );
      console.log(`  Log written to ${path}`);
    },
  };
};

export const createPlans = (backend: Backend, rerun: string) => {
  const runs = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  return {
    start: (run: string) => {
      current = new Map();
      runs.set(run, current);
    },
    stop: () => {
      current = undefined;
    },
    wants: (sql: string) =>
      current !== undefined &&
      /^\s*(SELECT|UPDATE|DELETE|INSERT|WITH)\b/i.test(sql) &&
      !current.has(sql),
    add: (sql: string, plan: string) => {
      current?.set(sql, plan);
    },
    write: () => {
      writePlansFile({
        path: new URL(`../plans/${backend.toLowerCase()}.md`, import.meta.url).pathname,
        title: `Schema migration 002_schema_v2 plans on ${backend}`,
        description: `Plans of every statement 002_schema_v2 runs, per run, in the order each first runs, planned in its transaction just before it runs, without cost and row estimates, and with IDs and timestamps replaced by placeholders. Rerun \`${rerun}\` after a migration change and review the diff.`,
        sections: [...runs].map(([run, plans]) => ({
          heading: run,
          plans: [...plans]
            .filter(([, plan]) => plan.trim() !== "")
            .map(([sql, plan]) => ({
              label: sql.replaceAll(/\s+/g, " ").trim().slice(0, 110),
              plan,
            })),
        })),
      });
    },
  };
};

export const seedsFor = function* (scales: number[], report: (line?: string) => void) {
  for (const scale of scales) {
    const start = performance.now();
    const seed = createSeed(scale);
    const counts = countSeed(seed);
    report(
      `  scale ${scale}: ${counts.jobs.toLocaleString("en-US")} jobs, ${counts.blockerRows.toLocaleString("en-US")} blocker rows, generated as schema v1 in ${seconds(performance.now() - start)}s`,
    );
    yield { seed, counts };
  }
};

const datasetColumns: [string, keyof SeedCounts][] = [
  ["Jobs", "jobs"],
  ["Chains", "chains"],
  ["Continuations", "continuations"],
  ["Completed chains", "completedChains"],
  ["Blocker rows", "blockerRows"],
  ["Blocked", "blocked"],
  ["Partly unblocked", "blockedPartly"],
  ["Running", "running"],
  ["Orphaned running", "orphaned"],
  ["Stranded blocked", "stranded"],
  ["Attempt errors", "attemptErrors"],
];

export const scaleLabel = (scale: number) => `Scale ${scale}`;

type TableSpec = { title: string; columns: string[]; rows: (scales: number[]) => string[] };

const perScale = (suffixes: string[]) => (scales: number[]) =>
  scales.flatMap((scale) => suffixes.map((suffix) => `${scaleLabel(scale)}${suffix}`));

const perDialect = (scales: number[]) =>
  ["MySQL", "MariaDB"].flatMap((dialect) =>
    scales.flatMap((scale) => [
      `${dialect}, ${scaleLabel(scale).toLowerCase()}`,
      `${dialect}, ${scaleLabel(scale).toLowerCase()}, schema v1 writers`,
    ]),
  );

export const tableSpecs = {
  dataset: {
    title: "Dataset",
    columns: datasetColumns.map(([label]) => label),
    rows: perScale([""]),
  },
  idle: { title: "Migration time, idle (s)", columns: [...backends], rows: perScale([""]) },
  writers: {
    title: "Migration time, with schema v1 writers (s)",
    columns: [...writerBackends],
    rows: perScale([""]),
  },
  stall: {
    title: "Longest schema v1 write stall (ms)",
    columns: [...writerBackends],
    rows: perScale([""]),
  },
  postgresPhases: {
    title: "PostgreSQL phases",
    columns: [
      "Copy (s)",
      "Copy batches",
      "Batch p50 (ms)",
      "Batch max (ms)",
      "Lock wait (ms)",
      "Swap (ms)",
      "ANALYZE (s)",
    ],
    rows: perScale(["", ", schema v1 writers"]),
  },
  postgresWrites: {
    title: "PostgreSQL schema v1 writes",
    columns: [
      "Before (ops/s)",
      "Before p99 (ms)",
      "During copy (ops/s)",
      "During copy p50 (ms)",
      "During copy p99 (ms)",
    ],
    rows: perScale([""]),
  },
  mysqlPhases: {
    title: "MySQL and MariaDB phases (s)",
    columns: ["Before fence", "After fence"],
    rows: perDialect,
  },
  mysqlWrites: {
    title: "MySQL and MariaDB schema v1 writes",
    columns: ["Before (ops/s)", "Before p99 (ms)", "Until fence (ops/s)", "Until fence p99 (ms)"],
    rows: (scales: number[]) => perDialect(scales).filter((row) => !row.endsWith("writers")),
  },
  redisPhases: {
    title: "Redis phases (s)",
    columns: ["Blocking flags", "consecutiveFailures rewrite"],
    rows: perScale([""]),
  },
} satisfies Record<string, TableSpec>;

export type Measured = Map<string, Map<string, Map<string, string>>>;

export const createMeasured = () => {
  const measured: Measured = new Map();
  return {
    measured,
    set: (table: TableSpec, row: string, cells: Record<string, string>) => {
      const rows = measured.get(table.title) ?? new Map<string, Map<string, string>>();
      const columns = rows.get(row) ?? new Map<string, string>();
      for (const [column, value] of Object.entries(cells)) {
        if (!table.columns.includes(column)) throw new Error(`${table.title} has no ${column}`);
        columns.set(column, value);
      }
      rows.set(row, columns);
      measured.set(table.title, rows);
    },
  };
};

export const datasetCells = (counts: SeedCounts): Record<string, string> =>
  Object.fromEntries(datasetColumns.map(([label, key]) => [label, String(counts[key])]));

/**
 * Writes every table to results.md: the cells this run measured, and the other backends' cells
 * from earlier runs.
 */
export const writeMigrationResults = ({
  backend,
  scales,
  measured,
}: {
  backend: Backend;
  scales: number[];
  measured: Measured;
}): void => {
  const path = new URL("../results.md", import.meta.url).pathname;
  writeResultsFile({
    path,
    title: "Schema migration",
    ran: `${backend} at scales ${scales.join(", ")}`,
    tables: Object.values(tableSpecs).map((spec): ResultsTable => ({
      title: spec.title,
      columns: [spec.title === tableSpecs.dataset.title ? "Scale" : "Run", ...spec.columns],
      rows: spec
        .rows(scales)
        .map((row) => [
          row,
          ...spec.columns.map(
            (column) => measured.get(spec.title)?.get(row)?.get(column) ?? notMeasured,
          ),
        ]),
    })),
  });
  console.log(`  Results written to ${path}`);
};
