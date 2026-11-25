import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { AtAGlance } from "../../../../components/integrations/AtAGlance.tsx";
import { CappedCode } from "../../../../components/integrations/CappedCode.tsx";
import { ClientTiles } from "../../../../components/integrations/ClientTiles.tsx";
import { FoldGroup } from "../../../../components/integrations/FoldGroup.tsx";
import { RunOnYourMachine } from "../../../../components/integrations/RunOnYourMachine.tsx";
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
import { Details } from "../../../../components/mdx/Details.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";
import { siteHref } from "../../../../docs/href.ts";

export const meta = {
  title: "PostgreSQL state adapter",
  description:
    "Store chains, jobs and workers in PostgreSQL with pg, postgres.js, Bun SQL, Drizzle, Kysely, Prisma, Knex or MikroORM.",
};

const mainOptions = (): FieldItem[] => [
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
    description: "Prefix of every table name.",
  },
];

const moreOptions = (): FieldItem[] => [
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
  {
    name: "transactionRetry",
    chips: [{ label: "{ maxTries: 5, initialDelayMs: 50, maxDelayMs: 50 }", mono: true }],
    description: (
      <>
        Retries of the transactions and statements the adapter runs itself after a serialization
        failure: each retry waits a random delay up to the backoff of the failed try, and the
        failure of the last try is thrown; see <a href="#isolation-level">Isolation levels</a>.
      </>
    ),
  },
  ...stateAdapterConfigItems(),
];

