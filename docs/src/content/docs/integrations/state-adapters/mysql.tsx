import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { ClientTiles } from "../../../../components/integrations/ClientTiles.tsx";
import { ExperimentalAside } from "../../../../components/integrations/ExperimentalAside.tsx";
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
  description: "Store chains, jobs and workers in MySQL or MariaDB with mysql2.",
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
        the collation and the SQL forms that differ between the two, and{" "}
        <code>migrateToLatest()</code> checks it against the server.
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
        { label: "Drivers", items: [{ name: "mysql2", tab: "mysql2", packages: "mysql2" }] },
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
        <ExampleCode example="state-mysql-mysql2" file="src/provider.ts" />
        <ExampleCode
          example="state-mysql-mysql2"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
    </Tabs>
    <p>
      <code>migrateToLatest()</code> checks the connection before it creates the schema. It throws
      when the server's version is below the minimum, when the server is not the one{" "}
      <code>dialect</code> names, or when one of these does not hold:
    </p>
    <FieldList title="connection requirements" items={requirements()} />
    <p>Your provider must also meet these, which the adapter cannot check:</p>
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
      runs all its SQL and transactions through it. The Setup tab is a complete provider for mysql2;
      to use another client, implement the same members:
    </p>
    <FieldList
      title="MysqlStateProvider"
      idPrefix="provider"
      items={stateProviderMembers("mysql")}
    />
    <p>
      mysql2 keeps no transaction flag, so the example's <code>isTransaction</code> tracks the
      connections its <code>withTransaction</code> opened. It keys on the connection rather than the
      context object, because Queuert passes copies of the context back to the provider.
    </p>

    <h2 id="testing-your-provider">Testing your provider</h2>
    <p>
      <code>@queuert/mysql/conformance</code> checks a provider you write.{" "}
      <code>mysqlStateProviderConformanceCases</code> are every case a state adapter must pass, the
      cases that hold two transactions open at once, and checks of the schema write fence.{" "}
      <code>createMysqlStateProviderConformanceContext</code> prepares the context they run against:
      it takes a <code>createStateProvider</code> factory, the <code>dialect</code>, and a{" "}
      <code>withNonTransactionContext</code> that runs a callback with a context outside any
      transaction, and migrates the schema once. An optional <code>withSavepoint</code> adds the
      savepoint cases, as on <A href="/integrations/state-adapters/postgres/">PostgreSQL</A>. Your
      test file owns the database in its own hooks and registers one test per case:
    </p>
    <Tabs syncKey="mysql-driver">
      <TabItem label="mysql2">
        <ExampleCode
          example="state-mysql-mysql2"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
    </Tabs>
    <p>
      The full API is in the <A href="/api/mysql-conformance/readme/">conformance reference</A>.
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
      Every insert or update of a job, a blocker or a worker references an empty{" "}
      <code>{"{prefix}"}schema_fence_v1</code> table, the write fence of the adapter's schema
      version. A breaking migration drops the fence tables of older versions, so code older than the
      schema fails each write with <code>SchemaFencedError</code> and changes nothing. Reads and
      deletes still work.
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
    <SchemaTables dialect="mysql" />

    <h2>Indexes</h2>
    <SchemaIndexes dialect="mysql" />

    <h2>Examples</h2>
    <ExampleRows title="@queuert/mysql" names={["state-mysql-mysql2"]} />
    <p>
      The API reference for every export is in <A href="/api/mysql/readme/">@queuert/mysql</A>.
    </p>
  </>
);

export default Page;
