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
  title: "SQLite State Adapter",
  description:
    "Store chains, jobs and workers in SQLite with better-sqlite3, node:sqlite, bun:sqlite, Bun SQL, Drizzle, Kysely, Prisma or Knex.",
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
    <ExperimentalAside package="@queuert/sqlite" />

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
          ],
        },
      ]}
    />

    <h2>Install</h2>
    <Code lang="bash">{`npm install @queuert/sqlite`}</Code>
    <p>Requires SQLite 3.42 or later.</p>

    <h2>Setup</h2>
    <p>
      Each tab shows the example's <code>SqliteStateProvider</code> and the lines that create the
      lock and the adapter:
    </p>
    <Tabs syncKey="sqlite-driver">
      <TabItem label="better-sqlite3">
        <ExampleCode example="state-sqlite-better-sqlite3" file="src/provider.ts" />
        <ExampleCode
          example="state-sqlite-better-sqlite3"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="node:sqlite">
        <ExampleCode example="state-sqlite-node-sqlite" file="src/provider.ts" />
        <ExampleCode
          example="state-sqlite-node-sqlite"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="bun:sqlite" badge="Bun">
        <ExampleCode example="state-sqlite-bun-sqlite" file="src/provider.ts" />
        <ExampleCode
          example="state-sqlite-bun-sqlite"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode example="state-sqlite-bun-sql" file="src/provider.ts" />
        <ExampleCode
          example="state-sqlite-bun-sql"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode example="state-sqlite-drizzle" file="src/provider.ts" />
        <ExampleCode
          example="state-sqlite-drizzle"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode example="state-sqlite-kysely" file="src/provider.ts" />
        <ExampleCode
          example="state-sqlite-kysely"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode example="state-sqlite-prisma" file="src/provider.ts" />
        <ExampleCode
          example="state-sqlite-prisma"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode example="state-sqlite-knex" file="src/provider.ts" />
        <ExampleCode
          example="state-sqlite-knex"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
    </Tabs>

    <h2>Configuration</h2>
    <FieldList title="createSqliteStateAdapter" idPrefix="option" items={options()} />
    <StateAdapterConfigNote />

    <h2>State provider</h2>
    <p>
      A <code>SqliteStateProvider</code> bridges your database client with the adapter: the adapter
      runs all its SQL and transactions through it. Each Setup tab is a complete provider for its
      driver or ORM; to use another client, implement the same members and serialize writes (see{" "}
      <a href="#asyncrwlock">AsyncRwLock</a>):
    </p>
    <FieldList
      title="SqliteStateProvider"
      idPrefix="provider"
      items={stateProviderMembers("sqlite")}
    />

    <h2 id="testing-your-provider">Testing your provider</h2>
    <p>
      <code>runSqliteStateProviderConformance</code> from <code>@queuert/sqlite/conformance</code>{" "}
      checks a provider you write. It builds the adapter over your provider, migrates it and
      truncates its tables before every case, then runs every case a state adapter must pass, and
      checks that <code>classifyError</code> names a missing table. Its fixture is{" "}
      <code>stateProvider</code>, an optional <code>withNonTransactionContext</code> that runs a
      callback with a context outside any transaction (cases that need it are skipped without it),
      and an optional <code>dispose</code>. The runner is framework-agnostic: it throws on failure,
      so embed it in a single <code>test()</code> block, as each example does:
    </p>
    <Tabs syncKey="sqlite-driver">
      <TabItem label="better-sqlite3">
        <ExampleCode
          example="state-sqlite-better-sqlite3"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="node:sqlite">
        <ExampleCode
          example="state-sqlite-node-sqlite"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="bun:sqlite" badge="Bun">
        <ExampleCode
          example="state-sqlite-bun-sqlite"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode
          example="state-sqlite-bun-sql"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode
          example="state-sqlite-drizzle"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode
          example="state-sqlite-kysely"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode
          example="state-sqlite-prisma"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode
          example="state-sqlite-knex"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
    </Tabs>

    <h2>Your transactions</h2>
    <p>
      Transactions you pass to <code>complete</code> or to client methods must be serialized with
      the worker's own statements the way the provider's <code>withTransaction</code> is, for
      example by holding its <a href="#asyncrwlock">AsyncRwLock</a> write lock:
    </p>
    <Tabs syncKey="sqlite-driver">
      <TabItem label="better-sqlite3">
        <ExampleCode
          example="state-sqlite-better-sqlite3"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="node:sqlite">
        <ExampleCode
          example="state-sqlite-node-sqlite"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="bun:sqlite" badge="Bun">
        <ExampleCode
          example="state-sqlite-bun-sqlite"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Bun SQL" badge="Bun">
        <ExampleCode
          example="state-sqlite-bun-sql"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Drizzle">
        <ExampleCode
          example="state-sqlite-drizzle"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Kysely">
        <ExampleCode
          example="state-sqlite-kysely"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Prisma">
        <ExampleCode
          example="state-sqlite-prisma"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="Knex">
        <ExampleCode
          example="state-sqlite-knex"
          file="src/index.ts"
          region="create-chain"
          title="src/index.ts"
        />
      </TabItem>
    </Tabs>

    <h2>AsyncRwLock</h2>
    <p>
      The providers add an application-level <code>AsyncRwLock</code> to prevent concurrent write
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
      connection for the whole transaction, as the Kysely and Knex examples do.
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
      The adapter creates its schema via <code>migrateToLatest()</code>. All table names use a
      configurable prefix (default: <code>queuert_</code>, shown as <code>{"{prefix}"}</code>). The{" "}
      <code>{"{prefix}"}write_lock</code> table is always empty: every migration transaction starts
      with a no-op write to it, which takes SQLite's write lock before the transaction reads
      anything, whatever <code>BEGIN</code> the provider sends. Reads that lock chains, jobs or
      workers inside a transaction make the same no-op write first.
    </p>
    <p>
      A database migrated by 0.17 is carried onto the schema by adding the{" "}
      <code>{"{prefix}"}schema_fence_v1</code> table, without touching job or worker rows, so 0.17
      workers can keep running while <code>migrateToLatest()</code> runs. A 0.16 database is
      refused: upgrade it with <code>@queuert/sqlite</code> 0.17 first.
    </p>
    <SchemaTables dialect="sqlite" />

    <h2>Indexes</h2>
    <SchemaIndexes dialect="sqlite" />

    <h2>Examples</h2>
    <ExampleRows
      title="@queuert/sqlite"
      names={[
        "state-sqlite-better-sqlite3",
        "state-sqlite-node-sqlite",
        "state-sqlite-bun-sqlite",
        "state-sqlite-bun-sql",
        "state-sqlite-drizzle",
        "state-sqlite-kysely",
        "state-sqlite-prisma",
        "state-sqlite-knex",
      ]}
    />
    <p>
      The API reference for every export is in <A href="/api/sqlite/readme/">@queuert/sqlite</A>.
    </p>
  </>
);

export default Page;
