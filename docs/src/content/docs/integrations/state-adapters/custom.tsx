import { A } from "@solidjs/router";

import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";

export const meta = {
  title: "Custom State Adapter",
  description:
    "Implement the StateAdapter interface for another database engine and validate it with the conformance suite.",
};

const contextFields = (): FieldItem[] => [
  {
    name: "createStateAdapter",
    chips: ["required"],
    description:
      "Creates an adapter over a clean state, with no jobs, blockers or workers. Each case calls it once and closes the adapter when it ends.",
  },
  {
    name: "withNonTransactionContext",
    chips: ["required"],
    description:
      "Runs a callback with the root handle, not a transaction, so the suite can check isTransaction rejects it.",
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
      its own conformance cases for providers.
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
      <code>queuert/conformance</code> exports the same cases Queuert uses internally, as two lists
      to run against your adapter:
    </p>
    <ul>
      <li>
        <code>stateAdapterConformanceCases</code> are the cases every state adapter must pass, with
        transactions run one at a time.
      </li>
      <li>
        <code>concurrentStateAdapterConformanceCases</code> hold two transactions open at once:
        blocker races, concurrent deletes, row locks, and reads that must not see uncommitted rows.
        Run them next to the first when your adapter can run transactions in parallel, such as one
        over a connection pool.
      </li>
    </ul>
    <p>
      The suite drives no test runner. Your test file sets up the database in its own hooks and
      registers one test per case. Each case creates its own adapter with the context's{" "}
      <code>createStateAdapter</code> and closes it when it ends, so closing an adapter must leave
      the database usable for the next one. Each case has a <code>title</code>, and its{" "}
      <code>run(context)</code> resolves when the case passes and rejects when it fails. The cases
      share one database, so run them one at a time:
    </p>
    <Code lang="ts" title="src/state-adapter.spec.ts">{`
import {
  concurrentStateAdapterConformanceCases,
  stateAdapterConformanceCases,
  type StateAdapterConformanceContext,
} from "queuert/conformance";
import { afterAll, beforeAll, describe, test } from "vitest";

import { clearTables, createMyStateAdapter, openMyDatabase } from "./state-adapter.ts";

describe("state adapter conformance", () => {
  const db = openMyDatabase(process.env.DATABASE_URL);

  beforeAll(async () => {
    await createMyStateAdapter({ db }).migrateToLatest();
  });

  afterAll(async () => {
    await db.close();
  });

  const context: StateAdapterConformanceContext = {
    createStateAdapter: async () => {
      await clearTables(db);
      return createMyStateAdapter({ db });
    },
    withNonTransactionContext: async (fn) => fn({ db }),
  };

  for (const conformanceCase of [
    ...stateAdapterConformanceCases,
    ...concurrentStateAdapterConformanceCases,
  ]) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
`}</Code>
    <p>The context holds:</p>
    <FieldList title="StateAdapterConformanceContext" items={contextFields()} />
    <p>
      Under <code>node:test</code>, register the hooks with <code>before</code> and{" "}
      <code>after</code>. The{" "}
      <A href="/integrations/state-adapters/sqlite/#testing-your-provider">SQLite</A> page shows all
      three runners. The full API is in the{" "}
      <A href="/api/conformance/readme/">conformance reference</A>.
    </p>
  </>
);

export default Page;
