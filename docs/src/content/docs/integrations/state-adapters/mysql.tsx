import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { AtAGlance } from "../../../../components/integrations/AtAGlance.tsx";
import { CappedCode } from "../../../../components/integrations/CappedCode.tsx";
import { ClientTiles } from "../../../../components/integrations/ClientTiles.tsx";
import { ExperimentalAside } from "../../../../components/integrations/ExperimentalAside.tsx";
import { FoldGroup } from "../../../../components/integrations/FoldGroup.tsx";
import { RunOnYourMachine } from "../../../../components/integrations/RunOnYourMachine.tsx";
import {
  mysqlIndexes,
  mysqlTables,
} from "../../../../components/integrations/state-adapters/mysql.schema.ts";
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
  title: "MySQL / MariaDB state adapter",
  description: "Store chains, jobs and workers in MySQL or MariaDB.",
};

const mainOptions = (): FieldItem[] => [
  {
    name: "stateProvider",
    chips: ["required"],
    description: (
      <>
        The <code>MysqlStateProvider</code> for your client; see{" "}
        <a href="#state-provider">State provider</a>.
      </>
    ),
  },
  {
    name: "dialect",
    chips: ["required"],
    description: (
      <>
        <code>"mysql"</code> or <code>"mariadb"</code>: the server the adapter talks to. It picks
        the collation and the SQL forms that differ between the two, so it must match the server.
      </>
    ),
  },
  {
    name: "schema",
    chips: ["the connection's database"],
    description: "Database that holds the tables.",
  },
];

const moreOptions = (): FieldItem[] => [
  {
    name: "tablePrefix",
    chips: [{ label: '"queuert_"', mono: true }],
    description: "Prefix of every table name.",
  },
  {
    name: "jobIdType",
    chips: [{ label: '"uuid"', mono: true }],
    description: (
      <>
        Type of the job id columns: <code>"uuid"</code> (<code>CHAR(36)</code>,{" "}
        <code>ascii_bin</code>) or <code>"varchar(n)"</code> with <code>n</code> from 1 to 255, in
        the dialect's exact collation.
      </>
    ),
  },
  {
    name: "workerIdType",
    chips: [{ label: '"uuid"', mono: true }],
    description: (
      <>
        Type of the worker id columns, with the same presets as <code>jobIdType</code>.
      </>
    ),
  },
  {
    name: "transactionRetry",
    chips: [{ label: "{ maxTries: 5, initialDelayMs: 50, maxDelayMs: 50 }", mono: true }],
    description: (
      <>
        Retries of the transactions and statements the adapter runs itself after a deadlock or a
        snapshot conflict: each retry waits a random delay up to the backoff of the failed try, and
        the failure of the last try is thrown; see <a href="#isolation-level">Isolation levels</a>.
      </>
    ),
  },
  ...stateAdapterConfigItems(),
];

const requirements = (): FieldItem[] => [
  {
    name: "A default database",
    description: (
      <>
        Connect with a database selected. MySQL rejects the adapter's multi-table updates over{" "}
        <code>JSON_TABLE</code> on a connection without one (error 1046), even when every table is
        qualified.
      </>
    ),
  },
  {
    name: "A strict sql_mode",
    description: (
      <>
        <code>STRICT_TRANS_TABLES</code> or <code>STRICT_ALL_TABLES</code>, so the server rejects a
        value instead of truncating it. Both servers enable it by default.
      </>
    ),
  },
  {
    name: "No NO_BACKSLASH_ESCAPES",
    description: (
      <>
        Leave <code>NO_BACKSLASH_ESCAPES</code> out of <code>sql_mode</code>: drivers escape the
        parameters of text-protocol statements with backslashes. Both servers leave it out by
        default.
      </>
    ),
  },
];

const providerRequirements = (): FieldItem[] => [
  {
    name: "READ COMMITTED transactions",
    description: (
      <>
        <code>withTransaction</code> opens every transaction at READ COMMITTED, whatever the session
        default; see <a href="#isolation-level">Isolation levels</a>.
      </>
    ),
  },
  {
    name: "Single statements",
    description: (
      <>
        Never enable <code>multipleStatements</code> on the pool the provider uses.
      </>
    ),
  },
];

