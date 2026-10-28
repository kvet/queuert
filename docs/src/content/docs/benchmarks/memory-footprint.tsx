import { BenchChart } from "../../../components/BenchChart.tsx";
import { type FieldItem, FieldList } from "../../../components/FieldList.tsx";
import { KeyValueList } from "../../../components/KeyValueList.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import {
  benchmarkContainers,
  benchmarkMachine,
  benchmarkSourceUrl,
  memoryGroups,
} from "../../../data/benchmarks.ts";

export const meta = {
  title: "Memory Footprint",
  description:
    "Heap allocated and retained by each package across a full build, process, close lifecycle.",
};

const columns = [
  {
    name: "Setup",
    description:
      "Heap allocated by the state adapter, notify adapter, client and in-process worker once built, before any job runs.",
  },
  {
    name: "In-flight peak",
    description: "Heap at its peak while 100 chains are created and processed.",
  },
  {
    name: "Live JS retained",
    description:
      "Live JS object graph left after close(), compared with the baseline. This answers whether Queuert leaks heap.",
  },
  {
    name: "JIT code retained",
    description:
      "V8-compiled code the process keeps. Node modules never unload, so this is a one-time cost of loading the code, not a leak per lifecycle.",
  },
] satisfies FieldItem[];

const setup = [...benchmarkMachine, benchmarkContainers];

const Page = () => (
  <>
    <p>
      Each benchmark builds the adapters, processes 100 jobs and calls <code>close()</code>, in its
      own child process. A discarded warmup run first compiles the code paths and loads lazy
      modules; every number is then measured against a baseline taken after the warmup, from heap
      snapshots rather than <code>process.memoryUsage().heapUsed</code>, which counts V8
      fragmentation and free pages as retention.
    </p>
    <KeyValueList title="Test setup" items={setup} />
    <FieldList title="Columns" items={columns} />
    <BenchChart
      title="Memory per lifecycle"
      unit="KB"
      approximate
      series={["Setup", "In-flight peak", "Live JS retained", "JIT code retained"]}
      groups={memoryGroups}
    />
    <h2 id="reading-the-results">Reading the results</h2>
    <p>
      Live JS retained stays at about 10–25 KB for every package: V8 hidden classes and shape
      descriptors left by method calls, not Queuert state. JIT code retained grows with the code
      paths a package exercises, so packages that run more queries keep more. Neither grows per job
      or per lifecycle.
    </p>
    <p>
      Driver and connection cost (a node-redis client, a postgres.js pool, a NATS connection) lives
      outside Queuert's lifecycle. The benchmark prints it per run but leaves it out of these
      numbers.
    </p>
    <h2 id="reproduce">Reproduce</h2>
    <p>
      From <a href={benchmarkSourceUrl("memory-footprint")}>benchmarks/memory-footprint</a>, with
      Docker running. Its README covers the method and the per-step output.
    </p>
    <Code lang="bash">{`
      pnpm --filter benchmark-memory-footprint start
      pnpm --filter benchmark-memory-footprint start:state-postgres
    `}</Code>
  </>
);

export default Page;
