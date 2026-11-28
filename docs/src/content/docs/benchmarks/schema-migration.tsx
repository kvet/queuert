import { For } from "solid-js";

import { BenchChart } from "../../../components/BenchChart.tsx";
import { type FieldItem, FieldList } from "../../../components/FieldList.tsx";
import { type KeyValueItem, KeyValueList } from "../../../components/KeyValueList.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import { StackFilter } from "../../../components/StackFilter.tsx";
import {
  benchmarkEnvironment,
  benchmarkServers,
  benchmarkSourceUrl,
  migrationIdleGroups,
  migrationRow,
  migrationScales,
  migrationStallGroups,
  migrationWritersGroups,
  seriesOf,
} from "../../../data/benchmarks.ts";

export const meta = {
  title: "Schema migration",
  description:
    "Time to upgrade a schema v1 database with 002_schema_v2 on every state adapter, how long schema v1 writers stall meanwhile, and the checks that the upgraded data is intact.",
};

const count = (value: number) => value.toLocaleString("en-US");

const largest = migrationScales.length - 1;
const largestScale = migrationScales[largest];

const setup = (): KeyValueItem[] => [
  ...benchmarkEnvironment("schema-migration"),
  benchmarkServers,
  {
    label: "Dataset",
    value: migrationScales
      .map(({ label, values }) => `${label}: ${count(values.Jobs)} jobs`)
      .join(" · "),
    note: "Generated and loaded by the published 0.18.0 packages: a simulated week of traffic run through the schema v1 state adapter, so the rows are the ones that adapter writes.",
  },
  {
    label: "Schema v1 writers",
    value: "4 producers, 4 workers, 1 deleter",
    note: "Running the schema v1 state adapter in a closed loop from 5 seconds before the migration until its fence rejects them.",
  },
  { label: "PostgreSQL", value: "pg driver, after VACUUM ANALYZE" },
  { label: "SQLite", value: "better-sqlite3, a database file in WAL mode" },
  { label: "MySQL and MariaDB", value: "mysql2 driver, 1 GB InnoDB buffer pool, binlog on" },
  { label: "Redis", value: "ioredis driver" },
];

const dataset = (): FieldItem[] => [
  {
    name: "Chains with continuations",
    description: `${count(largestScale.values.Continuations)} continuation jobs and ${count(largestScale.values["Completed chains"])} completed chains at ${largestScale.label.toLowerCase()}.`,
  },
  {
    name: "Blocked jobs",
    description: `${count(largestScale.values.Blocked)} blocked jobs on up to 100 blockers each, ${count(largestScale.values["Partly unblocked"])} of them with some blockers completed and some not.`,
  },
  {
    name: "Running jobs",
    description: `${count(largestScale.values.Running)} running jobs, ${count(largestScale.values["Orphaned running"])} of them on a worker whose row is gone.`,
  },
  {
    name: "Stranded blocked jobs",
    description: `${count(largestScale.values["Stranded blocked"])} jobs left in blocked although every blocker completed.`,
  },
  {
    name: "Attempt errors",
    description: `${count(largestScale.values["Attempt errors"])} jobs whose last attempt failed, with the error the schema v1 adapter stored.`,
  },
];

const checks = (): FieldItem[] => [
  {
    name: "Read back",
    description:
      "Every job and its blockers read through the schema v2 adapter equal the schema v1 rows, with the columns 002 adds holding their new values.",
  },
  {
    name: "Recounts",
    description:
      "blocking on every chain and blockers_remaining on every job equal a recount from the blocker rows, and no blocked job has all its blockers completed.",
  },
  {
    name: "Writes during the migration",
    description:
      "Every write a schema v1 writer committed reads back as committed, and every chain it deleted is gone.",
  },
  {
    name: "Schema",
    description:
      "The upgraded tables, columns and indexes equal a new install's, and only write fence version 2 is left.",
  },
  {
    name: "Fence",
    description: "A schema v1 write fails with SchemaFencedError and a schema v2 write succeeds.",
  },
];

