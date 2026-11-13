import { BenchChart, type BenchGroup } from "../../../components/BenchChart.tsx";
import { type KeyValueItem, KeyValueList } from "../../../components/KeyValueList.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import { StackFilter } from "../../../components/StackFilter.tsx";
import {
  benchmarkContainers,
  benchmarkServers,
  benchmarkMachine,
  benchmarkSourceUrl,
  chainJobsGroups,
  discoveryGroups,
  listChainsGroups,
  listJobsGroups,
  operationalGroups,
  workerGroups,
} from "../../../data/benchmarks.ts";

export const meta = {
  title: "Query Performance",
  description:
    "Median latency of every state-adapter query on PostgreSQL, SQLite, MySQL, MariaDB and Redis.",
};

const series = [
  { label: "PostgreSQL", backend: "postgres" },
  { label: "SQLite", backend: "sqlite" },
  { label: "MySQL", backend: "mysql" },
  { label: "MariaDB", backend: "mariadb" },
  { label: "Redis", backend: "redis" },
] as const;

/** One group per query, the backends as its rows, each query on its own scale. */
const queryGroups = (groups: BenchGroup[]): BenchGroup[] =>
  groups.flatMap((group) =>
    group.rows.map((query) => ({
      label: <span class="normal-case">{query.label}</span>,
      rows: series.map((backend, index) => ({
        label: backend.label,
        backend: backend.backend,
        values: [query.values[index]],
      })),
    })),
  );

const QueryChart = (props: { title: string; groups: BenchGroup[] }) => (
  <BenchChart
    title={props.title}
    unit="p50 ms"
    decimals={2}
    scalePerGroup
    series={["p50"]}
    groups={queryGroups(props.groups)}
  />
);

const setup = [
  ...benchmarkMachine,
  benchmarkContainers,
  benchmarkServers,
  { label: "Runs", value: "10 per method", note: "The charts show the median (p50)." },
  {
    label: "Dataset",
    value: "Scale 100",
    note: "Covers all statuses, blocker topologies and continuations.",
  },
  { label: "PostgreSQL", value: "pg driver, after ANALYZE" },
  { label: "SQLite", value: "In memory through better-sqlite3, after ANALYZE" },
  {
    label: "MySQL",
    value: "mysql2 driver, after ANALYZE TABLE",
    note: "1 GB InnoDB buffer pool: InnoDB reads with O_DIRECT, so it has no OS page cache to fall back on.",
  },
  {
    label: "MariaDB",
    value: "mysql2 driver, after ANALYZE TABLE",
    note: "1 GB InnoDB buffer pool.",
  },
  { label: "Redis", value: "ioredis driver" },
] satisfies KeyValueItem[];

const Page = () => (
  <>
    <p>
      Every state-adapter method runs against the same seeded dataset on PostgreSQL, SQLite, MySQL,
      MariaDB and Redis.
    </p>
    <StackFilter backends={["postgres", "sqlite", "mysql", "mariadb", "redis"]} />
    <KeyValueList title="Test setup" items={setup} />
    <h2 id="operational-queries">Operational queries</h2>
    <p>
      The per-job path every worker and client call takes. The <code>limit10</code> variants acquire
      or reclaim ten jobs in one statement, as the worker does when it fills or frees several idle
      slots at once.
    </p>
    <QueryChart title="Operational queries" groups={operationalGroups} />
    <h2 id="listing-queries">Listing queries</h2>
    <p>
      The list, filter and paginate path behind the dashboard, cleanup jobs and the query API. The{" "}
      <code>blocked</code> listing has its own partial index (<code>job_blocked_idx</code>) for its
      filter and scheduled-at ordering, so it lands in the same range as <code>pending</code>.
    </p>
    <QueryChart title="Type discovery & counts" groups={discoveryGroups} />
    <QueryChart title="List chains" groups={listChainsGroups} />
    <QueryChart title="List jobs" groups={listJobsGroups} />
    <QueryChart title="List chain jobs & blocked jobs" groups={chainJobsGroups} />
    <QueryChart title="List workers & worker jobs" groups={workerGroups} />
    <h2 id="reproduce">Reproduce</h2>
    <p>
      From <a href={benchmarkSourceUrl("query-performance")}>benchmarks/query-performance</a>, with
      Docker running for PostgreSQL, MySQL, MariaDB and Redis. Each run also writes the query plans
      to <code>explanations/</code>.
    </p>
    <Code lang="bash">{`
      pnpm --filter benchmark-query-performance start:postgres
      pnpm --filter benchmark-query-performance start:sqlite
      pnpm --filter benchmark-query-performance start:mysql
      pnpm --filter benchmark-query-performance start:mariadb
      pnpm --filter benchmark-query-performance start:redis
    `}</Code>
  </>
);

export default Page;
