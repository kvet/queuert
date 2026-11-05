import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";

export const meta = {
  title: "Custom State Adapter",
  description:
    "Implement the StateAdapter interface for another database engine and validate it with the conformance suite.",
};

const fixture = (): FieldItem[] => [
  { name: "stateAdapter", chips: ["required"], description: "The adapter under test." },
  {
    name: "transactionConcurrency",
    chips: ["required"],
    description: (
      <>
        <code>"concurrent"</code> when your backend can run two <code>withTransaction</code>{" "}
        callbacks at once (a connection pool), so the suite also exercises concurrent-transaction
        cases; <code>"serialized"</code> for a single-connection backend, which skips them.
      </>
    ),
  },
  {
    name: "withNonTransactionContext",
    chips: ["optional"],
    description:
      "Runs a callback with the root handle, not a transaction. Cases that need it are skipped when it is omitted.",
  },
  { name: "reset", chips: ["optional"], description: "Truncates the tables between cases." },
  { name: "dispose", chips: ["optional"], description: "Closes connections." },
];

const Page = () => (
  <>
    <p>
      For an entirely different database engine, implement the <code>StateAdapter</code> interface
      yourself. The conformance suite validates that your implementation behaves correctly. To use
      another client with PostgreSQL or SQLite, write a provider instead: see{" "}
      <A href="/integrations/state-adapters/postgres/#state-provider">PostgreSQL</A> or{" "}
      <A href="/integrations/state-adapters/sqlite/#state-provider">SQLite</A>.
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

    <h2>Conformance</h2>
    <p>
      <code>runStateAdapterConformance</code> from <code>queuert/conformance</code> runs the same
      suite Queuert uses internally against your adapter, and every backend example runs it against
      its provider. It is framework-agnostic: it throws on failure, so any test framework that
      reports a thrown error as a failure works. Embed it in a single <code>test()</code> block:
    </p>
    <Tabs syncKey="test-runner">
      <TabItem label="vitest">
        <ExampleCode
          example="state-sqlite-better-sqlite3"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="bun test">
        <ExampleCode
          example="state-sqlite-bun-sqlite"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="node:test">
        <ExampleCode
          example="state-sqlite-node-sqlite"
          file="src/provider.node-test.ts"
          region="conformance"
          title="src/provider.node-test.ts"
        />
      </TabItem>
    </Tabs>
    <p>The factory resolves to a fixture:</p>
    <FieldList title="StateConformanceFixture" items={fixture()} />
    <p>
      For per-case progress, pass <code>{"{ onResult }"}</code> as the second argument, as the
      node:test tab does. The full API is in the{" "}
      <A href="/api/conformance/readme/">conformance reference</A>.
    </p>
  </>
);

export default Page;
