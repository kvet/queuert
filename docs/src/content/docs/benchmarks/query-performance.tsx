import { BenchChart } from "../../../components/BenchChart.tsx";
import { type KeyValueItem, KeyValueList } from "../../../components/KeyValueList.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import {
  benchmarkContainers,
  benchmarkMachine,
  benchmarkSourceUrl,
  chainJobsGroups,
  discoveryGroups,
  listChainsGroups,
  listJobsGroups,
  operationalGroups,
} from "../../../data/benchmarks.ts";

export const meta = {
  title: "Query Performance",
  description: "Median latency of every state-adapter query on PostgreSQL and SQLite.",
};

const series = ["PostgreSQL", "SQLite"];

const setup = [
  ...benchmarkMachine,
  benchmarkContainers,
  { label: "Runs", value: "10 per method", note: "The charts show the median (p50)." },
  {
    label: "Dataset",
    value: "Scale 100",
    note: "Covers all statuses, blocker topologies and continuations.",
  },
  { label: "PostgreSQL", value: "pg driver, after ANALYZE" },
  { label: "SQLite", value: "In memory through better-sqlite3, after ANALYZE" },
] satisfies KeyValueItem[];

const Page = () => (
  <>
    <p>Every state-adapter method runs against the same seeded dataset on PostgreSQL and SQLite.</p>
    <KeyValueList title="Test setup" items={setup} />
    <h2 id="operational-queries">Operational queries</h2>
    <p>
      The per-job path every worker and client call takes. The <code>limit10</code> variants acquire
      or reclaim ten jobs in one statement, as the worker does when it fills or frees several idle
      slots at once.
    </p>
    <BenchChart
      title="Operational queries"
      unit="p50 ms"
      decimals={2}
      series={series}
      groups={operationalGroups}
    />
    <h2 id="listing-queries">Listing queries</h2>
    <p>
      The list, filter and paginate path behind the dashboard, cleanup jobs and the query API. The{" "}
      <code>blocked</code> listing has its own partial index (<code>job_blocked_idx</code>) for its
      filter and scheduled-at ordering, so it lands in the same range as <code>pending</code>.
    </p>
    <BenchChart
      title="Type discovery & counts"
      unit="p50 ms"
      decimals={2}
      series={series}
      groups={discoveryGroups}
    />
    <BenchChart
      title="List chains"
      unit="p50 ms"
      decimals={2}
      series={series}
      groups={listChainsGroups}
    />
    <BenchChart
      title="List jobs"
      unit="p50 ms"
      decimals={2}
      series={series}
      groups={listJobsGroups}
    />
    <BenchChart
      title="List chain jobs & blocked jobs"
      unit="p50 ms"
      decimals={2}
      series={series}
      groups={chainJobsGroups}
    />
    <h2 id="reproduce">Reproduce</h2>
    <p>
      From <a href={benchmarkSourceUrl("query-performance")}>benchmarks/query-performance</a>, with
      Docker running for PostgreSQL. Each run also writes the query plans to{" "}
      <code>explanations/</code>.
    </p>
    <Code lang="bash">{`
      pnpm --filter benchmark-query-performance start:postgres
      pnpm --filter benchmark-query-performance start:sqlite
    `}</Code>
  </>
);

export default Page;
