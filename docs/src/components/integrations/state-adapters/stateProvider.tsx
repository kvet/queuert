import { A } from "@solidjs/router";

import type { FieldItem } from "../../FieldList.tsx";

/** Members of `PgStateProvider` / `SqliteStateProvider` / `MysqlStateProvider`, listed on each backend's page. */
export const stateProviderMembers = (dialect: "postgres" | "sqlite" | "mysql"): FieldItem[] => [
  {
    name: "withTransaction",
    description: (
      <>
        Manages connection acquisition and transaction lifecycle. The callback receives a
        transaction context representing an active transaction. A provider that carries{" "}
        <code>txHooks</code> in its context creates them here with <code>withTxHooks</code>, around
        the transaction, so they flush after COMMIT.
        {dialect === "mysql" ? (
          <>
            {" "}
            It runs <code>SET TRANSACTION ISOLATION LEVEL READ COMMITTED</code> and then{" "}
            <code>START TRANSACTION</code> on the same connection, with nothing between them; see{" "}
            <a href="#isolation-level">Isolation level</a>.
          </>
        ) : dialect === "postgres" ? (
          <>
            {" "}
            It states READ COMMITTED explicitly (<code>BEGIN ISOLATION LEVEL READ COMMITTED</code>,
            or the client's isolation-level option), so a higher{" "}
            <code>default_transaction_isolation</code> cannot apply; see{" "}
            <a href="#isolation-level">Isolation level</a>.
          </>
        ) : null}
      </>
    ),
  },
  {
    name: "isTransaction",
    description: (
      <>
        Reports whether a context is inside an open transaction, from the driver's own state and
        without a query. Mutating client methods reject a context that fails it, so passing a pool
        or the root ORM handle instead of the transaction throws instead of autocommitting each
        statement.
      </>
    ),
  },
  {
    name: "onTransactionCommit",
    description: (
      <>
        Runs a callback after the context's transaction commits, and awaits it before the call that
        opened the transaction settles. The client and the worker register every side effect (notify
        events, observability events) here. A provider over a client with transaction events, such
        as MikroORM, runs it from those events; any other provider carries <code>txHooks</code> in
        its transaction context and registers the callback on them. See{" "}
        <A href="/guides/tx-hooks/">Tx Hooks</A>.
      </>
    ),
  },
  {
    name: "onTransactionRollback",
    description: (
      <>
        Runs a callback synchronously when the context's transaction, or the savepoint the context
        belongs to, rolls back; the commit callbacks registered there never run. Implemented the
        same way as <code>onTransactionCommit</code>.
      </>
    ),
  },
  {
    name: "executeSql",
    description: (
      <>
        Executes SQL statements. When a transaction context is provided, uses that connection; when
        omitted, acquires and releases its own connection.{" "}
        {dialect === "mysql" ? (
          <>
            With an <code>id</code>, run the statement as a server-side prepared statement (mysql2's{" "}
            <code>execute</code>); without one, the text protocol (<code>query</code>) is fine.
            Placeholders are <code>?</code>. Never enable <code>multipleStatements</code>.
          </>
        ) : dialect === "postgres" ? (
          <>
            <code>readOnly</code> marks a statement that only reads; a provider may route it to a
            read replica or a separate reader pool.
          </>
        ) : (
          <>
            <code>readOnly</code> marks a statement that only reads; a provider may use it to pick
            between shared and exclusive locks or reader and writer connections.
          </>
        )}
      </>
    ),
  },
  {
    name: "classifyError",
    description: (
      <>
        Returns <code>{'{ kind: "undefined_table", tableName }'}</code> for a{" "}
        {dialect === "mysql" ? (
          <>
            missing-table error (<code>errno</code> 1146), with <code>tableName</code> set to the
            qualified <code>{"<database>.<table>"}</code> from the{" "}
            <code>{"Table '<database>.<table>' doesn't exist"}</code> message
          </>
        ) : dialect === "postgres" ? (
          <>
            missing-table error (SQLSTATE <code>42P01</code>; most drivers expose it as{" "}
            <code>code</code>), with <code>table</code> read from the{" "}
            <code>{'relation "<table>" does not exist'}</code> message
          </>
        ) : (
          <>
            <code>{"no such table: <table>"}</code> error, with <code>table</code> read from the
            message (wrappers such as Prisma report it in their own error fields)
          </>
        )}
        , and <code>undefined</code> for any other error, or when it cannot read the table name. The
        adapter uses it to turn a write that hit a dropped <a href="#write-fence">write fence</a>{" "}
        into <code>SchemaFencedError</code>.
      </>
    ),
  },
  {
    name: "close",
    chips: ["optional"],
    description:
      "Only needed when the provider owns resources beyond the client or pool you pass in. Must be idempotent.",
  },
];
