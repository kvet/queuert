import { BenchSummary } from "../../../components/BenchSummary.tsx";
import { KeyValueList } from "../../../components/KeyValueList.tsx";
import {
  benchmarkContainers,
  benchmarkHeadlines as headlines,
  benchmarkMachine,
} from "../../../data/benchmarks.ts";

export const meta = {
  title: "Benchmarks",
  description:
    "Throughput, memory, query latency and type-checking cost, measured by the suites in the repository.",
};

const count = (value: number) => `~${value.toLocaleString("en-US")}`;
const seconds = (milliseconds: number) => `~${(milliseconds / 1000).toFixed(1)} s`;

const Page = () => (
  <>
    <p>
      Four suites in{" "}
      <a href="https://github.com/kvet/queuert/tree/main/benchmarks">
        <code>benchmarks/</code>
      </a>{" "}
      measure Queuert on one laptop. Read the numbers as a comparison between adapters and as an
      order of magnitude, not as what a production deployment will reach.
    </p>
    <h2 id="at-a-glance">At a glance</h2>
    <BenchSummary
      tiles={[
        {
          suite: "Processing capacity",
          href: "/benchmarks/processing-capacity/",
          value: count(headlines.postgresCompletion),
          unit: "jobs/s",
          caption: "One worker, 16 slots, completing jobs on PostgreSQL.",
          detail: `${count(headlines.sqliteCompletion)} jobs/s on SQLite; ${count(headlines.postgresBatchedCreation)} chains/s batched creation on PostgreSQL.`,
        },
        {
          suite: "Memory footprint",
          href: "/benchmarks/memory-footprint/",
          value: `~${headlines.retainedAfterClose.min}–${headlines.retainedAfterClose.max}`,
          unit: "KB",
          caption: "Live JS heap left after close(), for every package.",
          detail: "V8 hidden classes, not Queuert state: nothing grows per job or per lifecycle.",
        },
        {
          suite: "Query performance",
          href: "/benchmarks/query-performance/",
          value: `${Math.floor(headlines.postgresOperational.min)}–${Math.ceil(headlines.postgresOperational.max)}`,
          unit: "ms p50",
          caption: "Every per-job state-adapter query on PostgreSQL.",
          detail: `Under ${(Math.ceil(headlines.sqliteOperationalMax * 10) / 10).toFixed(1)} ms each on in-memory SQLite.`,
        },
        {
          suite: "Type complexity",
          href: "/benchmarks/type-complexity/",
          value: `~${headlines.typeCheck100[1]}`,
          unit: "ms",
          caption: "TypeScript 7 type-check of a 100-type chain.",
          detail: `${seconds(headlines.typeCheck2500[1])} for 2,500 job types; cost grows roughly linearly beyond a fixed baseline.`,
        },
      ]}
    />
    <h2 id="environment">Environment</h2>
    <p>
      Every suite ran on the same machine. Each suite page lists its own method and the command that
      reproduces it.
    </p>
    <KeyValueList title="Test setup" items={[...benchmarkMachine, benchmarkContainers]} />
  </>
);

export default Page;
