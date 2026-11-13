import { For } from "solid-js";

import { BenchChart } from "../../../components/BenchChart.tsx";
import { type FieldItem, FieldList } from "../../../components/FieldList.tsx";
import { type KeyValueItem, KeyValueList } from "../../../components/KeyValueList.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import { StackFilter } from "../../../components/StackFilter.tsx";
import {
  benchmarkContainers,
  benchmarkServers,
  benchmarkMachine,
  benchmarkSourceUrl,
  cpuGroups,
  allocationGroups,
  memoryGroups,
  validationAllocationGroups,
  seriesOf,
  validationCpuGroups,
} from "../../../data/benchmarks.ts";

export const meta = {
  title: "Runtime Performance",
  description:
    "Heap held by each package across a full lifecycle, and the CPU time and allocations each job costs.",
};

const memoryMeasurements = [
  {
    name: "Setup",
    description:
      "Heap allocated by the state adapter, notify adapter, client and worker runner once built, before any job runs.",
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

const cpuCategories = [
  {
    name: "Queuert core",
    description: (
      <>
        The <code>queuert</code> package, including the in-process state and notify adapters.
      </>
    ),
  },
  {
    name: "Adapter",
    description: "The Queuert package under test, such as @queuert/postgres or @queuert/otel.",
  },
  {
    name: "Dependencies",
    description: "Database drivers, pub/sub clients and the OpenTelemetry SDK.",
  },
  {
    name: "Runtime",
    description: "Node.js internals, V8 builtins and garbage collection.",
  },
] satisfies FieldItem[];

const setup = [
  ...benchmarkMachine,
  benchmarkContainers,
  benchmarkServers,
  {
    label: "Work step",
    value: "100 jobs for memory, 2,000 for profiles",
    note: "Each phase runs in its own child process, after a discarded warmup run of the same lifecycle.",
  },
] satisfies KeyValueItem[];

const Page = () => (
  <>
    <p>
      Each benchmark builds the adapters, processes a batch of jobs and calls <code>close()</code>.
      The memory phase measures the heap the lifecycle holds; the profile phase samples CPU time and
      allocations while the jobs are created and processed.
    </p>
    <StackFilter
      backends={["postgres", "sqlite", "mysql", "mariadb", "redis", "nats", "ipc", "in-process"]}
    />
    <KeyValueList title="Test setup" items={setup} />
    <h2 id="memory">Memory</h2>
    <p>
      A discarded warmup run first compiles the code paths and loads lazy modules; every number is
      then measured against a baseline taken after the warmup, from heap snapshots rather than{" "}
      <code>process.memoryUsage().heapUsed</code>, which counts V8 fragmentation and free pages as
      retention.
    </p>
    <FieldList title="Measurements" items={memoryMeasurements} proseNames />
    <For each={memoryMeasurements}>
      {(column, index) => (
        <BenchChart
          title={column.name}
          unit="KB"
          approximate
          series={[column.name]}
          groups={seriesOf(memoryGroups, index())}
        />
      )}
    </For>
    <h2 id="reading-the-results">Reading the results</h2>
    <p>
      Live JS retained is a one-time amount: about 5-20 KB for every package. Running three
      lifecycles instead of one leaves the same amount. JIT code retained grows with the code paths
      a package exercises, so packages that run more queries keep more. Neither grows per job or per
      lifecycle.
    </p>
    <p>
      Driver and connection cost (a node-redis client, a postgres.js or mysql2 pool, a NATS
      connection) lives outside Queuert's lifecycle. The benchmark prints it per run but leaves it
      out of these numbers.
    </p>
    <h2 id="cpu-and-allocations">CPU and allocations</h2>
    <p>
      The CPU profiler samples every 100 µs and the heap profiler samples allocations, including
      objects already collected, only while the work step runs. Each sample is attributed to the
      file of the function it lands in. Time spent waiting on a database or broker is left out.
    </p>
    <FieldList title="Categories" items={cpuCategories} proseNames />
    <For each={cpuCategories}>
      {(category, index) => (
        <BenchChart
          title={`CPU per job, ${category.name}`}
          unit="µs"
          approximate
          series={[category.name]}
          groups={seriesOf(cpuGroups, index())}
        />
      )}
    </For>
    <BenchChart
      title="Allocated per job"
      unit="KB"
      approximate
      decimals={1}
      series={["Allocated"]}
      groups={allocationGroups}
    />
    <h2 id="job-type-registries">Job type registries</h2>
    <p>
      The registry measurements run the same lifecycle on the in-process state and notify adapters
      with each job type registry, creating and processing chains whose input is an order with a
      nested customer and three line items. <code>defineJobTypes</code> is the baseline: it passes
      values through without running anything.
    </p>
    <p>
      The CPU chart shows the time spent inside the schema library. On top of it, every{" "}
      <code>createJobTypes</code> registry adds about 1 µs of Queuert core CPU per job to call the
      encoders and decoders and check that every encoded value is JSON-serializable. The Zod and
      TypeBox adapters compile their schemas once with <code>z.compile</code> and{" "}
      <code>TypeCompiler.Compile</code>, and ArkType compiles its types itself. The codec adapters
      process the same JSON input, so they show the cost of the codec path, not of a transform.
    </p>
    <BenchChart
      title="Schema library CPU per job"
      unit="µs"
      approximate
      decimals={1}
      series={["Schema library"]}
      groups={validationCpuGroups}
    />
    <BenchChart
      title="Allocated per job by registry"
      unit="KB"
      approximate
      decimals={1}
      series={["Allocated"]}
      groups={validationAllocationGroups}
    />
    <h2 id="reproduce">Reproduce</h2>
    <p>
      From <a href={benchmarkSourceUrl("runtime-performance")}>benchmarks/runtime-performance</a>,
      with Docker running. Its README covers the method, the per-step output and the profile files
      for Chrome DevTools or speedscope.
    </p>
    <Code lang="bash">{`
      pnpm --filter benchmark-runtime-performance start
      pnpm --filter benchmark-runtime-performance start:state-postgres
      pnpm --filter benchmark-runtime-performance start:state-sqlite --profile
      pnpm --filter benchmark-runtime-performance start:validation --profile
    `}</Code>
  </>
);

export default Page;