const Page = () => (
  <>
    <p>
      <code>@queuert/mysql</code> stores chains, jobs and workers in MySQL or MariaDB (InnoDB), in
      the same transactions as your application's data. One adapter covers both servers; its{" "}
      <code>dialect</code> option selects the server. Workers claim jobs with{" "}
      <code>FOR UPDATE SKIP LOCKED</code>, so several workers can share one database; see{" "}
      <a href={siteHref("/guides/horizontal-scaling/")}>Horizontal Scaling</a>.
    </p>
    <ExperimentalAside package="@queuert/mysql" />

    <AtAGlance
      package="@queuert/mysql"
      clients="mysql2, mariadb, Bun SQL, Drizzle, Kysely, Prisma, Knex, MikroORM"
      isolation={
        <>
          READ COMMITTED, REPEATABLE READ or SERIALIZABLE; see{" "}
          <a href="#isolation-level">Isolation levels</a>
        </>
      }
      pairsWith={[
        { label: "Redis notify adapter", href: "/integrations/notify-adapters/redis/" },
        { label: "NATS notify adapter", href: "/integrations/notify-adapters/nats/" },
      ]}
    />

    <h2>Quick start</h2>
    <ClientTiles
      adapterPackage="@queuert/mysql"
      syncKey="mysql-driver"
      anchor="quick-start"
      groups={[
        {
          label: "Drivers",
          items: [
            { name: "mysql2", tab: "mysql2", packages: "mysql2" },
            { name: "mariadb", tab: "mariadb", packages: "mariadb" },
            { name: "Bun SQL", tab: "Bun SQL", packages: "built into Bun", badge: "Bun" },
          ],
        },
        {
          label: "ORMs and query builders",
          items: [
            { name: "Drizzle", tab: "Drizzle", packages: "drizzle-orm · mysql2" },
            { name: "Kysely", tab: "Kysely", packages: "kysely · mysql2" },
            {
              name: "Prisma",
              tab: "Prisma",
              packages: "@prisma/client · @prisma/adapter-mariadb",
            },
            { name: "Knex", tab: "Knex", packages: "knex · mysql2" },
            { name: "MikroORM", tab: "MikroORM", packages: "@mikro-orm/mysql · kysely" },
          ],
        },
      ]}
    />
    <p>
      Requires MySQL 8.4 or later or MariaDB 11.4 or later, with InnoDB tables. MySQL and MariaDB
      have no <code>LISTEN</code>/<code>NOTIFY</code>, so the package has no notify adapter: pair it
      with the <a href={siteHref("/integrations/notify-adapters/redis/")}>Redis</a> or{" "}
      <a href={siteHref("/integrations/notify-adapters/nats/")}>NATS</a> notify adapter, or run
      without one and let workers poll.
    </p>
    <p>
      Pick a driver to see its <code>MysqlStateProvider</code> (<code>provider.ts</code>, copy it)
      and the lines that create the adapter:
    </p>
    <Tabs syncKey="mysql-driver" pickedElsewhere>
      <TabItem label="mysql2">
        <CappedCode>
          <ExampleCode example="mysql/state-mysql2" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="mysql/state-mysql2"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="mariadb">
        <CappedCode>
          <ExampleCode example="mysql/state-mariadb" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="mysql/state-mariadb"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <CappedCode>
          <ExampleCode example="mysql/state-bun-sql" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="mysql/state-bun-sql"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <CappedCode>
          <ExampleCode example="mysql/state-drizzle" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="mysql/state-drizzle"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <CappedCode>
          <ExampleCode example="mysql/state-kysely" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="mysql/state-kysely"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <CappedCode>
          <ExampleCode example="mysql/state-prisma" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="mysql/state-prisma"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <CappedCode>
          <ExampleCode example="mysql/state-knex" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="mysql/state-knex"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="MikroORM">
        <CappedCode>
          <ExampleCode example="mysql/state-mikro-orm" file="src/provider.ts" />
        </CappedCode>
        <p>
          <code>skipTables</code> keeps MikroORM's schema diff from dropping Queuert's tables, which{" "}
          <code>migrateToLatest()</code> manages:
        </p>
        <ExampleCode
          example="mysql/state-mikro-orm"
          file="src/index.ts"
          region="orm"
          title="src/index.ts"
        />
        <ExampleCode
          example="mysql/state-mikro-orm"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
    </Tabs>
    <p>Every connection the adapter uses must meet these:</p>
    <FieldList title="connection requirements" items={requirements()} />
    <p>Your provider must also meet these:</p>
    <FieldList title="provider requirements" items={providerRequirements()} />

    <h2>Run on your machine</h2>
    <RunOnYourMachine example="mysql/state-mysql2" needs="a MySQL or MariaDB server" />

    <h2>Configure</h2>
    <FieldList title="createMysqlStateAdapter" idPrefix="option" items={mainOptions()} />
    <Details summary="More options" hint={`${moreOptions().length} options`}>
      <FieldList title="More options" idPrefix="option" items={moreOptions()} />
      <Code lang="ts">{`
        const stateAdapter = createMysqlStateAdapter({
          stateProvider,
          dialect: "mariadb",
          maxBlockersPerJob: 500,
        });
      `}</Code>
      <StateAdapterConfigNote />
    </Details>

    <h2>Reference</h2>
    <FoldGroup>
      <Details summary={<span id="schema">Schema</span>} hint={`${mysqlTables.length} tables`}>
        <p>
          The adapter creates its schema via <code>migrateToLatest()</code>, in the connection's
          database or the configured <code>schema</code>, with a table name prefix (default:{" "}
          <code>queuert_</code>, shown as <code>{"{prefix}"}</code>). DDL commits implicitly on both
          servers, so no migration is atomic: every schema statement is idempotent, and a run that
          stopped partway resumes where it stopped.
        </p>
        <p>
          Type names, deduplication keys and text ids use an exact, NO PAD binary collation (
          <code>utf8mb4_0900_bin</code> on MySQL, <code>utf8mb4_nopad_bin</code> on MariaDB), so
          values that differ only in case, accents or trailing spaces stay distinct. Timestamps are{" "}
          <code>DATETIME(6)</code> in UTC, whatever the server's or the session's time zone.
        </p>
        <p>
          The migrator behind <code>migrateToLatest()</code> is exported for your own tables too;
          see <a href={siteHref("/guides/application-migrations/")}>Application Migrations</a>.
        </p>
        <SchemaTables tables={mysqlTables} />
      </Details>
      <Details summary={<span id="indexes">Indexes</span>} hint={`${mysqlIndexes.length} indexes`}>
        <SchemaIndexes indexes={mysqlIndexes} />
      </Details>
      <Details
        summary={<span id="state-provider">State provider</span>}
        hint={`${stateProviderMembers("mysql").length} members`}
      >
        <p>
          A <code>MysqlStateProvider</code> bridges your database client with the adapter: the
          adapter runs all its SQL and transactions through it. Each Quick start tab is a complete
          provider for its driver or ORM; to use another client, implement the same members:
        </p>
        <FieldList
          title="MysqlStateProvider"
          idPrefix="provider"
          items={stateProviderMembers("mysql")}
        />
        <p>
          mysql2 and the mariadb connector keep no transaction flag, so their examples'{" "}
          <code>getTransaction</code> tracks the connections its <code>withTransaction</code>{" "}
          opened. It keys on the connection rather than the context object, because Queuert passes
          copies of the context back to the provider.
        </p>
      </Details>
      <Details summary={<span id="isolation-level">Isolation levels</span>}>
        <p>
          The transactions you pass to <code>applyJobOutcome</code>, <code>fenceJob</code> and
          client methods can run at READ COMMITTED, REPEATABLE READ (InnoDB's default) or
          SERIALIZABLE, set as the session default or per transaction, and transactions at different
          levels can work on the same jobs at once. Whenever one transaction acts on what another
          may be changing, both write or lock the same row, and every read that decides such a write
          is a locking read, which sees the latest committed row at any level: attaching a
          dependent, completing its blocker and deleting the blocker all lock the blocker's head
          job.
        </p>
        <ul>
          <li>
            The transactions Queuert opens itself, through the provider's{" "}
            <code>withTransaction</code>, stay at READ COMMITTED whatever the session default, and
            the single statements it runs outside a transaction run at the connection's default
            level. At REPEATABLE READ, a claim on a drained queue takes gap locks that stall every
            insert of a new due job until it commits.
          </li>
          <li>
            Queuert retries the transactions and statements it runs itself, such as acquisition,
            lease renewal and reclaims, as{" "}
            <a href="#option-transactionRetry">
              <code>transactionRetry</code>
            </a>{" "}
            configures, when the provider's <code>classifyError</code> reports the failure as{" "}
            <code>transaction_conflict</code>: a deadlock (1213), or a snapshot conflict (1020).
          </li>
          <li>
            The transactions you pass raise them to you. SERIALIZABLE turns plain reads into share
            locks, so expect more lock waits and deadlocks. Retry them with fresh{" "}
            <code>txHooks</code> for each try, or inside{" "}
            <a href={siteHref("/guides/tx-hooks/#drivers-that-rerun-the-callback")}>
              <code>txHooks.retryBoundary</code>
            </a>
            .
          </li>
          <li>
            On MariaDB with <code>innodb_snapshot_isolation</code> on (the default from 11.6), a
            transaction at REPEATABLE READ or SERIALIZABLE that locks or writes a row changed after
            its snapshot fails with 1020, even when the change is harmless, such as a blocker
            completing while you attach a dependent to it. Pass transactions at READ COMMITTED, or
            turn the setting off, to avoid those retries.
          </li>
        </ul>
      </Details>
      <Details summary={<span id="lock-errors">Lock errors</span>}>
        <p>
          A deadlock (1213) rolls back the whole transaction. A lock wait timeout (1205) rolls back
          only the statement and leaves the transaction open with the earlier writes in it: roll
          back a transaction that saw one rather than commit it, or set{" "}
          <code>innodb_rollback_on_timeout=ON</code> so the server rolls it back. Queuert retries a
          deadlock in the work it runs itself (see <a href="#isolation-level">Isolation levels</a>);
          otherwise either error fails the Queuert call like any database error, so a failed attempt
          is rescheduled with backoff.
        </p>
      </Details>
      <Details summary={<span id="write-fence">Write fence</span>}>
        <p>
          Every insert, update or delete of a job, a blocker or a worker references an empty{" "}
          <code>{"{prefix}"}schema_fence_v2</code> table, the write fence of the adapter's schema
          version. A breaking migration, such as <code>002_schema_v2</code>, drops the fence tables
          of older versions, so code older than the schema fails each write with{" "}
          <code>SchemaFencedError</code> and changes nothing. <code>002_schema_v2</code> also
          converts <code>last_attempt_error</code> to plain text, so code older than it fails to
          read a job that holds an error. See{" "}
          <a href={siteHref("/integrations/state-adapters/#write-fence")}>Write fence</a> for what
          the fence means for a deployment.
        </p>
      </Details>
      <Details summary={<span id="testing-your-provider">Testing your provider</span>}>
        <p>
          <code>@queuert/mysql/conformance</code> checks a provider you write.{" "}
          <code>createMysqlStateProviderConformanceCases</code> returns the cases, ready to run:
          every case a state adapter must pass, the cases that hold two transactions open at once,
          checks of the schema write fence, and checks that <code>classifyError</code> reports a
          deadlock and that <code>withTransaction</code> opens transactions at READ COMMITTED. It
          also takes the <code>dialect</code>. To cover several session defaults (see{" "}
          <a href="#isolation-level">Isolation levels</a>), create the cases once per level, over
          providers whose connections default to it. The factory,{" "}
          <code>withNonTransactionContext</code>, the optional <code>withSavepoint</code> and the
          per-case adapter work as described in{" "}
          <a href={siteHref("/integrations/state-adapters/#testing-your-provider")}>
            Testing your provider
          </a>
          ; your test file owns the database in its own hooks and registers one test per case:
        </p>
        <Tabs syncKey="mysql-driver">
          <TabItem label="mysql2">
            <ExampleCode
              example="mysql/state-mysql2"
              file="src/provider.spec.ts"
              region="conformance"
              title="src/provider.spec.ts"
            />
          </TabItem>
          <TabItem label="mariadb">
            <ExampleCode
              example="mysql/state-mariadb"
              file="src/provider.spec.ts"
              region="conformance"
              title="src/provider.spec.ts"
            />
          </TabItem>
          <TabItem label="Bun SQL" badge="Bun">
            <ExampleCode
              example="mysql/state-bun-sql"
              file="src/provider.spec.ts"
              region="conformance"
              title="src/provider.spec.ts"
            />
          </TabItem>
          <TabItem label="Drizzle">
            <ExampleCode
              example="mysql/state-drizzle"
              file="src/provider.spec.ts"
              region="conformance"
              title="src/provider.spec.ts"
            />
          </TabItem>
          <TabItem label="Kysely">
            <ExampleCode
              example="mysql/state-kysely"
              file="src/provider.spec.ts"
              region="conformance"
              title="src/provider.spec.ts"
            />
          </TabItem>
          <TabItem label="Prisma">
            <ExampleCode
              example="mysql/state-prisma"
              file="src/provider.spec.ts"
              region="conformance"
              title="src/provider.spec.ts"
            />
          </TabItem>
          <TabItem label="Knex">
            <ExampleCode
              example="mysql/state-knex"
              file="src/provider.spec.ts"
              region="conformance"
              title="src/provider.spec.ts"
            />
          </TabItem>
          <TabItem label="MikroORM">
            <ExampleCode
              example="mysql/state-mikro-orm"
              file="src/provider.spec.ts"
              region="conformance"
              title="src/provider.spec.ts"
            />
          </TabItem>
        </Tabs>
        <p>
          The full API is in the{" "}
          <a href={siteHref("/api/mysql-conformance/readme/")}>conformance reference</a>.
        </p>
      </Details>
    </FoldGroup>

    <h2>Examples</h2>
    <ExampleRows
      commandsShownFor="mysql/state-mysql2"
      page="/integrations/state-adapters/mysql/"
      title="@queuert/mysql"
      names={[
        "mysql/state-mysql2",
        "mysql/state-mariadb",
        "mysql/state-bun-sql",
        "mysql/state-drizzle",
        "mysql/state-kysely",
        "mysql/state-prisma",
        "mysql/state-knex",
        "mysql/state-mikro-orm",
        "mysql/multi-worker",
      ]}
    />
    <p>
      The API reference for every export is in{" "}
      <a href={siteHref("/api/mysql/readme/")}>@queuert/mysql</a>.
    </p>
  </>
);

export default Page;
