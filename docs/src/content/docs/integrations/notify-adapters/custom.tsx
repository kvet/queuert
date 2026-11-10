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
      same suite Queuert uses internally, exported as a list of cases you register one test per case
      with any test runner. To use another client with PostgreSQL or Redis, write a provider
      instead: see <A href="/integrations/notify-adapters/postgres/#notify-provider">PostgreSQL</A>{" "}
      or <A href="/integrations/notify-adapters/redis/#notify-provider">Redis</A>.
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
      <code>notifyAdapterConformanceCases</code> from <code>queuert/conformance</code> are the cases
      a notify adapter must pass. The suite drives no test runner: your test file registers one test
      per case, running each against a context with a <code>createNotifyAdapter</code> factory. Each
      case creates its own adapter from it and closes it when the case ends:
    </p>
    <Code lang="ts" title="src/notify-adapter.spec.ts">{`
import {
  notifyAdapterConformanceCases,
  type NotifyAdapterConformanceContext,
} from "queuert/conformance";
import { describe, test } from "vitest";

import { createMyNotifyAdapter } from "./notify-adapter.ts";

describe("notify adapter conformance", () => {
  const context: NotifyAdapterConformanceContext = {
    createNotifyAdapter: async () => createMyNotifyAdapter({ url: process.env.BROKER_URL }),
  };

  for (const conformanceCase of notifyAdapterConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
`}</Code>
    <p>
      The cases share one context, so run them one at a time. The full API is in the{" "}
      <A href="/api/conformance/readme/">conformance reference</A>.
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
