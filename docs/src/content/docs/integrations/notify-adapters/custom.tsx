import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";

export const meta = {
  title: "Custom Notify Adapter",
  description:
    "Implement the NotifyAdapter interface for another message broker and validate it with Queuert's conformance suite.",
};

const Page = () => (
  <>
    <p>
      For an entirely different message broker, implement the <code>NotifyAdapter</code> interface
      yourself. The conformance suite validates that your implementation behaves correctly. It's the
      same suite Queuert uses internally, exported as lists of cases to register one test each with
      any test runner. To use another client with PostgreSQL or Redis, write a provider instead: see{" "}
      <A href="/integrations/notify-adapters/postgres/#notify-provider">PostgreSQL</A> or{" "}
      <A href="/integrations/notify-adapters/redis/#notify-provider">Redis</A>.
    </p>

    <h2 id="notify-adapter">Write a notify adapter</h2>
    <p>
      Implement the <code>NotifyAdapter</code> type exported from <code>queuert</code>; its members
      and the rules they follow are in{" "}
      <A href="/integrations/notify-adapters/#notify-adapter-interface">
        The NotifyAdapter interface
      </A>
      .
    </p>
    <p>
      This adapter from{" "}
      <A href="/examples/notify-adapters/#notify-custom-memory">
        <code>notify-custom-memory</code>
      </A>{" "}
      delivers notifications to listeners in the same process and passes every case:
    </p>
    <ExampleCode example="notify-custom-memory" file="src/notify-adapter.ts" region="adapter" />

    <h2 id="conformance">Conformance</h2>
    <p>
      <code>notifyAdapterConformanceCases</code> from <code>queuert/conformance</code> check your
      adapter's own contract (delivery, filtering, unsubscribing and concurrent listeners) and run
      fast. <code>notifyAdapterEndToEndConformanceCases</code> check what an application sees end to
      end: each case builds a client and worker runners over your adapter and an in-memory state
      adapter, so no database is needed, and checks worker runners waking up for scheduled jobs,{" "}
      <code>awaitChain</code> returning once a chain completes, and recovery when the adapter's
      calls fail. They take a few seconds in all, so you may run them apart from the contract cases,
      such as only in CI.
    </p>
    <p>
      The suite drives no test runner: your test file registers one test per case, running each
      against a context with a <code>createNotifyAdapter</code> factory. Each case creates its own
      adapter from it and closes it when the case ends:
    </p>
    <ExampleCode
      example="notify-custom-memory"
      file="src/notify-adapter.spec.ts"
      region="conformance"
    />
    <p>
      The cases share one context, so run them one at a time. The full API is in the{" "}
      <A href="/api/conformance/readme/">conformance reference</A>.
    </p>
    <p>
      For a <code>SyncNotifyAdapter</code>, register the{" "}
      <code>syncNotifyAdapterConformanceCases</code> and{" "}
      <code>syncNotifyAdapterEndToEndConformanceCases</code> instead, against the same{" "}
      <code>NotifyAdapterConformanceContext</code>, whose <code>createNotifyAdapter</code> may
      return the sync adapter directly. The contract cases call it synchronously, fail when a call
      returns a promise, and still wait for delivery; the end-to-end cases build a client over your
      adapter and an in-memory sync state adapter. Every case takes its mode from your adapter's{" "}
      <code>sync</code> marker, so over an async adapter it checks that the calls return promises.
    </p>
    <p>
      A provider for PostgreSQL or Redis has its own cases and a helper that builds the adapter over
      the provider for you: see{" "}
      <A href="/integrations/notify-adapters/postgres/#testing-your-provider">PostgreSQL</A> or{" "}
      <A href="/integrations/notify-adapters/redis/#testing-your-provider">Redis</A>.
    </p>
  </>
);

export default Page;
