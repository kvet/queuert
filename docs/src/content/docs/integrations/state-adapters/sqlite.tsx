import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { ClientTiles } from "../../../../components/integrations/ClientTiles.tsx";
import {
  SchemaIndexes,
  SchemaTables,
} from "../../../../components/integrations/state-adapters/SchemaTables.tsx";
import {
  sqliteIndexes,
  sqliteTables,
} from "../../../../components/integrations/state-adapters/sqlite.schema.ts";
import {
  StateAdapterConfigNote,
  stateAdapterConfigItems,
} from "../../../../components/integrations/state-adapters/stateAdapterConfig.tsx";
import { stateProviderMembers } from "../../../../components/integrations/state-adapters/stateProvider.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";
import { siteHref } from "../../../../docs/href.ts";

export const meta = {
  title: "SQLite State Adapter",
  description:
    "Store chains, jobs and workers in SQLite with better-sqlite3, node:sqlite, bun:sqlite, Bun SQL, Drizzle, Kysely, Prisma, Knex or MikroORM.",
};

const options = (): FieldItem[] => [
  {
    name: "stateProvider",
    chips: ["required"],
    description: (
      <>
        The <code>SqliteStateProvider</code> for your client; see{" "}
        <a href="#state-provider">State provider</a>.
      </>
    ),
  },
  {
    name: "tablePrefix",
    chips: [{ label: '"queuert_"', mono: true }],
    description: "Prefix of every table name.",
  },
  {
    name: "jobIdType",
    chips: [{ label: '"TEXT"', mono: true }],
    description: "Type of the job id columns.",
  },
  {
    name: "workerIdType",
    chips: [{ label: '"TEXT"', mono: true }],
    description: "Type of the worker id column.",
  },
  ...stateAdapterConfigItems(),
];

