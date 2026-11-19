import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { ClientTiles } from "../../../../components/integrations/ClientTiles.tsx";
import {
  postgresIndexes,
  postgresTables,
} from "../../../../components/integrations/state-adapters/postgres.schema.ts";
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

const pipelining = (): FieldItem[] => [
  {
    name: "pg",
    chips: [{ label: "pipeline: true", mono: true }],
    description: (
      <>
        Pipelines with <code>pipeline: true</code> on the <code>Pool</code> or <code>Client</code>{" "}
        (pg 8.23 or later): the client sends queued queries without waiting for their results.
        Without the option it queues them and runs them one at a time.
      </>
    ),
  },
  {
    name: "postgres.js",
    chips: ["pipelined"],
    description: (
      <>
        Pipelines the queries issued on one connection, including inside <code>sql.begin</code>.
      </>
    ),
  },
  {
    name: "Drizzle",
    chips: [{ label: "pipeline: true", mono: true }],
    description: (
      <>
        On node-postgres, with <code>pipeline: true</code> on the pool: the provider queries the
        transaction's pg client directly.
      </>
    ),
  },
  {
    name: "Knex",
    chips: [{ label: "pipeline: true", mono: true }],
    description: (
      <>
        On pg, with <code>pipeline: true</code> in the connection config: its transaction calls the
        pg connection directly, with no queue of its own.
      </>
    ),
  },
  {
    name: "Kysely",
    chips: ["one by one"],
    description: (
      <>
        Its transactions run one query at a time on a single connection and do not expose the pg
        client.
      </>
    ),
  },
  {
    name: "MikroORM",
    chips: ["one by one"],
    description: "Its transactions run on Kysely.",
  },
  {
    name: "Prisma",
    chips: ["one by one"],
    description: (
      <>
        Interactive transactions with <code>@prisma/adapter-pg</code> chain their operations through
        a queue.
      </>
    ),
  },
  {
    name: "Bun SQL",
    chips: ["pipelined"],
    description: (
      <>
        Pipelines the queries issued on one connection, including inside <code>sql.begin</code>.
      </>
    ),
  },
];

