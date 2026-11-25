import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList } from "../../../../components/FieldList.tsx";
import { AtAGlance } from "../../../../components/integrations/AtAGlance.tsx";
import { CappedCode } from "../../../../components/integrations/CappedCode.tsx";
import { ClientTiles } from "../../../../components/integrations/ClientTiles.tsx";
import { FoldGroup } from "../../../../components/integrations/FoldGroup.tsx";
import { RunOnYourMachine } from "../../../../components/integrations/RunOnYourMachine.tsx";
import { Details } from "../../../../components/mdx/Details.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";
import { siteHref } from "../../../../docs/href.ts";

export const meta = {
  title: "Redis notify adapter",
  description:
    "Wake workers with Redis pub/sub on standalone Redis or Redis Cluster: node-redis, ioredis and Bun.",
};

const Page = () => (
  <>
    <p>
      <code>createRedisNotifyAdapter</code> uses Redis pub/sub for broadcasting job notifications to
      workers, publishing each batch from one Lua script. The notify adapter stores no job state;
      job storage is handled by a separate{" "}
      <a href={siteHref("/integrations/state-adapters/")}>state adapter</a>, which can also be the
      experimental <a href={siteHref("/integrations/state-adapters/redis/")}>Redis state adapter</a>
      .
    </p>

    <AtAGlance
      package="@queuert/redis"
      clients="node-redis, ioredis, Bun; standalone or Redis Cluster"
      isolationLabel="Delivery"
      isolation="Redis pub/sub, one Lua script per batch"
      pairsWith={[
        { label: "PostgreSQL state adapter", href: "/integrations/state-adapters/postgres/" },
        { label: "MySQL / MariaDB state adapter", href: "/integrations/state-adapters/mysql/" },
        { label: "Redis state adapter", href: "/integrations/state-adapters/redis/" },
      ]}
    />

    <h2>Quick start</h2>
    <ClientTiles
      adapterPackage="@queuert/redis"
      syncKey="redis-driver"
      anchor="quick-start"
      groups={[
        {
          label: "Clients",
          items: [
            { name: "node-redis", tab: "node-redis", packages: "redis" },
            { name: "ioredis", tab: "ioredis", packages: "ioredis" },
            { name: "Bun", tab: "Bun", packages: "built into Bun", badge: "Bun" },
          ],
        },
        {
          label: "Redis Cluster",
          items: [
            { name: "node-redis cluster", tab: "node-redis cluster", packages: "redis" },
            { name: "ioredis cluster", tab: "ioredis cluster", packages: "ioredis" },
          ],
        },
      ]}
    />
    <p>Requires Redis 6 or later, standalone or Redis Cluster.</p>
    <p>Each example's notify provider and adapter:</p>
    <Tabs syncKey="redis-driver" pickedElsewhere>
      <TabItem label="node-redis">
        <CappedCode>
          <ExampleCode example="postgresql/notify-redis-redis" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode example="postgresql/notify-redis-redis" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="ioredis">
        <CappedCode>
          <ExampleCode example="postgresql/notify-redis-ioredis" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode example="postgresql/notify-redis-ioredis" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="Bun" badge="Bun">
        <CappedCode>
          <ExampleCode example="postgresql/notify-redis-bun" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode example="postgresql/notify-redis-bun" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="node-redis cluster">
        <CappedCode>
          <ExampleCode
            example="postgresql/notify-redis-cluster-node-redis"
            file="src/provider.ts"
          />
        </CappedCode>
        <ExampleCode
          example="postgresql/notify-redis-cluster-node-redis"
          file="src/index.ts"
          region="setup"
        />
      </TabItem>
      <TabItem label="ioredis cluster">
        <CappedCode>
          <ExampleCode example="postgresql/notify-redis-cluster-ioredis" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="postgresql/notify-redis-cluster-ioredis"
          file="src/index.ts"
          region="setup"
        />
      </TabItem>
    </Tabs>
    <p>
      The notify adapter and your clients are held with <code>await using</code>. A client that is
      not disposable itself is adopted by a <code>drivers</code> <code>AsyncDisposableStack</code>.
      Disposal runs in reverse order, so when the scope ends the notify adapter closes before your
      clients, in the{" "}
      <a href={siteHref("/integrations/notify-adapters/#how-adapters-behave")}>shutdown order</a>.
    </p>

    <h2>Run on your machine</h2>
    <RunOnYourMachine
      example="postgresql/notify-redis-redis"
      needs="a local PostgreSQL and Redis"
    />

    <h2>Configure</h2>
    <FieldList
      title="createRedisNotifyAdapter"
      idPrefix="option"
      items={[
        {
          name: "notifyProvider",
          chips: ["required"],
          description: (
            <>
              The <code>RedisNotifyProvider</code> for your client; see{" "}
              <a href="#notify-provider">Notify provider</a>.
            </>
          ),
        },
        {
          name: "channelPrefix",
          chips: [{ label: '"queuert"', mono: true }],
          description: "Prefix of the three channel names.",
        },
      ]}
    />

    <h2>Reference</h2>
    <FoldGroup>
      <Details summary={<span id="notify-provider">Notify provider</span>}>
        <p>
          A <code>RedisNotifyProvider</code> bridges your Redis client with the adapter. Each Setup
          tab is a complete provider for its client; to use another one, implement the same members:
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
      </Details>
      <Details summary={<span id="testing-your-provider">Testing your provider</span>}>
        <p>
          <code>createRedisNotifyProviderConformanceCases({"{ createNotifyProvider }"})</code> from{" "}
          <code>@queuert/redis/conformance</code> checks a provider you write: it returns the cases,
          ready to run, that every notify adapter must pass: each case builds its own notify adapter
          over a new provider from your factory and closes both when it ends. The suite drives no
          test runner: your test file owns the connections in its own hooks and registers one test
          per case. Every example's <code>src/provider.spec.ts</code> is a working template:
        </p>
        <Tabs syncKey="redis-driver">
          <TabItem label="node-redis">
            <ExampleCode
              example="postgresql/notify-redis-redis"
              file="src/provider.spec.ts"
              region="conformance"
            />
          </TabItem>
          <TabItem label="ioredis">
            <ExampleCode
              example="postgresql/notify-redis-ioredis"
              file="src/provider.spec.ts"
              region="conformance"
            />
          </TabItem>
          <TabItem label="Bun" badge="Bun">
            <ExampleCode
              example="postgresql/notify-redis-bun"
              file="src/provider.spec.ts"
              region="conformance"
            />
          </TabItem>
          <TabItem label="node-redis cluster">
            <ExampleCode
              example="postgresql/notify-redis-cluster-node-redis"
              file="src/provider.spec.ts"
              region="conformance"
            />
          </TabItem>
          <TabItem label="ioredis cluster">
            <ExampleCode
              example="postgresql/notify-redis-cluster-ioredis"
              file="src/provider.spec.ts"
              region="conformance"
            />
          </TabItem>
        </Tabs>
        <p>
          The full API is in the{" "}
          <a href={siteHref("/api/redis-conformance/readme/")}>conformance reference</a>.
        </p>
      </Details>
      <Details summary={<span id="channels">Channels</span>}>
        <p>
          Three channels carry notifications between processes (configurable prefix, default{" "}
          <code>queuert</code>). Channels use Redis Pub/Sub — messages are fire-and-forget with no
          persistence. If no subscriber is listening when a message is published, it is lost. This
          is acceptable because workers fall back to polling when notifications are missed.
        </p>
        <FieldList
          items={[
            {
              name: "{prefix}:sched",
              chips: ["job scheduled"],
              meta: "payload · job type name",
              description:
                "Published when jobs become pending, or when a transaction that held pending jobs locked ends. Wakes idle workers.",
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
      </Details>
      <Details summary={<span id="connection-model">Connection model</span>}>
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
      </Details>
    </FoldGroup>

    <h2 id="examples">Examples</h2>
    <ExampleRows
      commandsShownFor="postgresql/notify-redis-redis"
      page="/integrations/notify-adapters/redis/"
      title="@queuert/redis"
      names={[
        "postgresql/notify-redis-redis",
        "postgresql/notify-redis-ioredis",
        "postgresql/notify-redis-bun",
        "postgresql/notify-redis-cluster-node-redis",
        "postgresql/notify-redis-cluster-ioredis",
      ]}
    />
  </>
);

export default Page;
