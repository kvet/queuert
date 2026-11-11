import { describe, expectTypeOf, it } from "vitest";

import type { Migration } from "./migrator.ts";

type TxContext = { client: "transaction" };

describe("Migration", () => {
  it("passes the transaction context, never undefined, to `up` and `down` by default", () => {
    const migration: Migration<TxContext> = {
      name: "seed_invoices",
      up: async (txCtx) => {
        expectTypeOf(txCtx).toEqualTypeOf<TxContext>();
      },
      down: async (txCtx) => {
        expectTypeOf(txCtx).toEqualTypeOf<TxContext>();
      },
    };
    expectTypeOf(migration.name).toBeString();
  });

  it("passes the lease check, not a transaction context, for a non-transactional migration", () => {
    const migration: Migration<TxContext> = {
      name: "invoices_customer_idx",
      type: "non-transactional",
      up: async (context) => {
        expectTypeOf(context).toEqualTypeOf<{ assertLockHeld: () => void }>();
      },
      down: async () => {},
    };
    expectTypeOf(migration.name).toBeString();
  });

  it("requires a `down`", () => {
    // @ts-expect-error -- a migration that cannot be reverted throws from its `down`
    const migration: Migration<TxContext> = {
      name: "create_invoices",
      up: async () => {},
    };
    expectTypeOf(migration.name).toBeString();
  });

  it("rejects a SQL string as `up`", () => {
    const migration: Migration<TxContext> = {
      name: "create_invoices",
      // @ts-expect-error -- `up` is a function
      up: "CREATE TABLE invoices (id integer)",
      down: async () => {},
    };
    expectTypeOf(migration.name).toBeString();
  });
});
