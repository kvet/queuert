import { For } from "solid-js";

import { BenchChart } from "../../../components/BenchChart.tsx";
import { type FieldItem, FieldList } from "../../../components/FieldList.tsx";
import { type KeyValueItem, KeyValueList } from "../../../components/KeyValueList.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import {
  benchmarkMachine,
  benchmarkSourceUrl,
  instantiationGroups,
  seriesOf,
  typeGroups,
} from "../../../data/benchmarks.ts";

export const meta = {
  title: "Type Complexity",
  description:
    "TypeScript type-checking cost of job type definitions across chain shapes and sizes.",
};

const families = [
  { name: "Linear", description: "Straight continueWith chains of 1 to 100 job types." },
  { name: "Branched", description: "Tree-shaped chains of varying width and depth." },
  {
    name: "Blockers",
    description: "Chains with up to three cross-chain blocker dependencies per step.",
  },
  {
    name: "Loop",
    description: "Chains where every step can continue back to itself through a union.",
  },
  {
    name: "Merge",
    description: "Slices of 50 job types merged into one client, up to 2,500 types.",
  },
  {
    name: "Middleware",
    description: "The 100-type linear chain with up to 10 attempt middleware.",
  },
] satisfies FieldItem[];

const compilers = ["TS 6", "TS 7", "tsrs"];

const setup = [
  ...benchmarkMachine,
  {
    label: "Compilers",
    value: "TypeScript 6.0.2, TypeScript 7.0.2 and tsrs 0.20.1",
    note: "The last JavaScript-based tsc, the native compiler, and an experimental Rust port of the TypeScript 7.1 beta checker.",
  },
  { label: "Runs", value: "3 per scenario", note: "The best time counts." },
] satisfies KeyValueItem[];

const Page = () => (
  <>
    <p>
      Each scenario is generated as its own project and type-checked against Queuert's prebuilt{" "}
      <code>.d.mts</code> declarations. Every scenario carries one attempt middleware, so the
      baseline is a realistic client.
    </p>
    <KeyValueList title="Test setup" items={setup} />
    <FieldList title="Scenario families" items={families} proseNames />
    <h2 id="results">Results</h2>
    <p>
      Beyond a fixed baseline, cost grows roughly linearly with the number of job types whatever the
      chain's shape.
    </p>
    <For each={compilers}>
      {(compiler, index) => (
        <BenchChart
          title={`Type-check time, ${compiler}`}
          unit="ms"
          approximate
          series={[compiler]}
          groups={seriesOf(typeGroups, index())}
        />
      )}
    </For>
    <p>
      The TypeScript 7 instantiation count of each scenario, with its job type count and the scaling
      against the one-type baseline.
    </p>
    <BenchChart
      title="Instantiations, TS 7"
      unit="instantiations"
      series={["Instantiations"]}
      groups={instantiationGroups}
    />
    <h2 id="reproduce">Reproduce</h2>
    <p>
      From <a href={benchmarkSourceUrl("type-complexity")}>benchmarks/type-complexity</a>. The
      generated scenarios stay in <code>generated/</code> for inspection.
    </p>
    <Code lang="bash">{`
      pnpm --filter benchmark-type-complexity start
      pnpm --filter benchmark-type-complexity start:ts7
      pnpm --filter benchmark-type-complexity start:tsrs
    `}</Code>
  </>
);

export default Page;
