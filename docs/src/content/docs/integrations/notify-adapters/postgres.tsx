import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList } from "../../../../components/FieldList.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";

export const meta = {
  title: "PostgreSQL Notify Adapter",
  description:
    "Wake workers with PostgreSQL LISTEN/NOTIFY: no extra service, drivers pg, postgres.js and Bun SQL.",
};

const Page = () => (
  <>
    <p>
      <code>createPgNotifyAdapter</code> uses PostgreSQL's built-in <code>LISTEN</code>/
      <code>NOTIFY</code> mechanism. No additional infrastructure beyond your existing PostgreSQL
      database — it is already included in <code>@queuert/postgres</code>.
    </p>

    <h2 id="install">Install</h2>
    <Code lang="bash">{`npm install @queuert/postgres`}</Code>

    <h2 id="setup">Setup</h2>
    <p>Each example's notify provider and adapter:</p>
    <Tabs syncKey="postgres-driver">
      <TabItem label="pg">
        <p>
          The provider owns a dedicated LISTEN client taken from the pool, so it implements{" "}
          <code>close</code>.
        </p>
        <ExampleCode example="notify-postgres-pg" file="src/provider.ts" />
        <ExampleCode example="notify-postgres-pg" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="postgres.js">
        <p>
          A pass-through provider; it omits <code>close</code>.
        </p>
        <ExampleCode example="notify-postgres-postgres-js" file="src/provider.ts" />
        <ExampleCode example="notify-postgres-postgres-js" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <p>
          A pass-through provider; it omits <code>close</code>.
        </p>
        <ExampleCode example="notify-postgres-bun-sql" file="src/provider.ts" />
        <ExampleCode example="notify-postgres-bun-sql" file="src/index.ts" region="setup" />
      </TabItem>
    </Tabs>
    <p>
      Close the adapters, then your own clients, in the{" "}
      <A href="/integrations/notify-adapters/#how-adapters-behave">shutdown order</A>:
    </p>
    <Tabs syncKey="postgres-driver">
      <TabItem label="pg">
        <ExampleCode example="notify-postgres-pg" file="src/index.ts" region="cleanup" />
      </TabItem>
      <TabItem label="postgres.js">
        <ExampleCode example="notify-postgres-postgres-js" file="src/index.ts" region="cleanup" />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode example="notify-postgres-bun-sql" file="src/index.ts" region="cleanup" />
      </TabItem>
    </Tabs>

    <h2 id="configuration">Configuration</h2>
    <FieldList
      title="createPgNotifyAdapter options"
      idPrefix="option"
      items={[
        {
          name: "notifyProvider",
          chips: ["required"],
          meta: "PgNotifyProvider",
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
      A <code>PgNotifyProvider</code> bridges your PostgreSQL client with the adapter. Each Setup
      tab is a complete provider for its driver; to use another client, implement the same members:
    </p>
    <FieldList
      title="PgNotifyProvider"
      idPrefix="provider"
      items={[
        {
          name: "publish",
          description: "Sends a batch of messages to a named channel in one statement.",
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
            "Only needed when the provider owns resources (e.g. a dedicated LISTEN client). notifyAdapter.close() invokes it.",
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
    <Tabs syncKey="postgres-driver">
      <TabItem label="pg">
        <ExampleCode
          example="notify-postgres-pg"
          file="src/provider.spec.ts"
          region="conformance"
        />
      </TabItem>
      <TabItem label="postgres.js">
        <ExampleCode
          example="notify-postgres-postgres-js"
          file="src/provider.spec.ts"
          region="conformance"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode
          example="notify-postgres-bun-sql"
          file="src/provider.spec.ts"
          region="conformance"
        />
      </TabItem>
    </Tabs>

    <h2 id="channels">Channels</h2>
    <p>
      The adapter uses three notification channels (configurable prefix, default{" "}
      <code>queuert</code>):
    </p>
    <FieldList
      items={[
        {
          name: "{prefix}_sched",
          chips: ["job scheduled"],
          meta: "payload · job type name",
          description: "Published when jobs become pending. Wakes idle workers.",
        },
        {
          name: "{prefix}_chainc",
          chips: ["chain completed"],
          meta: "payload · chain id",
          description: "Published when a chain completes. Wakes clients awaiting chain results.",
        },
        {
          name: "{prefix}_atls",
          chips: ["attempt lost"],
          meta: "payload · job id",
          description:
            "Published when a running job's attempt is lost. Notifies workers of attempt loss.",
        },
      ]}
    />

    <h2 id="examples">Examples</h2>
    <ExampleRows
      title="@queuert/postgres · notify"
      names={["notify-postgres-pg", "notify-postgres-postgres-js", "notify-postgres-bun-sql"]}
    />
  </>
);

export default Page;
