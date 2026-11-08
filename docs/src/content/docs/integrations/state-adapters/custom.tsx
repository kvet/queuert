import { A } from "@solidjs/router";

import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";

export const meta = {
  title: "Custom State Adapter",
  description:
    "Implement the StateAdapter interface for another database engine and validate it with the conformance suite.",
};

const fixture = (): FieldItem[] => [
  { name: "stateAdapter", chips: ["required"], description: "The adapter under test, migrated." },
  {
    name: "withNonTransactionContext",
    chips: ["optional"],
    description:
      "Runs a callback with the root handle, not a transaction. Cases that need it are skipped when it is omitted.",
  },
  {
    name: "reset",
    chips: ["optional"],
    description:
      "Runs before every case to restore a clean state, typically by truncating the tables.",
  },
  {
    name: "dispose",
    chips: ["optional"],
    description: "Runs once after all cases finish, pass or fail, to release resources.",
  },
];

const Page = () => (
  <>
    <p>
      For an entirely different database engine, implement the <code>StateAdapter</code> interface
      yourself. The conformance suite validates that your implementation behaves correctly. To use
      another client with PostgreSQL or SQLite, write a provider instead: see{" "}
      <A href="/integrations/state-adapters/postgres/#state-provider">PostgreSQL</A> or{" "}
      <A href="/integrations/state-adapters/sqlite/#state-provider">SQLite</A>, each of which has
      its own conformance runner for providers.
    </p>

    <h2>Write a state adapter</h2>
    <p>
      Implement the <code>StateAdapter</code> type exported from <code>queuert</code>. Its members
      are grouped in{" "}
      <A href="/integrations/state-adapters/#the-stateadapter-interface">
        The StateAdapter interface
      </A>
      , and the rules every implementation follows are in{" "}
      <A href="/integrations/state-adapters/#how-adapters-behave">How adapters behave</A>. The TSDoc
      on each member states its contract.
    </p>

    <h2 id="conformance">Conformance</h2>
    <p>
      <code>queuert/conformance</code> runs the same suite Queuert uses internally against your
      adapter. It has two runners:
    </p>
    <ul>
      <li>
        <code>runStateAdapterConformance</code> runs the cases every state adapter must pass, with
        transactions run one at a time.
      </li>
      <li>
        <code>runConcurrentStateAdapterConformance</code> runs the cases that hold two transactions
        open at once: blocker races, concurrent deletes, row locks, and reads that must not see
        uncommitted rows. Run it next to the first when your adapter can run transactions in
        parallel, such as one over a connection pool.
      </li>
    </ul>
    <p>
      Both are framework-agnostic: they throw a <code>ConformanceError</code> with an aggregated
      report on failure, so any test framework that reports a thrown error as a failure works. Embed
      each in a single <code>test()</code> block:
    </p>
    <Code lang="ts" title="src/state-adapter.spec.ts">{`
import {
  runConcurrentStateAdapterConformance,
  runStateAdapterConformance,
  type StateConformanceFixture,
} from "queuert/conformance";
import { test } from "vitest";

import { createMyStateAdapter } from "./state-adapter.ts";

const createFixture = async (): Promise<StateConformanceFixture> => {
  const stateAdapter = createMyStateAdapter({ connectionString: process.env.DATABASE_URL });
  await stateAdapter.migrateToLatest();
  return {
    stateAdapter,
    reset: async () => stateAdapter.truncate(),
    dispose: async () => stateAdapter.close(),
  };
};

test("state adapter passes conformance", async () => {
  await runStateAdapterConformance(createFixture);
}, 60_000);

test("state adapter passes concurrent transaction conformance", async () => {
  await runConcurrentStateAdapterConformance(createFixture);
}, 60_000);
`}</Code>
    <p>The factory resolves to a fixture:</p>
    <FieldList title="StateConformanceFixture" items={fixture()} />
    <p>
      For per-case progress, pass <code>{"{ onResult }"}</code> as the second argument; for a
      per-case timeout, <code>{"{ caseTimeoutMs }"}</code>. The full API is in the{" "}
      <A href="/api/conformance/readme/">conformance reference</A>.
    </p>
  </>
);

export default Page;
