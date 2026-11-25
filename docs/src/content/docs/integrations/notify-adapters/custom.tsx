import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { siteHref } from "../../../../docs/href.ts";

export const meta = {
  title: "Custom notify adapter",
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
      <a href={siteHref("/integrations/notify-adapters/postgres/#notify-provider")}>PostgreSQL</a>{" "}
      or <a href={siteHref("/integrations/notify-adapters/redis/#notify-provider")}>Redis</a>.
    </p>

    <h2 id="notify-adapter">Write a notify adapter</h2>
    <p>
      Implement the <code>NotifyAdapter</code> type exported from <code>queuert</code>; its members
      and the rules they follow are in{" "}
      <a href={siteHref("/integrations/notify-adapters/#notify-adapter-interface")}>
        The NotifyAdapter interface
      </a>
      .
    </p>
    <p>
      This adapter from{" "}
      <a href="https://github.com/kvet/queuert/tree/main/examples/custom/notify-memory">
        <code>custom/notify-memory</code>
      </a>{" "}
      delivers notifications to listeners in the same process and passes every case:
    </p>
    <ExampleCode example="custom/notify-memory" file="src/notify-adapter.ts" region="adapter" />

    <h2 id="conformance">Conformance</h2>
    <p>
      <code>createNotifyAdapterConformanceCases</code> from <code>queuert/conformance</code> returns
      the cases, ready to run, that check your adapter's own contract (delivery, filtering,
      unsubscribing and concurrent listeners) and run fast.{" "}
      <code>createNotifyAdapterEndToEndConformanceCases</code> returns the cases that check what an
      application sees end to end: each case builds a client and worker runners over your adapter
      and an in-memory state adapter, so no database is needed, and checks worker runners waking up
      for scheduled jobs, <code>awaitChain</code> returning once a chain completes, and recovery
      when the adapter's calls fail. They take a few seconds in all, so you may run them apart from
      the contract cases, such as only in CI.
    </p>
    <p>
      The suite drives no test runner: your test file registers one test per case. Both functions
      take a <code>createNotifyAdapter</code> factory, from which each case creates its own adapter
      and closes it when the case ends, and your adapter's <code>mode</code>: <code>"sync"</code>{" "}
      for an adapter with <code>sync: true</code>, <code>"async"</code> otherwise. The contract
      cases check your adapter's <code>sync</code> marker against it, and the end-to-end cases run
      with an in-memory state adapter of that mode:
    </p>
    <ExampleCode
      example="custom/notify-memory"
      file="src/notify-adapter.spec.ts"
      region="conformance"
    />
    <p>
      The cases share one set of options, so run them one at a time. The full API is in the{" "}
      <a href={siteHref("/api/conformance/readme/")}>conformance reference</a>.
    </p>
    <p>
      For a <code>"sync"</code> <code>NotifyAdapter</code>, register the same cases, with a{" "}
      <code>createNotifyAdapter</code> that may return the sync adapter directly and{" "}
      <code>mode: "sync"</code>. The contract cases call it synchronously, fail when a call returns
      a promise, and still wait for delivery; the end-to-end cases build a client over your adapter
      and an in-memory sync state adapter. Over an async adapter, the contract cases check that the
      calls return promises.
    </p>
    <p>
      A provider for PostgreSQL or Redis has its own cases and a helper that builds the adapter over
      the provider for you: see{" "}
      <a href={siteHref("/integrations/notify-adapters/postgres/#testing-your-provider")}>
        PostgreSQL
      </a>{" "}
      or <a href={siteHref("/integrations/notify-adapters/redis/#testing-your-provider")}>Redis</a>.
    </p>
  </>
);

export default Page;
