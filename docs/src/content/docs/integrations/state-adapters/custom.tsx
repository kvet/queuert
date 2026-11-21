import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";

export const meta = {
  title: "Custom State Adapter",
  description:
    "Implement the StateAdapter interface for another database engine and validate it with the conformance suite.",
};

const contextFields = (): FieldItem[] => [
  {
    name: "mode",
    chips: ["required"],
    description:
      'The adapter\'s mode: "sync" for an adapter with sync: true, "async" otherwise. In "async" the cases also include those that hold a transaction open across an await.',
  },
  {
    name: "concurrent",
    chips: ["optional"],
    description:
      "Whether the adapter runs transactions in parallel, such as one over a connection pool. When true the cases also include those that hold two transactions open at once.",
  },
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
      "Runs a callback with the root handle, not a transaction, so the suite can check getTransaction returns undefined for it.",
  },
  {
    name: "createNotifyAdapter",
    chips: ["optional"],
    description:
      "Creates the notify adapter every client and worker runner of an end-to-end case shares. Without it, each case gets an in-process notify adapter.",
  },
];

const Page = () => (
  <>
    <p>
      For an entirely different database engine, implement the <code>StateAdapter</code> interface
      yourself. The conformance suite validates that your implementation behaves correctly. To use
      another client with PostgreSQL, SQLite or MySQL / MariaDB, write a provider instead: see{" "}
      <A href="/integrations/state-adapters/postgres/#state-provider">PostgreSQL</A>,{" "}
      <A href="/integrations/state-adapters/sqlite/#state-provider">SQLite</A> or{" "}
      <A href="/integrations/state-adapters/mysql/#state-provider">MySQL / MariaDB</A>, each of
      which has its own conformance cases for providers.
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
    <p>
      Your adapter owns the transaction's side effects: <code>onTransactionCommit</code> runs a
      callback after the context's transaction commits, before the call that opened it settles, and{" "}
      <code>onTransactionRollback</code> runs one when the transaction, or the savepoint the context
      belongs to, rolls back, also before the call that opened it settles. The client and the worker
      register every notify and observability event through them. Implement them from your database
      client's transaction events if it has them, or carry <code>TxHooks</code> in your transaction
      context, create them in <code>withTransaction</code> with <code>withTxHooks</code>, and
      register the callbacks on them; see <A href="/guides/tx-hooks/">Tx Hooks</A>.
    </p>
    <p>
      <a href="https://github.com/kvet/queuert/tree/main/examples/custom/state-memory">
        <code>custom/state-memory</code>
      </a>{" "}
      is a complete implementation to start from: it keeps every table in plain in-memory maps, runs
      transactions one at a time on a copy of the state, carries <code>TxHooks</code> in its
      transaction context for <code>onTransactionCommit</code> and{" "}
      <code>onTransactionRollback</code>, and passes the contract and end-to-end cases for an async
      adapter.
    </p>

    <h2 id="conformance">Conformance</h2>
    <p>
      <code>queuert/conformance</code> exports the same cases Queuert uses internally, from two
      functions that return them ready to run against your adapter:
    </p>
    <ul>
      <li>
        <code>createStateAdapterConformanceCases</code> returns the cases that check the contract
        every state adapter must meet, calling the adapter's members directly with transactions run
        one at a time. They run fast.
      </li>
      <li>
        <code>createStateAdapterEndToEndConformanceCases</code> returns the cases that check what an
        application sees end to end: each case builds a client and worker runners over your adapter
        and checks chains, continuations, blockers, scheduling, deduplication, deletion, workerless
        completion, queries, notifications and recovery from errors. They take a few seconds in all,
        so you may run them apart from the contract cases, such as only in CI.
      </li>
    </ul>
    <p>
      With <code>mode: "async"</code> both also include the cases that hold a transaction open
      across an <code>await</code>, which only an async adapter can do. With{" "}
      <code>concurrent: true</code>, for an adapter that can run transactions in parallel such as
      one over a connection pool, they also include the cases that hold two transactions open at
      once: blocker races, concurrent deletes, row locks and reads that must not see uncommitted
      rows, and end-to-end cases such as several blocker chains completing at once, or several
      worker runners on a database that fails.
    </p>
    <p>
      The suite drives no test runner. Your test file sets up the database in its own hooks and
      registers one test per case. Each case creates its own adapter with{" "}
      <code>createStateAdapter</code> and closes it when it ends, so closing an adapter must leave
      the database usable for the next one. Each case has a <code>title</code>, and its{" "}
      <code>run()</code> resolves when the case passes and rejects when it fails. The cases share
      one context, so run them one at a time:
    </p>
    <ExampleCode
      example="custom/state-memory"
      file="src/state-adapter.spec.ts"
      region="conformance"
    />
    <p>Both take the same options:</p>
    <FieldList title="Options" items={contextFields()} />
    <p>
      An adapter over a real database sets it up in <code>beforeAll</code> and releases it in{" "}
      <code>afterAll</code>, or <code>before</code> and <code>after</code> under{" "}
      <code>node:test</code>; the{" "}
      <A href="/integrations/state-adapters/sqlite/#testing-your-provider">SQLite</A> page shows all
      three runners. The full API is in the{" "}
      <A href="/api/conformance/readme/">conformance reference</A>.
    </p>
    <p>
      For a <code>"sync"</code> <code>StateAdapter</code>, pass <code>mode: "sync"</code>, a{" "}
      <code>createStateAdapter</code> that returns the adapter directly and a synchronous{" "}
      <code>withNonTransactionContext</code>. The cases call the adapter's members synchronously,
      the end-to-end ones through a client over it. Every case takes its mode from your adapter's{" "}
      <code>sync</code> marker and checks the adapter calls it makes against it: a sync adapter
      fails a case when a call returns a promise or rejects instead of throwing, and an async one
      when a call returns a plain value. There are no concurrent cases for it: a synchronous
      transaction never overlaps another one on the same thread.
    </p>
  </>
);

export default Page;
