import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList } from "../../../../components/FieldList.tsx";
import { ExperimentalAside } from "../../../../components/integrations/ExperimentalAside.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";

export const meta = {
  title: "NATS Notify Adapter",
  description: "Wake workers with NATS core pub/sub over a single NatsConnection.",
};

const Page = () => (
  <>
    <p>
      <code>createNatsNotifyAdapter</code> uses NATS core pub/sub for job notifications. Like Redis,
      NATS is used exclusively as a notification adapter — it does not store job state; that stays
      in your <A href="/integrations/state-adapters/">state adapter</A>.
    </p>
    <ExperimentalAside package="@queuert/nats" />

    <h2 id="install">Install</h2>
    <Code lang="bash">{`npm install @queuert/nats @nats-io/nats-core @nats-io/transport-node`}</Code>
    <p>Requires NATS 2.2 or later.</p>

    <h2 id="setup">Setup</h2>
    <ExampleCode example="notify-nats-transport-node" file="src/index.ts" region="setup" />
    <p>
      Close the adapters, then your own clients, in the{" "}
      <A href="/integrations/notify-adapters/#how-adapters-behave">shutdown order</A>:
    </p>
    <ExampleCode example="notify-nats-transport-node" file="src/index.ts" region="cleanup" />

    <h2 id="configuration">Configuration</h2>
    <FieldList
      title="createNatsNotifyAdapter options"
      idPrefix="option"
      items={[
        {
          name: "nc",
          chips: ["required"],
          meta: "NatsConnection",
          description: "Used for both publishing and subscribing.",
        },
        {
          name: "subjectPrefix",
          meta: 'string · default "queuert"',
          description: "Prefix for the three subject names.",
        },
      ]}
    />

    <h2 id="conformance">Conformance</h2>
    <p>
      The example's <code>src/adapter.spec.ts</code> runs <code>runNotifyAdapterConformance</code>{" "}
      and is a working template. To run it under another test runner, see{" "}
      <A href="/integrations/notify-adapters/custom/#conformance">Custom Notify Adapter</A>.
    </p>
    <ExampleCode
      example="notify-nats-transport-node"
      file="src/adapter.spec.ts"
      region="conformance"
    />

    <h2 id="subjects">Subjects</h2>
    <p>
      Three NATS subjects carry notifications (configurable prefix, default <code>queuert</code>):
    </p>
    <FieldList
      items={[
        {
          name: "{prefix}.sched",
          chips: ["job scheduled"],
          meta: "payload · job type name",
          description: "Published when jobs become pending. Wakes idle workers.",
        },
        {
          name: "{prefix}.chainc",
          chips: ["chain completed"],
          meta: "payload · chain id",
          description: "Published when a chain completes. Wakes clients awaiting results.",
        },
        {
          name: "{prefix}.atls",
          chips: ["attempt lost"],
          meta: "payload · job id",
          description: "Published when a running job's attempt is lost. Notifies attempt loss.",
        },
      ]}
    />
    <p>
      NATS core pub/sub is fire-and-forget — messages are delivered to currently connected
      subscribers only.
    </p>

    <h2 id="connection-model">Connection model</h2>
    <p>
      NATS uses a single connection (<code>NatsConnection</code>) for both publishing and
      subscribing — unlike Redis, there is no need for separate connections. The adapter accepts the
      connection directly.
    </p>

    <h2 id="examples">Examples</h2>
    <ExampleRows title="@queuert/nats" names={["notify-nats-transport-node"]} />
  </>
);

export default Page;
