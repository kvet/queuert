import { A } from "@solidjs/router";

import { ExampleRows } from "../../../components/ExampleList.tsx";

export const meta = {
  title: "State Adapters",
  description:
    "One runnable example per PostgreSQL, SQLite, MySQL / MariaDB and Redis driver or ORM, and a custom adapter.",
};

const Page = () => (
  <>
    <p>
      Each example implements the state provider for one driver or ORM in{" "}
      <code>src/provider.ts</code>, then creates a chain and completes its job inside application
      transactions in <code>src/index.ts</code>. Pick the one that matches your stack and copy its
      provider. The examples pass no notify adapter, so the client wakes its own worker runner in
      memory.
    </p>
    <h2 id="postgresql">PostgreSQL</h2>
    <p>
      Each example starts PostgreSQL in Docker. Running several workers against one database is
      shown in{" "}
      <A href="/examples/operations/#state-postgres-multi-worker">
        <code>state-postgres-multi-worker</code>
      </A>
      .
    </p>
    <ExampleRows
      title="@queuert/postgres"
      names={[
        "state-postgres-pg",
        "state-postgres-postgres-js",
        "state-postgres-drizzle",
        "state-postgres-kysely",
        "state-postgres-prisma",
        "state-postgres-knex",
        "state-postgres-mikro-orm",
        "state-postgres-bun-sql",
      ]}
    />
    <h2 id="sqlite">SQLite</h2>
    <p>
      SQLite allows one writer at a time. The better-sqlite3, node:sqlite, Drizzle and bun:sqlite
      examples run statements synchronously, so they implement a{" "}
      <code>SyncSqliteStateProvider</code>, get a synchronous adapter and client, and need no lock.
      The Prisma and Bun.SQL examples create one <code>createAsyncRwLock()</code>, pass it to the
      provider, and hold its write lock around the transaction a handler passes to{" "}
      <code>complete</code>. The Kysely, Knex and MikroORM examples need no lock, because their
      size-1 better-sqlite3 pool already serializes writers. Several worker processes sharing one
      SQLite file are shown in{" "}
      <A href="/examples/operations/#state-sqlite-multi-worker">
        <code>state-sqlite-multi-worker</code>
      </A>
      .
    </p>
    <ExampleRows
      title="@queuert/sqlite"
      names={[
        "state-sqlite-better-sqlite3",
        "state-sqlite-node-sqlite",
        "state-sqlite-drizzle",
        "state-sqlite-kysely",
        "state-sqlite-prisma",
        "state-sqlite-knex",
        "state-sqlite-mikro-orm",
        "state-sqlite-bun-sqlite",
        "state-sqlite-bun-sql",
      ]}
    />
    <h2 id="mysql">MySQL / MariaDB</h2>
    <p>
      The provider opens every transaction at READ COMMITTED, and the example connects with a
      default database selected, which the adapter requires.
    </p>
    <ExampleRows title="@queuert/mysql" names={["state-mysql-mysql2"]} />
    <h2 id="redis">Redis</h2>
    <p>
      The Redis state adapter is experimental. Its transactions are optimistic and may run their
      callback more than once, so each example logs from <code>onTransactionCommit</code>. Each
      example starts Redis in Docker; see{" "}
      <A href="/integrations/state-adapters/redis/">Redis State Adapter</A>.
    </p>
    <ExampleRows title="@queuert/redis" names={["state-redis-ioredis", "state-redis-redis"]} />
    <h2 id="custom">Custom</h2>
    <p>
      The example implements the <code>StateAdapter</code> interface from scratch over plain
      in-memory maps and validates it with the conformance cases in{" "}
      <code>src/state-adapter.spec.ts</code>, as described in{" "}
      <A href="/integrations/state-adapters/custom/">Custom State Adapter</A>.
    </p>
    <ExampleRows title="custom" names={["state-custom-memory"]} />
  </>
);

export default Page;
