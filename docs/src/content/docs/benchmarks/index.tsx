import { For } from "solid-js";

import { KeyValueList } from "../../../components/KeyValueList.tsx";
import { CardGrid, LinkCard } from "../../../components/mdx/Cards.tsx";
import {
  benchmarkContainers,
  benchmarkServers,
  benchmarkMachine,
} from "../../../data/benchmarks.ts";
import { pageHref, sectionGroups } from "../../../docs/pages.ts";
import { sectionById } from "../../../docs/sections.ts";

export const meta = {
  title: "Benchmarks",
  description:
    "Throughput, query latency, type-checking cost, memory and CPU, measured by the suites in the repository.",
};

const suites = () =>
  sectionGroups(sectionById("benchmarks")).find((group) => group.label === "Suites")?.pages ?? [];

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
    <h2 id="suites">Suites</h2>
    <CardGrid>
      <For each={suites()}>
        {(suite) => (
          <LinkCard
            title={suite.title}
            href={`/queuert${pageHref(suite)}`}
            description={suite.description ?? undefined}
          />
        )}
      </For>
    </CardGrid>
    <h2 id="environment">Environment</h2>
    <p>
      Every suite ran on the same machine. Each suite page lists its own method and the command that
      reproduces it.
    </p>
    <KeyValueList
      title="Test setup"
      items={[...benchmarkMachine, benchmarkContainers, benchmarkServers]}
    />
  </>
);

export default Page;
