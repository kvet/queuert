import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { ClientTiles } from "../../../../components/integrations/ClientTiles.tsx";
import {
  SchemaIndexes,
  SchemaTables,
} from "../../../../components/integrations/state-adapters/SchemaTables.tsx";
import {
  StateAdapterConfigNote,
  stateAdapterConfigItems,
} from "../../../../components/integrations/state-adapters/stateAdapterConfig.tsx";
import { stateProviderMembers } from "../../../../components/integrations/state-adapters/stateProvider.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";

export const meta = {
  title: "PostgreSQL State Adapter",
  description:
    "Store chains, jobs and workers in PostgreSQL with pg, postgres.js, Bun SQL, Drizzle, Kysely, Prisma, Knex or MikroORM.",
};

const options = (): FieldItem[] => [
  {
    name: "stateProvider",
    chips: ["required"],
    description: (
      <>
        The <code>PgStateProvider</code> for your client; see{" "}
        <a href="#state-provider">State provider</a>.
      </>
    ),
  },
  {
    name: "schema",
    chips: [{ label: '"public"', mono: true }],
    description: "PostgreSQL schema that holds all objects.",
  },
  {
    name: "tablePrefix",
    chips: [{ label: '"queuert_"', mono: true }],
    description: "Table name prefix for namespace isolation.",
  },
  {
    name: "jobIdType",
    chips: [{ label: '"uuid"', mono: true }],
    description: "Type of the job id columns.",
  },
  {
    name: "workerIdType",
    chips: [{ label: '"uuid"', mono: true }],
    description: "Type of the worker id columns.",
  },
  ...stateAdapterConfigItems(),
];

