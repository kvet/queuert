import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList } from "../../../../components/FieldList.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";

export const meta = {
  title: "Redis Notify Adapter",
  description:
    "Wake workers with Redis pub/sub on standalone Redis or Redis Cluster: node-redis, ioredis and Bun.",
};

const Page = () => (
  <>
    <p>
      <code>createRedisNotifyAdapter</code> uses Redis pub/sub for broadcasting job notifications to
      workers, publishing each batch from one Lua script. Recommended for production. Redis is used
      exclusively as a notification adapter — it does not store job state; job storage is handled by
      a separate <A href="/integrations/state-adapters/">state adapter</A>.
    </p>

    <h2 id="install">Install</h2>
    <Code lang="bash">{`npm install @queuert/redis`}</Code>
    <p>Requires Redis 6 or later, standalone or Redis Cluster.</p>

    <h2 id="setup">Setup</h2>
    <p>Each example's notify provider and adapter:</p>
    <Tabs syncKey="redis-driver">
      <TabItem label="node-redis">
        <ExampleCode example="notify-redis-redis" file="src/provider.ts" />
        <ExampleCode example="notify-redis-redis" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="ioredis">
        <ExampleCode example="notify-redis-ioredis" file="src/provider.ts" />
        <ExampleCode example="notify-redis-ioredis" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="Bun" badge="Bun">
        <ExampleCode example="notify-redis-bun" file="src/provider.ts" />
        <ExampleCode example="notify-redis-bun" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="node-redis cluster">
        <ExampleCode example="notify-redis-cluster-node-redis" file="src/provider.ts" />
        <ExampleCode example="notify-redis-cluster-node-redis" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="ioredis cluster">
        <ExampleCode example="notify-redis-cluster-ioredis" file="src/provider.ts" />
        <ExampleCode example="notify-redis-cluster-ioredis" file="src/index.ts" region="setup" />
      </TabItem>
    </Tabs>
    <p>
      Close the adapters, then your own clients, in the{" "}
      <A href="/integrations/notify-adapters/#how-adapters-behave">shutdown order</A>:
    </p>
    <Tabs syncKey="redis-driver">
      <TabItem label="node-redis">
        <ExampleCode example="notify-redis-redis" file="src/index.ts" region="cleanup" />
      </TabItem>
      <TabItem label="ioredis">
        <ExampleCode example="notify-redis-ioredis" file="src/index.ts" region="cleanup" />
      </TabItem>
      <TabItem label="Bun" badge="Bun">
        <ExampleCode example="notify-redis-bun" file="src/index.ts" region="cleanup" />
      </TabItem>
      <TabItem label="node-redis cluster">
        <ExampleCode
          example="notify-redis-cluster-node-redis"
          file="src/index.ts"
          region="cleanup"
        />
      </TabItem>
      <TabItem label="ioredis cluster">
        <ExampleCode example="notify-redis-cluster-ioredis" file="src/index.ts" region="cleanup" />
      </TabItem>
    </Tabs>

    <h2 id="configuration">Configuration</h2>
    <FieldList
      title="createRedisNotifyAdapter options"
      idPrefix="option"
      items={[
        {
          name: "notifyProvider",
          chips: ["required"],
          meta: "RedisNotifyProvider",
          description: (
            <>
              See <a href="#notify-provider">Notify provider</a>.
            </>
          ),
        },
        {
          name: "channelPrefix",
          meta: 'string · default "queuert"',
          description: "Prefix for the three channel names.",
        },
      ]}
    />

    <h2 id="notify-provider">Notify provider</h2>
    <p>
      A <code>RedisNotifyProvider</code> bridges your Redis client with the adapter. Each Setup tab
      is a complete provider for its client; to use another one, implement the same members:
    </p>
    <FieldList
      title="RedisNotifyProvider"
      idPrefix="provider"
      items={[
        {
          name: "eval",
          description:
            "Runs a Lua script; the adapter publishes each batch of notifications from one script.",
        },
        {
          name: "subscribe",
          description:
            "Listens on a channel and invokes a callback when messages arrive. Returns a dispose function to unsubscribe.",
        },
        {
          name: "close",
          chips: ["optional"],
          description:
            "Only needed when the provider owns resources. notifyAdapter.close() invokes it.",
        },
      ]}
    />

    <h2 id="conformance">Conformance</h2>
    <p>
      Every example's <code>src/provider.spec.ts</code> runs{" "}
      <code>runNotifyAdapterConformance</code> and is a working template. To run it under another
      test runner, see{" "}
      <A href="/integrations/notify-adapters/custom/#conformance">Custom Notify Adapter</A>.
    </p>
    <Tabs syncKey="redis-driver">
      <TabItem label="node-redis">
        <ExampleCode
          example="notify-redis-redis"
          file="src/provider.spec.ts"
          region="conformance"
        />
      </TabItem>
      <TabItem label="ioredis">
        <ExampleCode
          example="notify-redis-ioredis"
          file="src/provider.spec.ts"
          region="conformance"
        />
      </TabItem>
      <TabItem label="Bun" badge="Bun">
        <ExampleCode example="notify-redis-bun" file="src/provider.spec.ts" region="conformance" />
      </TabItem>
      <TabItem label="node-redis cluster">
        <ExampleCode
          example="notify-redis-cluster-node-redis"
          file="src/provider.spec.ts"
          region="conformance"
        />
      </TabItem>
      <TabItem label="ioredis cluster">
        <ExampleCode
          example="notify-redis-cluster-ioredis"
          file="src/provider.spec.ts"
          region="conformance"
        />
      </TabItem>
    </Tabs>

    <h2 id="channels">Channels</h2>
    <p>
      Three channels carry notifications between processes (configurable prefix, default{" "}
      <code>queuert</code>). Channels use Redis Pub/Sub — messages are fire-and-forget with no
      persistence. If no subscriber is listening when a message is published, it is lost. This is
      acceptable because workers fall back to polling when notifications are missed.
    </p>
    <FieldList
      items={[
        {
          name: "{prefix}:sched",
          chips: ["job scheduled"],
          meta: "payload · job type name",
          description: "Published when jobs become pending. Wakes idle workers.",
        },
        {
          name: "{prefix}:chainc",
          chips: ["chain completed"],
          meta: "payload · chain id",
          description: "Published when a chain completes. Wakes clients awaiting results.",
        },
        {
          name: "{prefix}:atls",
          chips: ["attempt lost"],
          meta: "payload · job id",
          description: "Published when a running job's attempt is lost. Notifies attempt loss.",
        },
      ]}
    />

    <h2 id="connection-model">Connection model</h2>
    <p>
      Redis Pub/Sub requires two separate connections. The <code>RedisNotifyProvider</code>{" "}
      interface abstracts this — you manage the two connections in your provider implementation.
    </p>
    <FieldList
      proseNames
      items={[
        {
          name: "Command connection",
          description:
            "Runs EVAL for the publish script, which issues the PUBLISH calls. It cannot be in subscribe mode.",
        },
        {
          name: "Subscription connection",
          description:
            "Runs SUBSCRIBE and UNSUBSCRIBE. In subscribe mode it cannot execute regular commands.",
        },
      ]}
    />

    <h2 id="examples">Examples</h2>
    <ExampleRows
      title="@queuert/redis"
      names={[
        "notify-redis-redis",
        "notify-redis-ioredis",
        "notify-redis-bun",
        "notify-redis-cluster-node-redis",
        "notify-redis-cluster-ioredis",
      ]}
    />
  </>
);

export default Page;