const Page = () => (
  <>
    <p>
      <code>@queuert/postgres</code> supports horizontal scaling with database-level locking (
      <code>FOR UPDATE SKIP LOCKED</code>), writeable CTEs for atomic batch operations, and all
      Queuert features including concurrent multi-worker deployments that share one database; see{" "}
      <a href={siteHref("/guides/horizontal-scaling/")}>Horizontal Scaling</a>.
    </p>

    <AtAGlance
      package="@queuert/postgres"
      clients="pg, postgres.js, Bun SQL, PGlite, Drizzle, Kysely, Prisma, Knex, MikroORM"
      isolation={
        <>
          READ COMMITTED, REPEATABLE READ or SERIALIZABLE; see{" "}
          <a href="#isolation-level">Isolation levels</a>
        </>
      }
      pairsWith={[
        { label: "PostgreSQL notify adapter", href: "/integrations/notify-adapters/postgres/" },
        { label: "Redis notify adapter", href: "/integrations/notify-adapters/redis/" },
        { label: "NATS notify adapter", href: "/integrations/notify-adapters/nats/" },
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
    <p>
      Requires PostgreSQL 14 or later. The same package includes the{" "}
      <a href={siteHref("/integrations/notify-adapters/postgres/")}>PostgreSQL notify adapter</a> (
      <code>LISTEN</code>/<code>NOTIFY</code>). Pick a driver to see its{" "}
      <code>PgStateProvider</code> (<code>provider.ts</code>, copy it) and the lines that create the
      adapter:
    </p>
    <Tabs syncKey="postgres-driver" pickedElsewhere>
      <TabItem label="pg">
        <CappedCode>
          <ExampleCode example="postgresql/state-pg" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="postgresql/state-pg"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="postgres.js">
        <CappedCode>
          <ExampleCode example="postgresql/state-postgres-js" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="postgresql/state-postgres-js"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <CappedCode>
          <ExampleCode example="postgresql/state-bun-sql" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="postgresql/state-bun-sql"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <CappedCode>
          <ExampleCode example="postgresql/state-drizzle" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="postgresql/state-drizzle"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <CappedCode>
          <ExampleCode example="postgresql/state-kysely" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="postgresql/state-kysely"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <CappedCode>
          <ExampleCode example="postgresql/state-prisma" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="postgresql/state-prisma"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <CappedCode>
          <ExampleCode example="postgresql/state-knex" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="postgresql/state-knex"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="MikroORM">
        <CappedCode>
          <ExampleCode example="postgresql/state-mikro-orm" file="src/provider.ts" />
        </CappedCode>
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

    <RunOnYourMachine example="postgresql/state-pg" />

    <h2>Configure</h2>
    <FieldList title="createPgStateAdapter" idPrefix="option" items={mainOptions()} />
    <Details summary="More options" hint={`${moreOptions().length} options`}>
      <FieldList title="More options" idPrefix="option" items={moreOptions()} />
      <Code lang="ts">{`
        const stateAdapter = createPgStateAdapter({
          stateProvider,
          maxBlockersPerJob: 500,
          countCap: 50_000,
        });
      `}</Code>
      <StateAdapterConfigNote />
    </Details>

    <h2>Reference</h2>
    <FoldGroup>
      <Details summary={<span id="schema">Schema</span>} hint={`${postgresTables.length} tables`}>
        <p>
          The adapter creates its schema via <code>migrateToLatest()</code>. All objects live under
          a configurable PostgreSQL <code>schema</code> (default: <code>public</code>) with a table
          name prefix (default: <code>queuert_</code>, shown as <code>{"{prefix}"}</code>) for
          namespace isolation.
        </p>
        <p>
          The migrator behind <code>migrateToLatest()</code> is exported for your own tables too;
          see <a href={siteHref("/guides/application-migrations/")}>Application Migrations</a>.
        </p>
        <SchemaTables tables={postgresTables} />
      </Details>
      <Details
        summary={<span id="indexes">Indexes</span>}
        hint={`${postgresIndexes.length} indexes`}
      >
        <SchemaIndexes indexes={postgresIndexes} />
      </Details>
      <Details
        summary={<span id="state-provider">State provider</span>}
        hint={`${stateProviderMembers("postgres").length} members`}
      >
        <p>
          A <code>PgStateProvider</code> bridges your database client with the adapter: the adapter
          runs all its SQL and transactions through it. Each Quick start tab is a complete provider
          for its driver or ORM; to use another client, implement the same members:
        </p>
        <FieldList
          title="PgStateProvider"
          idPrefix="provider"
          items={stateProviderMembers("postgres")}
        />
      </Details>
      <Details summary={<span id="isolation-level">Isolation levels</span>}>
        <p>
          Queuert works at READ COMMITTED, REPEATABLE READ and SERIALIZABLE, set as the session
          default (<code>default_transaction_isolation</code>) or per transaction, and transactions
          at different levels can work on the same jobs at once. Whenever one transaction acts on
          what another may be changing, both write the same row: attaching a dependent and
          completing its blocker both write the blocker's head job, and acquiring jobs and
          reclaiming the acquiring worker both write the worker row. At READ COMMITTED the second
          transaction waits and re-reads the row; at the stricter levels it fails with a
          serialization failure (SQLSTATE <code>40001</code>).
        </p>
        <ul>
          <li>
            Queuert retries the transactions and statements it runs itself, such as acquisition,
            lease renewal and reclaims, as{" "}
            <a href="#option-transactionRetry">
              <code>transactionRetry</code>
            </a>{" "}
            configures, when the provider's <code>classifyError</code> reports the failure as{" "}
            <code>transaction_conflict</code>: a serialization failure, or a deadlock (SQLSTATE{" "}
            <code>40P01</code>), which can happen at any level.
          </li>
          <li>
            The transactions you pass to <code>applyJobOutcome</code>, <code>fenceJob</code> and
            client methods raise it to you. Retry them with fresh <code>txHooks</code> for each try,
            or inside{" "}
            <a href={siteHref("/guides/tx-hooks/#drivers-that-rerun-the-callback")}>
              <code>txHooks.retryBoundary</code>
            </a>
            .
          </li>
          <li>Migration transactions run at READ COMMITTED whatever the session default.</li>
          <li>
            The stricter levels cost throughput under contention: workers acquiring the same job
            type retry when another worker claimed a row after their statement's snapshot, and
            attaching many dependents to one blocker conflicts on its head. Give Queuert's pool a
            READ COMMITTED default to keep its own work at that level while your transactions use a
            stricter one.
          </li>
        </ul>
      </Details>
      <Details summary={<span id="vacuum-tuning">Vacuum tuning</span>}>
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
              description:
                "Leaves room for each lease renewal to be a HOT update on the same page.",
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
      </Details>
      <Details summary={<span id="write-fence">Write fence</span>}>
        <p>
          Every insert, update or delete of a job, a blocker or a worker references an empty{" "}
          <code>{"{prefix}"}schema_fence_v2</code> table, the write fence of the adapter's schema
          version. A breaking migration, such as <code>002_schema_v2</code>, drops the fence tables
          of older versions, so older code fails each write with <code>SchemaFencedError</code>; see{" "}
          <a href={siteHref("/integrations/state-adapters/#write-fence")}>Write fence</a> for what
          that means for a deployment.
        </p>
      </Details>
      <Details summary={<span id="testing-your-provider">Testing your provider</span>}>
        <p>
          <code>@queuert/postgres/conformance</code> checks a provider you write.{" "}
          <code>createPgStateProviderConformanceCases</code> returns the cases, ready to run: every
          case a state adapter must pass, the cases that hold two transactions open at once, checks
          of the schema write fence, and checks that <code>classifyError</code> names a missing
          table and reports a serialization failure, and that <code>withTransaction</code> runs no
          statement before its callback. The cases run at the isolation level of your provider's
          transactions; to cover several levels, create the cases once per level, over providers
          whose connections default to it. The factory, <code>withNonTransactionContext</code>, the
          optional <code>withSavepoint</code> and the per-case adapter work as described in{" "}
          <a href={siteHref("/integrations/state-adapters/#testing-your-provider")}>
            Testing your provider
          </a>
          ; the test file owns the database in its own hooks and registers one test per case, as
          each example does:
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
          The full API is in the{" "}
          <a href={siteHref("/api/postgres-conformance/readme/")}>conformance reference</a>.
        </p>
      </Details>
    </FoldGroup>

    <h2>Examples</h2>
    <ExampleRows
      commandsShownFor="postgresql/state-pg"
      page="/integrations/state-adapters/postgres/"
      title="@queuert/postgres"
      names={[
        "postgresql/state-pg",
        "postgresql/state-postgres-js",
        "postgresql/state-bun-sql",
        "postgresql/state-pglite",
        "postgresql/state-drizzle",
        "postgresql/state-kysely",
        "postgresql/state-prisma",
        "postgresql/state-knex",
        "postgresql/state-mikro-orm",
        "postgresql/multi-worker",
      ]}
    />
    <p>
      The API reference for every export is in{" "}
      <a href={siteHref("/api/postgres/readme/")}>@queuert/postgres</a>.
    </p>
  </>
);

export default Page;
