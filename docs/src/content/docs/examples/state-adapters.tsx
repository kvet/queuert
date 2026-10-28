import { A } from "@solidjs/router";

import { ExampleRows } from "../../../components/ExampleList.tsx";

export const meta = {
  title: "State Adapters",
  description: "One runnable example per PostgreSQL and SQLite driver or ORM.",
};

const Page = () => (
  <>
    <p>
      Each example implements the state provider for one driver or ORM in{" "}
      <code>src/provider.ts</code>, then creates a chain and completes its job inside application
      transactions in <code>src/index.ts</code>. Pick the one that matches your stack and copy its
      provider. Notifications use the in-process notify adapter throughout.
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
        "state-postgres-bun-sql",
      ]}
    />
    <h2 id="sqlite">SQLite</h2>
    <p>
      SQLite allows one writer at a time. Most examples create one <code>createAsyncRwLock()</code>,
      pass it to the provider, and hold its write lock around the transaction a handler passes to{" "}
      <code>complete</code>. The Kysely and Knex examples need no lock, because their size-1
      better-sqlite3 pool already serializes writers.
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
        "state-sqlite-bun-sqlite",
        "state-sqlite-bun-sql",
      ]}
    />
  </>
);

export default Page;
