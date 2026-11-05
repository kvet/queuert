import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";

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
      your adapter. The runner is framework-agnostic — it throws on failure, so any test runner that
      reports a thrown error as a failure works. Every notify example's spec (
      <code>src/provider.spec.ts</code>, or <code>src/adapter.spec.ts</code> for NATS) is a working
      template:
    </p>
    <Tabs syncKey="test-runner">
      <TabItem label="vitest">
        <ExampleCode example="notify-postgres-pg" file="src/provider.spec.ts" />
      </TabItem>
      <TabItem label="bun test">
        <ExampleCode example="notify-redis-bun" file="src/provider.spec.ts" />
      </TabItem>
    </Tabs>
  </>
);

export default Page;