const Page = () => (
  <>
    <p>
      <code>@queuert/postgres</code> supports horizontal scaling with database-level locking (
      <code>FOR UPDATE SKIP LOCKED</code>), writeable CTEs for atomic batch operations, and all
      Queuert features including concurrent multi-worker deployments that share one database; see{" "}
      <A href="/guides/horizontal-scaling/">Horizontal Scaling</A>.
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
      Requires PostgreSQL 14 or later, which <code>migrateToLatest()</code> checks. The same package
      includes the <A href="/integrations/notify-adapters/postgres/">PostgreSQL notify adapter</A> (
      <code>LISTEN</code>/<code>NOTIFY</code>).
    </p>

    <h2>Setup</h2>
    <p>
      Each tab shows the example's <code>PgStateProvider</code> and the lines that create the
      adapter:
    </p>
    <Tabs syncKey="postgres-driver">
      <TabItem label="pg">
        <ExampleCode example="postgresql/state-pg" file="src/provider.ts" />
        <ExampleCode
          example="postgresql/state-pg"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="postgres.js">
        <ExampleCode example="postgresql/state-postgres-js" file="src/provider.ts" />
        <ExampleCode
          example="postgresql/state-postgres-js"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode example="postgresql/state-bun-sql" file="src/provider.ts" />
        <ExampleCode
          example="postgresql/state-bun-sql"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode example="postgresql/state-drizzle" file="src/provider.ts" />
        <ExampleCode
          example="postgresql/state-drizzle"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode example="postgresql/state-kysely" file="src/provider.ts" />
        <ExampleCode
          example="postgresql/state-kysely"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode example="postgresql/state-prisma" file="src/provider.ts" />
        <ExampleCode
          example="postgresql/state-prisma"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode example="postgresql/state-knex" file="src/provider.ts" />
        <ExampleCode
          example="postgresql/state-knex"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="MikroORM">
        <ExampleCode example="postgresql/state-mikro-orm" file="src/provider.ts" />
        <p>
          <code>skipTables</code> keeps MikroORM's schema diff from dropping Queuert's tables, which{" "}
          <code>migrateToLatest()</code> manages:
        </p>
        <ExampleCode
          example="postgresql/state-mikro-orm"
          file="src/index.ts"
          region="orm"
          title="src/index.ts"
        />
        <ExampleCode
          example="postgresql/state-mikro-orm"
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
      <code>createPgStateProviderConformanceCases</code> returns the cases, ready to run: every case
      a state adapter must pass, the cases that hold two transactions open at once, checks of the
      schema write fence, and checks that <code>classifyError</code> names a missing table. It takes
      a <code>createStateProvider</code> factory and a <code>withNonTransactionContext</code> that
      runs a callback with a context outside any transaction, and migrates the schema once, before
      the first case. An optional <code>withSavepoint</code> runs a callback in a savepoint of a
      transaction, opened the way your application opens one, and passes it the savepoint's context;
      when you give it, the cases check that <code>onTransactionCommit</code> and{" "}
      <code>onTransactionRollback</code> follow savepoints. Each case then builds its own adapter
      over a new provider from your factory, with the tables cleared, and closes both when it ends.
      The suite drives no test runner: your test file owns the database in its own hooks and
      registers one test per case, as each example does:
    </p>
    <Tabs syncKey="postgres-driver">
      <TabItem label="pg">
        <ExampleCode
          example="postgresql/state-pg"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="postgres.js">
        <ExampleCode
          example="postgresql/state-postgres-js"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode
          example="postgresql/state-bun-sql"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode
          example="postgresql/state-drizzle"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode
          example="postgresql/state-kysely"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode
          example="postgresql/state-prisma"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode
          example="postgresql/state-knex"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="MikroORM">
        <ExampleCode
          example="postgresql/state-mikro-orm"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
    </Tabs>
    <p>
      The full API is in the <A href="/api/postgres-conformance/readme/">conformance reference</A>.
    </p>

    <h2 id="pipelining">Pipelining</h2>
    <p>
      The adapter sends the statements of one operation whose parameters it knows up front to{" "}
      <code>executeStatements</code> as one batch. A provider whose client pipelines issues them all
      without waiting for each result, so the batch costs one round trip; any other provider runs it
      statement by statement, which is just as correct. Inside a transaction, the statements after a
      failed one reject with <code>25P02</code> (transaction aborted), so the provider throws the
      first rejection in statement order, which carries the real cause. The Setup providers:
    </p>
    <FieldList title="Pipelining by client" proseNames items={pipelining()} />
    <p>
      <code>pipeline: true</code> is set per pg client or pool, so it applies to your application's
      own queries on that pool too. In pipeline mode pg rejects queries that keep a portal open
      across round trips (<code>pg-cursor</code>, <code>pg-query-stream</code>), so an application
      that uses them gives Queuert its own pool.
    </p>

    <h2>Isolation level</h2>
    <p>
      Queuert supports only READ COMMITTED, PostgreSQL's default isolation level. This covers every
      transaction Queuert writes in, including the ones you pass to <code>complete</code> and to
      client methods. Its conditional and multi-statement writes, such as <code>unblockJobs</code>{" "}
      locking the blocked jobs and then counting down their incomplete blockers, rely on each
      statement taking a fresh snapshot after it waits on a row lock. Every provider above opens its
      transactions with the level stated, so a server or role whose{" "}
      <code>default_transaction_isolation</code> is higher cannot change it; open the transactions
      you pass to Queuert the same way.
    </p>

    <h2>Write fence</h2>
    <p>
      Every insert, update or delete of a job, a blocker or a worker references an empty{" "}
      <code>{"{prefix}"}schema_fence_v2</code> table, the write fence of the adapter's schema
      version. A breaking migration, such as <code>002_schema_v2</code>, drops the fence tables of
      older versions, so code older than the schema fails each write with{" "}
      <code>SchemaFencedError</code> and changes nothing, instead of corrupting state. Reads still
      work, and older workers report the error through <code>workerError</code> and keep retrying.
      Stop them once you have deployed the newer version.
    </p>

    <h2>Schema</h2>
    <p>
      The adapter creates its schema via <code>migrateToLatest()</code>. All objects live under a
      configurable PostgreSQL <code>schema</code> (default: <code>public</code>) with a table name
      prefix (default: <code>queuert_</code>, shown as <code>{"{prefix}"}</code>) for namespace
      isolation.
    </p>
    <p>
      The migrator behind <code>migrateToLatest()</code> is exported for your own tables too; see{" "}
      <A href="/guides/application-migrations/">Application Migrations</A>.
    </p>
    <SchemaTables tables={postgresTables} />

    <h2>Indexes</h2>
    <SchemaIndexes indexes={postgresIndexes} />

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
        "postgresql/state-pg",
        "postgresql/state-postgres-js",
        "postgresql/state-bun-sql",
        "postgresql/state-drizzle",
        "postgresql/state-kysely",
        "postgresql/state-prisma",
        "postgresql/state-knex",
        "postgresql/state-mikro-orm",
        "postgresql/multi-worker",
      ]}
    />
    <p>
      The API reference for every export is in <A href="/api/postgres/readme/">@queuert/postgres</A>
      .
    </p>
  </>
);

export default Page;
