import { type FieldItem } from "../../FieldList.tsx";

/** Members of `PgStateProvider` / `SqliteStateProvider`, listed on each backend's page. */
export const stateProviderMembers = (dialect: "postgres" | "sqlite"): FieldItem[] => [
  {
    name: "withTransaction",
    description:
      "Manages connection acquisition and transaction lifecycle. The callback receives a transaction context representing an active transaction.",
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
    name: "executeSql",
    description: (
      <>
        Executes SQL statements. When a transaction context is provided, uses that connection; when
        omitted, acquires and releases its own connection.{" "}
        {dialect === "postgres" ? (
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
    name: "close",
    chips: ["optional"],
    description:
      "Only needed when the provider owns resources beyond the client or pool you pass in. Must be idempotent.",
  },
];