const Page = () => (
  <>
    <p>
      <code>@queuert/postgres</code> is recommended for production. It supports horizontal scaling
      with database-level locking (<code>FOR UPDATE SKIP LOCKED</code>), writeable CTEs for atomic
      batch operations, and all Queuert features including concurrent multi-worker deployments that
      share one database; see <A href="/guides/horizontal-scaling/">Horizontal Scaling</A>.
    </p>

    <h2>Clients</h2>
    <ClientTiles
      syncKey="postgres-driver"
      anchor="setup"
      groups={[
        {
          label: "Drivers",
          items: [
            { name: "pg", tab: "pg", packages: "pg" },
            { name: "postgres.js", tab: "postgres.js", packages: "postgres" },
            { name: "Bun SQL", tab: "Bun SQL", packages: "built into Bun", badge: "Bun" },
          ],
        },
        {
          label: "ORMs and query builders",
          items: [
            { name: "Drizzle", tab: "Drizzle", packages: "drizzle-orm · pg" },
            { name: "Kysely", tab: "Kysely", packages: "kysely · pg" },
            { name: "Prisma", tab: "Prisma", packages: "@prisma/client · @prisma/adapter-pg · pg" },
            { name: "Knex", tab: "Knex", packages: "knex · pg" },
            { name: "MikroORM", tab: "MikroORM", packages: "@mikro-orm/postgresql · kysely" },
          ],
        },
      ]}
    />

    <h2>Install</h2>
    <Code lang="bash">{`npm install @queuert/postgres`}</Code>
    <p>
      Requires PostgreSQL 14 or later. The same package includes the{" "}
      <A href="/integrations/notify-adapters/postgres/">PostgreSQL notify adapter</A> (
      <code>LISTEN</code>/<code>NOTIFY</code>).
    </p>

    <h2>Setup</h2>
    <p>
      Each tab shows the example's <code>PgStateProvider</code> and the lines that create the
      adapter:
    </p>
    <Tabs syncKey="postgres-driver">
      <TabItem label="pg">
        <ExampleCode example="state-postgres-pg" file="src/provider.ts" />
        <ExampleCode
          example="state-postgres-pg"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="postgres.js">
        <ExampleCode example="state-postgres-postgres-js" file="src/provider.ts" />
        <ExampleCode
          example="state-postgres-postgres-js"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode example="state-postgres-bun-sql" file="src/provider.ts" />
        <ExampleCode
          example="state-postgres-bun-sql"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode example="state-postgres-drizzle" file="src/provider.ts" />
        <ExampleCode
          example="state-postgres-drizzle"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode example="state-postgres-kysely" file="src/provider.ts" />
        <ExampleCode
          example="state-postgres-kysely"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode example="state-postgres-prisma" file="src/provider.ts" />
        <ExampleCode
          example="state-postgres-prisma"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode example="state-postgres-knex" file="src/provider.ts" />
        <ExampleCode
          example="state-postgres-knex"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="MikroORM">
        <ExampleCode example="state-postgres-mikro-orm" file="src/provider.ts" />
        <p>
          <code>skipTables</code> keeps MikroORM's schema diff from dropping Queuert's tables, which{" "}
          <code>migrateToLatest()</code> manages:
        </p>
        <ExampleCode
          example="state-postgres-mikro-orm"
          file="src/index.ts"
          region="orm"
          title="src/index.ts"
        />
        <ExampleCode
          example="state-postgres-mikro-orm"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
    </Tabs>

    <h2>Configuration</h2>
    <FieldList title="createPgStateAdapter" idPrefix="option" items={options()} />
    <Code lang="ts">{`
      const stateAdapter = createPgStateAdapter({
        stateProvider,
        maxBlockersPerJob: 500,
        countCap: 50_000,
      });
    `}</Code>
    <StateAdapterConfigNote />

    <h2>State provider</h2>
    <p>
      A <code>PgStateProvider</code> bridges your database client with the adapter: the adapter runs
      all its SQL and transactions through it. Each Setup tab is a complete provider for its driver
      or ORM; to use another client, implement the same members:
    </p>
    <FieldList
      title="PgStateProvider"
      idPrefix="provider"
      items={stateProviderMembers("postgres")}
    />

    <h2 id="testing-your-provider">Testing your provider</h2>
    <p>
      <code>@queuert/postgres/conformance</code> checks a provider you write.{" "}
      <code>pgStateProviderConformanceCases</code> are every case a state adapter must pass, the
      cases that hold two transactions open at once, checks of the schema write fence, and checks
      that <code>classifyError</code> names a missing table.{" "}
      <code>createPgStateProviderConformanceContext</code> prepares the context they run against: it
      takes a <code>createStateProvider</code> factory and a <code>withNonTransactionContext</code>{" "}
      that runs a callback with a context outside any transaction, and migrates the schema once. An
      optional <code>withSavepoint</code> runs a callback in a savepoint of a transaction, opened
      the way your application opens one, and passes it the savepoint's context; when you give it,
      the cases check that <code>onTransactionCommit</code> and <code>onTransactionRollback</code>{" "}
      follow savepoints. Each case then builds its own adapter over a new provider from your
      factory, with the tables cleared, and closes both when it ends. The suite drives no test
      runner: your test file owns the database in its own hooks and registers one test per case, as
      each example does:
    </p>
    <Tabs syncKey="postgres-driver">
      <TabItem label="pg">
        <ExampleCode
          example="state-postgres-pg"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="postgres.js">
        <ExampleCode
          example="state-postgres-postgres-js"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode
          example="state-postgres-bun-sql"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode
          example="state-postgres-drizzle"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode
          example="state-postgres-kysely"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode
          example="state-postgres-prisma"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode
          example="state-postgres-knex"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="MikroORM">
        <ExampleCode
          example="state-postgres-mikro-orm"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
    </Tabs>
    <p>
      The full API is in the <A href="/api/postgres-conformance/readme/">conformance reference</A>.
    </p>

    <h2>Isolation level</h2>
    <p>
      Queuert supports only READ COMMITTED, PostgreSQL's default isolation level. This covers every
      transaction Queuert writes in, including the ones you pass to <code>complete</code> and to
      client methods. Its conditional and multi-statement writes, such as <code>unblockJobs</code>{" "}
      locking the blocked jobs and then recomputing their blockers, rely on each statement taking a
      fresh snapshot after it waits on a row lock.
    </p>

    <h2>Write fence</h2>
    <p>
      Every insert or update of a job, a blocker or a worker references an empty{" "}
      <code>{"{prefix}"}schema_fence_v1</code> table, the write fence of the adapter's schema
      version. A breaking migration drops the fence tables of older versions, so code older than the
      schema fails each write with <code>SchemaFencedError</code> and changes nothing, instead of
      corrupting state. Reads and deletes still work, and older workers report the error through{" "}
      <code>workerError</code> and keep retrying. Stop them once you have deployed the newer
      version. Processes on 0.17 reference no fence, so stop them before the first breaking
      migration.
    </p>

    <h2>Schema</h2>
    <p>
      The adapter creates its schema via <code>migrateToLatest()</code>. All objects live under a
      configurable PostgreSQL <code>schema</code> (default: <code>public</code>) with a table name
      prefix (default: <code>queuert_</code>, shown as <code>{"{prefix}"}</code>) for namespace
      isolation.
    </p>
    <p>
      A database migrated by 0.17 is carried onto the schema by adding the{" "}
      <code>{"{prefix}"}schema_fence_v1</code> table, without touching job or worker rows, so 0.17
      workers can keep running while <code>migrateToLatest()</code> runs. A 0.16 database is
      refused: upgrade it with <code>@queuert/postgres</code> 0.17 first.
    </p>
    <p>
      The migrator behind <code>migrateToLatest()</code> is exported for your own tables too; see{" "}
      <A href="/guides/application-migrations/">Application Migrations</A>.
    </p>
    <SchemaTables dialect="postgres" />

    <h2>Indexes</h2>
    <SchemaIndexes dialect="postgres" />

    <h2>Vacuum tuning</h2>
    <p>The schema configures aggressive autovacuum and storage settings on the job tables:</p>
    <FieldList
      title="storage parameters"
      items={[
        {
          name: "fillfactor = 75",
          chips: [{ label: "job", mono: true }],
          description:
            "Reserves free space per heap page for HOT updates. job_blocker skips it: blockers are inserted and deleted without intermediate updates.",
        },
        {
          name: "fillfactor = 50",
          chips: [{ label: "worker", mono: true }],
          description: "Leaves room for each lease renewal to be a HOT update on the same page.",
        },
        {
          name: "autovacuum_vacuum_threshold / autovacuum_analyze_threshold = 5000, scale_factor = 0",
          chips: [
            { label: "job", mono: true },
            { label: "job_blocker", mono: true },
          ],
          description: "Pin autovacuum to a fixed dead-tuple budget.",
        },
        {
          name: "autovacuum_vacuum_cost_delay = 0",
          chips: [
            { label: "job", mono: true },
            { label: "job_blocker", mono: true },
          ],
          description: "Removes I/O throttling.",
        },
      ]}
    />

    <h2>Examples</h2>
    <ExampleRows
      title="@queuert/postgres"
      names={[
        "state-postgres-pg",
        "state-postgres-postgres-js",
        "state-postgres-bun-sql",
        "state-postgres-drizzle",
        "state-postgres-kysely",
        "state-postgres-prisma",
        "state-postgres-knex",
        "state-postgres-mikro-orm",
        "state-postgres-multi-worker",
      ]}
    />
    <p>
      The API reference for every export is in <A href="/api/postgres/readme/">@queuert/postgres</A>
      .
    </p>
  </>
);

export default Page;
