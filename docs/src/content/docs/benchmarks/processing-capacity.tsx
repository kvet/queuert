import { For } from "solid-js";

import { BenchChart } from "../../../components/BenchChart.tsx";
import { type KeyValueItem, KeyValueList } from "../../../components/KeyValueList.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import { StackFilter } from "../../../components/StackFilter.tsx";
import {
  benchmarkContainers,
  benchmarkServers,
  benchmarkMachine,
  benchmarkSourceUrl,
  completionGroups,
  creationGroups,
  seriesOf,
} from "../../../data/benchmarks.ts";

export const meta = {
  title: "Processing Capacity",
  description: "Chain creation and job completion throughput for every state and notify adapter.",
};

const setup = [
  ...benchmarkMachine,
  benchmarkContainers,
  benchmarkServers,
  {
    label: "Window",
    value: "2 s per scenario",
    note: "Each scenario runs in its own child process, so a slow adapter costs the same wall time as a fast one.",
  },
  {
    label: "Seeded queue",
    value: "40,000 jobs",
    note: "Every completion scenario starts from the same queue, so only concurrency varies.",
  },
] satisfies KeyValueItem[];

const Page = () => (
  <>
    <p>
      Throughput along two separate axes. When the state adapter varies, notify is a no-op, so only
      the state adapter is measured; when the notify adapter varies, state stays in-process. Each
      chart is one scenario, with the two axes as separate groups on their own scales. A
      deployment's steady-state throughput is bounded by the lower of its creation and completion
      rates.
    </p>
    <StackFilter
      backends={["postgres", "sqlite", "mysql", "mariadb", "redis", "nats", "in-process"]}
    />
    <KeyValueList title="Test setup" items={setup} />
    <h2 id="creation">Creation</h2>
    <p>
      <em>Single</em> is a tight <code>client.createChain</code> loop with one transaction per
      chain, the shape of HTTP-handler traffic. <em>Batched</em> passes 100 chains to{" "}
      <code>client.createChains</code> in one transaction, the shape of a bulk enqueue, and
      amortizes the transaction and the notification over them.
    </p>
    <For each={["Single", "Batched (100)"]}>
      {(scenario, index) => (
        <BenchChart
          title={`Creation, ${scenario.toLowerCase()}`}
          unit="chains/s"
          approximate
          scalePerGroup
          series={[scenario]}
          groups={seriesOf(creationGroups, index())}
        />
      )}
    </For>
    <h2 id="completion">Completion, no-op handler</h2>
    <p>
      One worker drains the seeded queue. Each handler only opens its own transaction and calls{" "}
      <code>complete</code> in it. With one slot, every job's full round trip (acquire, then{" "}
      <code>complete</code> and commit) runs back to back; 4 and 16 slots show how far parallel
      slots scale it.
    </p>
    <p>
      The in-process state adapter keeps its indexes in sorted arrays, so its completion rate falls
      with queue depth. At 40,000 queued jobs that cost, not the worker, bounds every row that uses
      in-process state, including the whole notify axis.
    </p>
    <For each={["1 slot", "4 slots", "16 slots"]}>
      {(scenario, index) => (
        <BenchChart
          title={`Completion, ${scenario}`}
          unit="jobs/s"
          approximate
          scalePerGroup
          series={[scenario]}
          groups={seriesOf(completionGroups, index())}
        />
      )}
    </For>
    <h2 id="reproduce">Reproduce</h2>
    <p>
      From <a href={benchmarkSourceUrl("processing-capacity")}>benchmarks/processing-capacity</a>,
      with Docker running. Each adapter also has its own <code>start:&lt;adapter&gt;</code> script.
    </p>
    <Code lang="bash">{`
      pnpm --filter benchmark-processing-capacity start
      pnpm --filter benchmark-processing-capacity start:state-postgres-pg
    `}</Code>
  </>
);

export default Page;