const Page = () => (
  <>
    <p>
      <code>@queuert/sqlite</code> is suitable for local development, CLI tools, and embedded
      applications. SQLite allows a single writer at a time, so all writes are serialized, so batch
      operations use sequential queries within a single transaction rather than writeable CTEs.
    </p>
    <h2>Clients</h2>
    <ClientTiles
      syncKey="sqlite-driver"
      anchor="setup"
      groups={[
        {
          label: "Drivers",
          items: [
            { name: "better-sqlite3", tab: "better-sqlite3", packages: "better-sqlite3" },
            { name: "node:sqlite", tab: "node:sqlite", packages: "built into Node.js" },
            { name: "bun:sqlite", tab: "bun:sqlite", packages: "built into Bun", badge: "Bun" },
            { name: "Bun SQL", tab: "Bun SQL", packages: "built into Bun", badge: "Bun" },
          ],
        },
        {
          label: "ORMs and query builders",
          items: [
            { name: "Drizzle", tab: "Drizzle", packages: "drizzle-orm · better-sqlite3" },
            { name: "Kysely", tab: "Kysely", packages: "kysely · better-sqlite3" },
            {
              name: "Prisma",
              tab: "Prisma",
              packages: "@prisma/client · @prisma/adapter-better-sqlite3 · better-sqlite3",
            },
            { name: "Knex", tab: "Knex", packages: "knex · better-sqlite3" },
            { name: "MikroORM", tab: "MikroORM", packages: "@mikro-orm/sqlite · kysely" },
          ],
        },
      ]}
    />

    <h2>Install</h2>
    <Code lang="bash">{`npm install @queuert/sqlite`}</Code>
    <p>
      Requires SQLite 3.42 or later, which <code>migrateToLatest()</code> checks against the version
      the driver bundles.
    </p>

    <h2>Setup</h2>
    <p>
      Each tab shows the example's provider and the lines that create the adapter. better-sqlite3,
      node:sqlite, bun:sqlite and Drizzle run statements synchronously, so their examples use a{" "}
      <a href="#synchronous-providers">synchronous provider</a>. Bun SQL and Prisma use an async{" "}
      <code>SqliteStateProvider</code> with an <a href="#asyncrwlock">AsyncRwLock</a>, and Kysely,
      Knex and MikroORM an async one whose single connection serializes writers:
    </p>
    <Tabs syncKey="sqlite-driver">
      <TabItem label="better-sqlite3">
        <ExampleCode example="sqlite/state-better-sqlite3" file="src/provider.ts" />
        <ExampleCode
          example="sqlite/state-better-sqlite3"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="node:sqlite">
        <ExampleCode example="sqlite/state-node-sqlite" file="src/provider.ts" />
        <ExampleCode
          example="sqlite/state-node-sqlite"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="bun:sqlite" badge="Bun">
        <ExampleCode example="sqlite/state-bun-sqlite" file="src/provider.ts" />
        <ExampleCode
          example="sqlite/state-bun-sqlite"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode example="sqlite/state-bun-sql" file="src/provider.ts" />
        <ExampleCode
          example="sqlite/state-bun-sql"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode example="sqlite/state-drizzle" file="src/provider.ts" />
        <ExampleCode
          example="sqlite/state-drizzle"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode example="sqlite/state-kysely" file="src/provider.ts" />
        <ExampleCode
          example="sqlite/state-kysely"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode example="sqlite/state-prisma" file="src/provider.ts" />
        <ExampleCode
          example="sqlite/state-prisma"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode example="sqlite/state-knex" file="src/provider.ts" />
        <ExampleCode
          example="sqlite/state-knex"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="MikroORM">
        <ExampleCode example="sqlite/state-mikro-orm" file="src/provider.ts" />
        <p>
          <code>skipTables</code> keeps MikroORM's schema diff from dropping Queuert's tables, which{" "}
          <code>migrateToLatest()</code> manages:
        </p>
        <ExampleCode
          example="sqlite/state-mikro-orm"
          file="src/index.ts"
          region="orm"
          title="src/index.ts"
        />
        <ExampleCode
          example="sqlite/state-mikro-orm"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
    </Tabs>

    <h2>Configuration</h2>
    <FieldList title="createSqliteStateAdapter" idPrefix="option" items={options()} />
    <StateAdapterConfigNote />
    <p>
      <code>stateProvider</code> also takes a <code>SqliteStateProvider</code> in the{" "}
      <code>"sync"</code> mode, with the same options (see{" "}
      <a href="#synchronous-providers">Synchronous providers</a>).
    </p>

    <h2>State provider</h2>
    <p>
      A <code>SqliteStateProvider</code> bridges your database client with the adapter: the adapter
      runs all its SQL and transactions through it. Each Setup tab is a complete provider for its
      driver or ORM; to use another client, implement the same members and serialize writes (see{" "}
      <a href="#asyncrwlock">AsyncRwLock</a>), or implement the synchronous variant (see{" "}
      <a href="#synchronous-providers">Synchronous providers</a>):
    </p>
    <FieldList
      title="SqliteStateProvider"
      idPrefix="provider"
      items={stateProviderMembers("sqlite")}
    />

    <h2 id="synchronous-providers">Synchronous providers</h2>
    <p>
      better-sqlite3, node:sqlite and bun:sqlite execute every statement synchronously. A{" "}
      <code>SqliteStateProvider</code> in the <code>"sync"</code> mode exposes that: it sets{" "}
      <code>sync: true</code>, <code>withTransaction</code> runs a synchronous callback and returns
      its value, <code>executeSql</code> returns rows, and the optional <code>close</code> returns
      nothing. Over it, <code>createSqliteStateAdapter</code> returns a <code>"sync"</code>{" "}
      <code>SqliteStateAdapter</code> whose methods and <code>migrateToLatest</code> return their
      results directly. The adapter's type follows the provider's type, so annotate the provider as{" "}
      <code>{'SqliteStateProvider<TTxContext, "sync">'}</code>: a provider object whose{" "}
      <code>sync</code> is typed as <code>boolean</code> gives an adapter typed for either mode.{" "}
      <code>createClient</code>, <code>createProcessors</code> and <code>createWorkerRunner</code>{" "}
      follow the state adapter's mode, so the client built over it is synchronous.
    </p>
    <p>
      That client's state-touching methods, such as <code>createChain</code>, and the attempt
      handler's <code>applyJobOutcome</code> and <code>fenceJob</code> return plain values and throw
      synchronously, so they run inside the driver's own transaction, such as{" "}
      <code>db.transaction(() =&gt; …)()</code>, and an error rolls it back. The provider's{" "}
      <code>onTransactionCommit</code> and <code>onTransactionRollback</code> are synchronous too; a
      provider without transaction events of its own carries{" "}
      <a href={siteHref("/guides/tx-hooks/#synchronous-transactions")}>
        <code>TxHooks</code>
      </a>{" "}
      in its context. <code>awaitChain</code>, <code>awaitChains</code>, the attempt handler and the
      worker runner stay async. When you pass no notify adapter, the client uses an in-process one.
    </p>
    <p>
      A synchronous transaction cannot interleave with anything else on the thread, so a synchronous
      provider takes no lock. It guards the one remaining hazard, a raw <code>BEGIN</code> held
      across an <code>await</code>: <code>executeSql</code> without <code>txCtx</code> throws when
      the connection is already inside a transaction, instead of running inside someone else's. This
      also rejects a client read without a context inside your own transaction; pass that
      transaction's context.
    </p>

    <h2 id="testing-your-provider">Testing your provider</h2>
    <p>
      <code>@queuert/sqlite/conformance</code> checks a provider you write.{" "}
      <code>createSqliteStateProviderConformanceCases</code> returns the cases, ready to run: every
      case a state adapter must pass, checks of the schema write fence, and checks that{" "}
      <code>classifyError</code> names a missing table. It takes the provider's <code>mode</code>, a{" "}
      <code>createStateProvider</code> factory and a <code>withNonTransactionContext</code> that
      runs a callback with a context outside any transaction, and migrates the schema once, before
      the first case. An optional <code>withSavepoint</code> runs a callback in a savepoint of a
      transaction, opened the way your application opens one, and passes it the savepoint's context;
      when you give it, the cases check that <code>onTransactionCommit</code> and{" "}
      <code>onTransactionRollback</code> follow savepoints. Each case then builds its own adapter
      over a new provider from your factory, with the tables cleared, and closes both when it ends.
      The suite drives no test runner: your test file owns the database in its own hooks and
      registers one test per case. With <code>mode: "async"</code> the cases also include those that
      hold a transaction open across an <code>await</code>. The node:sqlite example runs under{" "}
      <code>node:test</code>, the Bun examples under <code>bun:test</code> and the others under
      vitest. With <code>mode: "sync"</code>, a <code>createStateProvider</code> that returns the
      provider directly, a synchronous <code>withNonTransactionContext</code> and an optional
      synchronous <code>withSavepoint</code>, the cases run synchronously through the adapter over
      it and add cases for the synchronous contract, including the autocommit guard:
    </p>
    <Tabs syncKey="sqlite-driver">
      <TabItem label="better-sqlite3">
        <ExampleCode
          example="sqlite/state-better-sqlite3"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="node:sqlite">
        <ExampleCode
          example="sqlite/state-node-sqlite"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="bun:sqlite" badge="Bun">
        <ExampleCode
          example="sqlite/state-bun-sqlite"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode
          example="sqlite/state-bun-sql"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode
          example="sqlite/state-drizzle"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode
          example="sqlite/state-kysely"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode
          example="sqlite/state-prisma"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode
          example="sqlite/state-knex"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="MikroORM">
        <ExampleCode
          example="sqlite/state-mikro-orm"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
    </Tabs>
    <p>
      The full API is in the{" "}
      <a href={siteHref("/api/sqlite-conformance/readme/")}>conformance reference</a>.
    </p>

    <h2>Your transactions</h2>
    <p>
      With a synchronous provider, call the client and a handler's <code>applyJobOutcome</code>{" "}
      inside the driver's own transaction, wrapped in <code>withTxHooks</code>, and pass its{" "}
      <code>txHooks</code> in the context. With an async provider, transactions you pass to{" "}
      <code>applyJobOutcome</code> or to client methods must be serialized with the worker's own
      statements the way the provider's <code>withTransaction</code> is, for example by holding its{" "}
      <a href="#asyncrwlock">AsyncRwLock</a> write lock. They also supply the <code>txHooks</code>{" "}
      field the provider's context requires, created with <code>withTxHooks</code> around the
      transaction. The MikroORM provider takes them from MikroORM's transaction events and its
      single connection serializes writers, so a plain <code>em.transactional</code> needs neither:
    </p>
    <Tabs syncKey="sqlite-driver">
      <TabItem label="better-sqlite3">
        <ExampleCode
          example="sqlite/state-better-sqlite3"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="node:sqlite">
        <ExampleCode
          example="sqlite/state-node-sqlite"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="bun:sqlite" badge="Bun">
        <ExampleCode
          example="sqlite/state-bun-sqlite"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode
          example="sqlite/state-bun-sql"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode
          example="sqlite/state-drizzle"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode
          example="sqlite/state-kysely"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode
          example="sqlite/state-prisma"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode
          example="sqlite/state-knex"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="MikroORM">
        <ExampleCode
          example="sqlite/state-mikro-orm"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
    </Tabs>

    <h2>AsyncRwLock</h2>
    <p>
      Async providers add an application-level <code>AsyncRwLock</code> to prevent concurrent write
      access from async code within the same process while allowing reads to run in parallel. The
      lock is writer-preference and FIFO to prevent writer starvation: once a writer is queued, new
      readers wait.
    </p>
    <ul>
      <li>
        <strong>Outside a transaction</strong>: every SQL execution acquires the lock in the mode
        indicated by <code>readOnly</code>.
      </li>
      <li>
        <strong>Inside a transaction</strong>: the write lock was already acquired by whoever opened
        the transaction (<code>withTransaction</code>, or your own code as above), so individual
        operations skip it.
      </li>
    </ul>
    <p>
      Custom <code>SqliteStateProvider</code> implementations must serialize writes: use{" "}
      <code>createAsyncRwLock()</code>, or rely on a single-connection pool that holds its one
      connection for the whole transaction, as the Kysely, Knex and MikroORM examples do.
    </p>

    <h2>Write fence</h2>
    <p>
      Every insert, update or delete of a job, a blocker or a worker references an empty{" "}
      <code>{"{prefix}"}schema_fence_v2</code> table, the write fence of the adapter's schema
      version. A breaking migration, such as <code>002_schema_v2</code>, drops the fence tables of
      older versions, so code older than the schema fails each write with{" "}
      <code>SchemaFencedError</code> and changes nothing, instead of corrupting state.{" "}
      <code>002_schema_v2</code> also converts <code>last_attempt_error</code> to plain text, so
      code older than it fails to read a job that holds an error. Older workers report the errors
      through <code>workerError</code> and keep retrying. Stop them once you have deployed the newer
      version.
    </p>

    <h2>Schema</h2>
    <p>
      The adapter creates its schema via <code>migrateToLatest()</code>. All table names use a
      configurable prefix (default: <code>queuert_</code>, shown as <code>{"{prefix}"}</code>). The{" "}
      <code>{"{prefix}"}write_lock</code> table is always empty: every migration transaction starts
      with a no-op write to it, which takes SQLite's write lock before the transaction reads
      anything, whatever <code>BEGIN</code> the provider sends. Reads that lock chains, jobs or
      workers inside a transaction make the same no-op write first.
    </p>
    <p>
      The migrator behind <code>migrateToLatest()</code> is exported for your own tables too; see{" "}
      <a href={siteHref("/guides/application-migrations/")}>Application Migrations</a>.
    </p>
    <SchemaTables tables={sqliteTables} />

    <h2>Indexes</h2>
    <SchemaIndexes indexes={sqliteIndexes} />

    <h2>Examples</h2>
    <ExampleRows
      title="@queuert/sqlite"
      names={[
        "sqlite/state-better-sqlite3",
        "sqlite/state-node-sqlite",
        "sqlite/state-bun-sqlite",
        "sqlite/state-bun-sql",
        "sqlite/state-drizzle",
        "sqlite/state-kysely",
        "sqlite/state-prisma",
        "sqlite/state-knex",
        "sqlite/state-mikro-orm",
        "sqlite/multi-worker",
      ]}
    />
    <p>
      The API reference for every export is in{" "}
      <a href={siteHref("/api/sqlite/readme/")}>@queuert/sqlite</a>.
    </p>
  </>
);

export default Page;
