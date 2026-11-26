import { For } from "solid-js";

import { BenchChart } from "../../../components/BenchChart.tsx";
import { type KeyValueItem, KeyValueList } from "../../../components/KeyValueList.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import { Details } from "../../../components/mdx/Details.tsx";
import { StackFilter } from "../../../components/StackFilter.tsx";
import {
  batchedCompletionGroups,
  benchmarkEnvironment,
  benchmarkServers,
  benchmarkSourceUrl,
  completionGroups,
  creationGroups,
  seriesOf,
} from "../../../data/benchmarks.ts";
import { siteHref } from "../../../docs/href.ts";

export const meta = {
  title: "Processing capacity",
  description: "Chain creation and job completion throughput for every state and notify adapter.",
};

const setup = [
  ...benchmarkEnvironment("processing-capacity"),
  benchmarkServers,
  {
    label: "Window",
    value: "2 s per scenario",
    note: "Each scenario runs in its own child process, so a slow adapter costs the same wall time as a fast one.",
  },
  {
    label: "Seeded queue",
    value: "40,000 jobs",
    note: "Every completion scenario starts from the same queue, so only concurrency varies. A run that drains it early is timed from its first job to its last.",
  },
] satisfies KeyValueItem[];

const Page = () => (
  <>
    <p>Bars use a log scale, so slower adapters stay visible next to in-process ones.</p>
    <Details summary="How to read these charts" hint="4 notes">
      <ul>
        <li>
          When the state adapter varies, notify is a no-op; when the notify adapter varies, state
          stays in-process. Each chart holds the two as separate groups, each on its own scale.
        </li>
        <li>
          The SQLite rows run the synchronous adapter, a <code>SqliteStateAdapter</code> in the{" "}
          <code>"sync"</code> mode, and the In-process rows run the in-process adapters
          synchronously.
        </li>
        <li>
          IPC, a synchronous notify adapter, runs over the synchronous in-process state adapter,
          while the other notify adapters run over the asynchronous one, so compare IPC with the
          In-process row rather than with them.
        </li>
        <li>
          A deployment's steady-state throughput is bounded by the lower of its creation and
          completion rates.
        </li>
      </ul>
    </Details>
    <StackFilter
      backends={["postgres", "sqlite", "mysql", "mariadb", "redis", "nats", "ipc", "in-process"]}
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
          logScale
          series={[scenario]}
          groups={seriesOf(creationGroups, index())}
        />
      )}
    </For>
    <h2 id="completion">Completion, no-op handler</h2>
    <p>
      One worker drains the seeded queue. Each handler only opens its own transaction and calls{" "}
      <code>applyJobOutcome</code> in it. With one slot, every job's full round trip (acquire, then{" "}
      <code>applyJobOutcome</code> and commit) runs back to back; 4 and 16 slots show how far
      parallel slots scale it.
    </p>
    <For each={["1 slot", "4 slots", "16 slots"]}>
      {(scenario, index) => (
        <BenchChart
          title={`Completion, ${scenario}`}
          unit="jobs/s"
          approximate
          scalePerGroup
          logScale
          series={[scenario]}
          groups={seriesOf(completionGroups, index())}
        />
      )}
    </For>
    <h2 id="batched-completion">Completion, batched no-op handler</h2>
    <p>
      The same seeded queue, drained by a processor with <code>batchLimit: 100</code>: each attempt
      takes up to 100 jobs and applies them with one <code>applyJobOutcomes</code> call in one
      transaction, so the round trip is paid per batch instead of per job. See{" "}
      <a href={siteHref("/guides/batched-processors/")}>Batched processors</a>.
    </p>
    <For each={["1 slot", "4 slots", "16 slots"]}>
      {(scenario, index) => (
        <BenchChart
          title={`Batched completion, ${scenario}`}
          unit="jobs/s"
          approximate
          scalePerGroup
          logScale
          series={[scenario]}
          groups={seriesOf(batchedCompletionGroups, index())}
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