const postgresDetails = (): KeyValueItem[] => {
  const idle = migrationRow("PostgreSQL phases", largestScale.label);
  const loaded = migrationRow("PostgreSQL phases", `${largestScale.label}, schema v1 writers`);
  const writes = migrationRow("PostgreSQL schema v1 writes", largestScale.label);
  return [
    {
      label: "Copy",
      value: `${idle["Copy (s)"]} s idle, ${loaded["Copy (s)"]} s under writers`,
      note: `${count(idle["Copy batches"])} batches of 1,000 jobs, each at most ${idle["Batch max (ms)"]} ms idle.`,
    },
    {
      label: "ACCESS EXCLUSIVE held",
      value: `${idle["Swap (ms)"]} ms idle, ${loaded["Swap (ms)"]} ms under writers`,
      note: `Waiting for the lock took ${loaded["Lock wait (ms)"]} ms under writers.`,
    },
    {
      label: "Schema v1 writes during the copy",
      value: `${count(writes["During copy (ops/s)"])} ops/s, p99 ${writes["During copy p99 (ms)"]} ms`,
      note: `${count(writes["Before (ops/s)"])} ops/s with p99 ${writes["Before p99 (ms)"]} ms before the migration started.`,
    },
  ];
};

const Page = () => (
  <>
    <p>
      Upgrading from schema v1 runs the breaking <code>002_schema_v2</code> migration on the jobs
      schema v1 left. This benchmark creates schema v1 and its data with the published 0.18.0
      packages, runs <code>migrateToLatest</code> of the current packages on it, and then checks
      every row. On PostgreSQL the migration copies the job table into a new one in batches of 1,000
      jobs while schema v1 keeps writing, mirroring those writes into the copy, then fences schema
      v1 and swaps the tables under an <code>ACCESS EXCLUSIVE</code> lock.
    </p>
    <StackFilter backends={["postgres", "sqlite", "mysql", "mariadb", "redis"]} />
    <KeyValueList title="Test setup" items={setup()} />
    <FieldList
      title={`Dataset at ${largestScale.label.toLowerCase()}`}
      items={dataset()}
      proseNames
    />
    <h2 id="migration-time">Migration time</h2>
    <p>
      The whole <code>migrateToLatest</code> call on a database nothing else writes to.
    </p>
    <For each={migrationScales}>
      {(scale, index) => (
        <BenchChart
          title={`${scale.label}, ${count(scale.values.Jobs)} jobs`}
          unit="s"
          decimals={2}
          series={[scale.label]}
          groups={seriesOf(migrationIdleGroups, index())}
        />
      )}
    </For>
    <h2 id="under-writes">Under schema v1 writes</h2>
    <p>
      On PostgreSQL schema v1 writers keep writing while the job table is copied and stop at the
      swap; on MySQL and MariaDB they keep writing while the columns and index are added and stop at
      the fence, before the backfill. The stall is the longest a schema v1 write waited before the
      fence.
    </p>
    <BenchChart
      title={`Migration time with schema v1 writers, ${largestScale.label.toLowerCase()}`}
      unit="s"
      decimals={2}
      series={[largestScale.label]}
      groups={seriesOf(migrationWritersGroups, largest)}
    />
    <BenchChart
      title={`Longest schema v1 write stall, ${largestScale.label.toLowerCase()}`}
      unit="ms"
      decimals={1}
      series={[largestScale.label]}
      groups={seriesOf(migrationStallGroups, largest)}
    />
    <KeyValueList
      title={`PostgreSQL at ${largestScale.label.toLowerCase()}`}
      items={postgresDetails()}
    />
    <h2 id="checks">Checks</h2>
    <p>Each run fails unless every check holds after the migration.</p>
    <FieldList title="Checks" items={checks()} proseNames />
    <h2 id="reproduce">Reproduce</h2>
    <p>
      From <a href={benchmarkSourceUrl("schema-migration")}>benchmarks/schema-migration</a>, with
      Docker running for PostgreSQL, MySQL, MariaDB and Redis. <code>--scale=</code> takes a comma
      separated list of scales. Each run writes its numbers to <code>results.md</code> and its log,
      with every slow statement, to <code>results/&lt;database&gt;.md</code>.
    </p>
    <Code lang="bash">{`
      pnpm --filter benchmark-schema-migration start:postgres
      pnpm --filter benchmark-schema-migration start:sqlite
      pnpm --filter benchmark-schema-migration start:mysql
      pnpm --filter benchmark-schema-migration start:mariadb
      pnpm --filter benchmark-schema-migration start:redis
    `}</Code>
  </>
);

export default Page;
