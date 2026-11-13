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
      <code>onTransactionRollback</code> runs one synchronously when the transaction, or the
      savepoint the context belongs to, rolls back. The client and the worker register every notify
      and observability event through them. Implement them from your database client's transaction
      events if it has them, or carry <code>TxHooks</code> in your transaction context, create them
      in <code>withTransaction</code> with <code>withTxHooks</code>, and register the callbacks on
      them; see <A href="/guides/tx-hooks/">Tx Hooks</A>.
    </p>
    <p>
      <A href="/examples/state-adapters/#state-custom-memory">
        <code>state-custom-memory</code>
      </A>{" "}
      is a complete implementation to start from: it keeps every table in plain in-memory maps, runs
      transactions one at a time on a copy of the state, carries <code>TxHooks</code> in its
      transaction context for <code>onTransactionCommit</code> and{" "}
      <code>onTransactionRollback</code>, and passes <code>stateAdapterConformanceCases</code>.
    </p>

    <h2 id="conformance">Conformance</h2>
    <p>
      <code>queuert/conformance</code> exports the same cases Queuert uses internally, as four lists
      to run against your adapter:
    </p>
    <ul>
      <li>
        <code>stateAdapterConformanceCases</code> check the contract every state adapter must meet,
        calling the adapter's members directly with transactions run one at a time. They run fast.
      </li>
      <li>
        <code>concurrentStateAdapterConformanceCases</code> hold two transactions open at once:
        blocker races, concurrent deletes, row locks, and reads that must not see uncommitted rows.
      </li>
      <li>
        <code>stateAdapterEndToEndConformanceCases</code> check what an application sees end to end:
        each case builds a client and worker runners over your adapter and checks chains,
        continuations, blockers, scheduling, deduplication, deletion, workerless completion,
        queries, notifications and recovery from errors. They take a few seconds in all, so you may
        run them apart from the contract cases, such as only in CI.
      </li>
      <li>
        <code>concurrentStateAdapterEndToEndConformanceCases</code> are end-to-end cases that need
        transactions running in parallel, such as several blocker chains completing at once, or
        several worker runners on a database that fails.
      </li>
    </ul>
    <p>
      Run the two concurrent lists as well when your adapter can run transactions in parallel, such
      as one over a connection pool.
    </p>
    <p>
      The suite drives no test runner. Your test file sets up the database in its own hooks and
      registers one test per case. Each case creates its own adapter with the context's{" "}
      <code>createStateAdapter</code> and closes it when it ends, so closing an adapter must leave
      the database usable for the next one. Each case has a <code>title</code>, and its{" "}
      <code>run(context)</code> resolves when the case passes and rejects when it fails. The cases
      share one context, so run them one at a time:
    </p>
    <ExampleCode
      example="state-custom-memory"
      file="src/state-adapter.spec.ts"
      region="conformance"
    />
    <p>The context holds:</p>
    <FieldList title="StateAdapterConformanceContext" items={contextFields()} />
    <p>
      An adapter over a real database sets it up in <code>beforeAll</code> and releases it in{" "}
      <code>afterAll</code>, or <code>before</code> and <code>after</code> under{" "}
      <code>node:test</code>; the{" "}
      <A href="/integrations/state-adapters/sqlite/#testing-your-provider">SQLite</A> page shows all
      three runners. The full API is in the{" "}
      <A href="/api/conformance/readme/">conformance reference</A>.
    </p>
    <p>
      For a <code>SyncStateAdapter</code>, register the{" "}
      <code>syncStateAdapterConformanceCases</code> and{" "}
      <code>syncStateAdapterEndToEndConformanceCases</code> instead. They call the adapter's members
      synchronously, the end-to-end ones through a client over it, and leave out the cases that hold
      a transaction open across an <code>await</code>. They run against the same{" "}
      <code>StateAdapterConformanceContext</code>, with a <code>createStateAdapter</code> that
      returns the adapter directly and a synchronous <code>withNonTransactionContext</code>. Every
      case takes its mode from your adapter's <code>sync</code> marker and checks the adapter calls
      it makes against it: a sync adapter fails a case when a call returns a promise or rejects
      instead of throwing, and an async one when a call returns a plain value. There are no
      concurrent cases for it: a synchronous transaction never overlaps another one on the same
      thread.
    </p>
  </>
);

export default Page;
