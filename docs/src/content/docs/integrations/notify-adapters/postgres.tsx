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
  title: "PostgreSQL notify adapter",
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

    <AtAGlance
      package="@queuert/postgres"
      clients="pg, postgres.js, Bun SQL"
      isolationLabel="Delivery"
      isolation="PostgreSQL LISTEN/NOTIFY"
      pairsWith={[
        { label: "PostgreSQL state adapter", href: "/integrations/state-adapters/postgres/" },
      ]}
    />

    <h2>Quick start</h2>
    <ClientTiles
      adapterPackage="@queuert/postgres"
      syncKey="postgres-driver"
      anchor="quick-start"
      groups={[
        {
          label: "Drivers",
          items: [
            { name: "pg", tab: "pg", packages: "pg" },
            { name: "postgres.js", tab: "postgres.js", packages: "postgres" },
            { name: "Bun SQL", tab: "Bun SQL", packages: "built into Bun", badge: "Bun" },
          ],
        },
      ]}
    />
    <p>Each example's notify provider and adapter:</p>
    <Tabs syncKey="postgres-driver" pickedElsewhere>
      <TabItem label="pg">
        <p>
          The provider owns a dedicated LISTEN client taken from the pool, so it implements{" "}
          <code>close</code>.
        </p>
        <CappedCode>
          <ExampleCode example="postgresql/notify-pg" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode example="postgresql/notify-pg" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="postgres.js">
        <p>
          A pass-through provider; it omits <code>close</code>.
        </p>
        <CappedCode>
          <ExampleCode example="postgresql/notify-postgres-js" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode example="postgresql/notify-postgres-js" file="src/index.ts" region="setup" />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <p>
          A pass-through provider; it omits <code>close</code>.
        </p>
        <CappedCode>
          <ExampleCode example="postgresql/notify-bun-sql" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode example="postgresql/notify-bun-sql" file="src/index.ts" region="setup" />
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
    <RunOnYourMachine example="postgresql/notify-pg" needs="a local PostgreSQL" />

    <h2>Configure</h2>
    <FieldList
      title="createPgNotifyAdapter"
      idPrefix="option"
      items={[
        {
          name: "notifyProvider",
          chips: ["required"],
          description: (
            <>
              The <code>PgNotifyProvider</code> for your client; see{" "}
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
          A <code>PgNotifyProvider</code> bridges your PostgreSQL client with the adapter. Each
          Setup tab is a complete provider for its driver; to use another client, implement the same
          members:
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
      </Details>
      <Details summary={<span id="testing-your-provider">Testing your provider</span>}>
        <p>
          <code>createPgNotifyProviderConformanceCases({"{ createNotifyProvider }"})</code> from{" "}
          <code>@queuert/postgres/conformance</code> checks a provider you write: it returns the
          cases, ready to run, that every notify adapter must pass: each case builds its own notify
          adapter over a new provider from your factory and closes both when it ends. The suite
          drives no test runner: your test file owns the connections in its own hooks and registers
          one test per case. Every example's <code>src/provider.spec.ts</code> is a working
          template:
        </p>
        <Tabs syncKey="postgres-driver">
          <TabItem label="pg">
            <ExampleCode
              example="postgresql/notify-pg"
              file="src/provider.spec.ts"
              region="conformance"
            />
          </TabItem>
          <TabItem label="postgres.js">
            <ExampleCode
              example="postgresql/notify-postgres-js"
              file="src/provider.spec.ts"
              region="conformance"
            />
          </TabItem>
          <TabItem label="Bun SQL" badge="Bun">
            <ExampleCode
              example="postgresql/notify-bun-sql"
              file="src/provider.spec.ts"
              region="conformance"
            />
          </TabItem>
        </Tabs>
        <p>
          The full API is in the{" "}
          <a href={siteHref("/api/postgres-conformance/readme/")}>conformance reference</a>.
        </p>
      </Details>
      <Details summary={<span id="channels">Channels</span>}>
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
              description:
                "Published when jobs become pending, or when a transaction that held pending jobs locked ends. Wakes idle workers.",
            },
            {
              name: "{prefix}_chainc",
              chips: ["chain completed"],
              meta: "payload · chain id",
              description:
                "Published when a chain completes. Wakes clients awaiting chain results.",
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
      </Details>
    </FoldGroup>

    <h2 id="examples">Examples</h2>
    <ExampleRows
      commandsShownFor="postgresql/notify-pg"
      page="/integrations/notify-adapters/postgres/"
      title="@queuert/postgres · notify"
      names={["postgresql/notify-pg", "postgresql/notify-postgres-js", "postgresql/notify-bun-sql"]}
    />
  </>
);

export default Page;
