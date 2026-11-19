import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { ClientTiles } from "../../../../components/integrations/ClientTiles.tsx";
import { ExperimentalAside } from "../../../../components/integrations/ExperimentalAside.tsx";
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
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";

export const meta = {
  title: "MySQL / MariaDB State Adapter",
  description: "Store chains, jobs and workers in MySQL or MariaDB.",
};

const options = (): FieldItem[] => [
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
  {
    name: "tablePrefix",
    chips: [{ label: '"queuert_"', mono: true }],
    description: "Table name prefix for namespace isolation.",
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
        <code>withTransaction</code> opens every transaction at READ COMMITTED; see{" "}
        <a href="#isolation-level">Isolation level</a>.
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

const pipelining = (): FieldItem[] => [
  {
    name: "mariadb",
    chips: ["pipelined"],
    description: (
      <>
        <code>pipelining</code> is on by default, against MariaDB and MySQL servers alike. The
        provider opens its transactions with <code>SET autocommit = 0</code>.
      </>
    ),
  },
  {
    name: "mysql2",
    chips: ["one by one"],
    description: (
      <>
        The driver cannot pipeline, directly or under Drizzle, Kysely, Knex or MikroORM, so these
        providers run the batch statement by statement.
      </>
    ),
  },
  {
    name: "Prisma",
    chips: ["one by one"],
    description: (
      <>
        Interactive transactions with <code>@prisma/adapter-mariadb</code> chain their operations
        through a queue.
      </>
    ),
  },
  {
    name: "Bun SQL",
    chips: ["one by one"],
    description: (
      <>
        Bun runs the queries issued on one MySQL connection one at a time, so the provider runs the
        batch statement by statement.
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
      <A href="/guides/horizontal-scaling/">Horizontal Scaling</A>.
    </p>
    <ExperimentalAside package="@queuert/mysql" />

    <h2>Clients</h2>
    <ClientTiles
      syncKey="mysql-driver"
      anchor="setup"
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

    <h2>Install</h2>
    <Code lang="bash">{`npm install @queuert/mysql`}</Code>
    <p>
      Requires MySQL 8.4 or later or MariaDB 11.4 or later, with InnoDB tables. MySQL and MariaDB
      have no <code>LISTEN</code>/<code>NOTIFY</code>, so the package has no notify adapter: pair it
      with the <A href="/integrations/notify-adapters/redis/">Redis</A> or{" "}
      <A href="/integrations/notify-adapters/nats/">NATS</A> notify adapter, or run without one and
      let workers poll.
    </p>

    <h2>Setup</h2>
    <p>
      Each tab shows the example's <code>MysqlStateProvider</code> and the lines that create the
      adapter:
    </p>
    <Tabs syncKey="mysql-driver">
      <TabItem label="mysql2">
        <ExampleCode example="mysql/state-mysql2" file="src/provider.ts" />
        <ExampleCode
          example="mysql/state-mysql2"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="mariadb">
        <ExampleCode example="mysql/state-mariadb" file="src/provider.ts" />
        <ExampleCode
          example="mysql/state-mariadb"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode example="mysql/state-bun-sql" file="src/provider.ts" />
        <ExampleCode
          example="mysql/state-bun-sql"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode example="mysql/state-drizzle" file="src/provider.ts" />
        <ExampleCode
          example="mysql/state-drizzle"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode example="mysql/state-kysely" file="src/provider.ts" />
        <ExampleCode
          example="mysql/state-kysely"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode example="mysql/state-prisma" file="src/provider.ts" />
        <ExampleCode
          example="mysql/state-prisma"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode example="mysql/state-knex" file="src/provider.ts" />
        <ExampleCode
          example="mysql/state-knex"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="MikroORM">
        <ExampleCode example="mysql/state-mikro-orm" file="src/provider.ts" />
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

    <h2>Configuration</h2>
    <FieldList title="createMysqlStateAdapter" idPrefix="option" items={options()} />
    <Code lang="ts">{`
      const stateAdapter = createMysqlStateAdapter({
        stateProvider,
        dialect: "mariadb",
        maxBlockersPerJob: 500,
      });
    `}</Code>
    <StateAdapterConfigNote />

    <h2>State provider</h2>
    <p>
      A <code>MysqlStateProvider</code> bridges your database client with the adapter: the adapter
      runs all its SQL and transactions through it. Each Setup tab is a complete provider for its
      driver or ORM; to use another client, implement the same members:
    </p>
    <FieldList
      title="MysqlStateProvider"
      idPrefix="provider"
      items={stateProviderMembers("mysql")}
    />
    <p>
      mysql2 and the mariadb connector keep no transaction flag, so their examples'{" "}
      <code>isTransaction</code> tracks the connections its <code>withTransaction</code> opened. It
      keys on the connection rather than the context object, because Queuert passes copies of the
      context back to the provider.
    </p>

    <h2 id="testing-your-provider">Testing your provider</h2>
    <p>
      <code>@queuert/mysql/conformance</code> checks a provider you write.{" "}
      <code>createMysqlStateProviderConformanceCases</code> returns the cases, ready to run: every
      case a state adapter must pass, the cases that hold two transactions open at once, and checks
      of the schema write fence. It takes a <code>createStateProvider</code> factory, the{" "}
      <code>dialect</code>, and a <code>withNonTransactionContext</code> that runs a callback with a
      context outside any transaction, and migrates the schema once, before the first case. An
      optional <code>withSavepoint</code> adds the savepoint cases, as on{" "}
      <A href="/integrations/state-adapters/postgres/">PostgreSQL</A>. Your test file owns the
      database in its own hooks and registers one test per case:
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
      The full API is in the <A href="/api/mysql-conformance/readme/">conformance reference</A>.
    </p>

    <h2 id="pipelining">Pipelining</h2>
    <p>
      The adapter sends the statements of one operation whose parameters it knows up front to{" "}
      <code>executeStatements</code> as one batch. A provider whose client pipelines issues them all
      without waiting for each result, so the batch costs one round trip; any other provider runs it
      statement by statement, which is just as correct. The Setup providers:
    </p>
    <FieldList title="Pipelining by client" proseNames items={pipelining()} />
    <p>
      A provider that pipelines opens its transactions with <code>SET autocommit = 0</code> after{" "}
      <code>SET TRANSACTION ISOLATION LEVEL READ COMMITTED</code>, and restores{" "}
      <code>autocommit = 1</code> after COMMIT or ROLLBACK. A deadlock (1213) makes InnoDB roll back
      and end the transaction while the rest of the batch is still in flight. With{" "}
      <code>autocommit = 0</code> those statements open a new implicit transaction that the
      provider's ROLLBACK discards; after <code>START TRANSACTION</code> they would autocommit.
    </p>
    <p>
      The mariadb connector sends a statement's PREPARE together with its EXECUTE only to MariaDB
      servers (10.2.4 or later). Against a MySQL server, an EXECUTE whose statement the connector
      has not prepared yet waits for its PREPARE, while one already in its prepare cache goes out at
      once and can overtake it. A provider for MySQL servers therefore prepares the batch's
      statements first, all in one round trip, and then pipelines their EXECUTEs in order, as the
      mariadb example does.
    </p>

    <h2>Isolation level</h2>
    <p>
      Queuert supports only READ COMMITTED. This covers every transaction Queuert writes in,
      including the ones you pass to <code>complete</code> and to client methods. InnoDB's default
      is REPEATABLE READ, so open the transactions you pass to Queuert with{" "}
      <code>SET TRANSACTION ISOLATION LEVEL READ COMMITTED</code>, as the provider's{" "}
      <code>withTransaction</code> does. At REPEATABLE READ, a claim on a drained queue takes gap
      locks that stall every insert of a new due job until it commits.
    </p>

    <h2>Lock errors</h2>
    <p>
      A deadlock (1213) rolls back the whole transaction. A lock wait timeout (1205) rolls back only
      the statement and leaves the transaction open with the earlier writes in it: roll back a
      transaction that saw one rather than commit it, or set{" "}
      <code>innodb_rollback_on_timeout=ON</code> so the server rolls it back. Either error fails the
      Queuert call like any database error, so a failed attempt is rescheduled with backoff.
    </p>

    <h2>Write fence</h2>
    <p>
      Every insert, update or delete of a job, a blocker or a worker references an empty{" "}
      <code>{"{prefix}"}schema_fence_v2</code> table, the write fence of the adapter's schema
      version. A breaking migration, such as <code>002_schema_v2</code>, drops the fence tables of
      older versions, so code older than the schema fails each write with{" "}
      <code>SchemaFencedError</code> and changes nothing. <code>002_schema_v2</code> also converts{" "}
      <code>last_attempt_error</code> to plain text, so code older than it fails to read a job that
      holds an error.
    </p>

    <h2>Schema</h2>
    <p>
      The adapter creates its schema via <code>migrateToLatest()</code>, in the connection's
      database or the configured <code>schema</code>, with a table name prefix (default:{" "}
      <code>queuert_</code>, shown as <code>{"{prefix}"}</code>). DDL commits implicitly on both
      servers, so no migration is atomic: every schema statement is idempotent, and a run that
      stopped partway resumes where it stopped.
    </p>
    <p>
      Type names, deduplication keys and text ids use an exact, NO PAD binary collation (
      <code>utf8mb4_0900_bin</code> on MySQL, <code>utf8mb4_nopad_bin</code> on MariaDB), so values
      that differ only in case, accents or trailing spaces stay distinct. Timestamps are{" "}
      <code>DATETIME(6)</code> in UTC, whatever the server's or the session's time zone.
    </p>
    <p>
      The migrator behind <code>migrateToLatest()</code> is exported for your own tables too; see{" "}
      <A href="/guides/application-migrations/">Application Migrations</A>.
    </p>
    <SchemaTables tables={mysqlTables} />

    <h2>Indexes</h2>
    <SchemaIndexes indexes={mysqlIndexes} />

    <h2>Examples</h2>
    <ExampleRows
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
      The API reference for every export is in <A href="/api/mysql/readme/">@queuert/mysql</A>.
    </p>
  </>
);

export default Page;
