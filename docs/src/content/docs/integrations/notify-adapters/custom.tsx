import { A } from "@solidjs/router";

import { Code } from "../../../../components/mdx/Code.tsx";

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
      same suite Queuert uses internally, exposed as a framework-agnostic runner you embed in a
      single <code>test()</code> block. To use another client with PostgreSQL or Redis, write a
      provider instead: see{" "}
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

    <h2 id="conformance">Conformance</h2>
    <p>
      Run <code>runNotifyAdapterConformance</code> from <code>queuert/conformance</code> against
      your adapter. The runner is framework-agnostic: it throws a <code>ConformanceError</code> with
      an aggregated report on failure, so any test runner that reports a thrown error as a failure
      works. Embed it in a single <code>test()</code> block:
    </p>
    <Code lang="ts" title="src/notify-adapter.spec.ts">{`
import { runNotifyAdapterConformance, type NotifyConformanceFixture } from "queuert/conformance";
import { test } from "vitest";

import { createMyNotifyAdapter } from "./notify-adapter.ts";

const createFixture = async (): Promise<NotifyConformanceFixture> => {
  const notifyAdapter = createMyNotifyAdapter({ url: process.env.BROKER_URL });
  return {
    notifyAdapter,
    dispose: async () => notifyAdapter.close(),
  };
};

test("notify adapter passes conformance", async () => {
  await runNotifyAdapterConformance(createFixture);
}, 60_000);
`}</Code>
    <p>
      The factory resolves to a fixture with the <code>notifyAdapter</code> under test, an optional{" "}
      <code>reset</code> that runs before every case, and an optional <code>dispose</code> that runs
      once after all cases finish. For per-case progress, pass <code>{"{ onResult }"}</code> as the
      second argument. The full API is in the{" "}
      <A href="/api/conformance/readme/">conformance reference</A>.
    </p>
    <p>
      A provider for PostgreSQL or Redis has its own runner, which builds the adapter over the
      provider for you: see{" "}
      <A href="/integrations/notify-adapters/postgres/#testing-your-provider">PostgreSQL</A> or{" "}
      <A href="/integrations/notify-adapters/redis/#testing-your-provider">Redis</A>.
    </p>
  </>
);

export default Page;
