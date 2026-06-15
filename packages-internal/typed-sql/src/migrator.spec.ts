import { describe, expect, it } from "vitest";

import { type Migration, type MigrationStore, createMigrator } from "./migrator.js";
import { sql } from "./sql.js";

type TxCtx = { tx: true };

type RunEvent =
  | { kind: "begin" }
  | { kind: "commit" }
  | { kind: "rollback" }
  | { kind: "statements"; name: string; inTx: boolean }
  | { kind: "record"; name: string; inTx: boolean };

const stmt = (s: string) => ({ sql: sql(s) });

const harness = (
  options: {
    initiallyApplied?: string[];
    failStatementsFor?: string;
  } = {},
) => {
  const events: RunEvent[] = [];
  const applied = new Set<string>(options.initiallyApplied ?? []);

  const store: MigrationStore<TxCtx> = {
    runInTransaction: async (fn) => {
      events.push({ kind: "begin" });
      try {
        const result = await fn({ tx: true });
        events.push({ kind: "commit" });
        return result;
      } catch (err) {
        events.push({ kind: "rollback" });
        throw err;
      }
    },
    getAppliedMigrationNames: async () => [...applied],
    executeMigrationStatements: async (txCtx, migration) => {
      events.push({ kind: "statements", name: migration.name, inTx: txCtx !== undefined });
      if (options.failStatementsFor === migration.name) {
        throw new Error(`statements failed for ${migration.name}`);
      }
    },
    recordMigration: async (txCtx, name) => {
      events.push({ kind: "record", name, inTx: txCtx !== undefined });
      applied.add(name);
    },
  };

  return { events, applied, store };
};

const A = "20240101000000_alpha";
const B = "20240201000000_bravo";
const C = "20240301000000_charlie";
const BOOM = "20240401000000_boom";

const tx = (name: string): Migration => ({ name, transactional: true, statements: [stmt(name)] });

describe("createMigrator", () => {
  describe("migrateToLatest", () => {
    it("runs a transactional migration with statements + record inside one transaction", async () => {
      const { events, store } = harness();
      const result = await createMigrator({ migrations: [tx(A)], store }).migrateToLatest();

      expect(result).toEqual({ skipped: [], applied: [A], unrecognized: [] });
      expect(events).toEqual([
        { kind: "begin" },
        { kind: "commit" },
        { kind: "begin" },
        { kind: "statements", name: A, inTx: true },
        { kind: "record", name: A, inTx: true },
        { kind: "commit" },
      ]);
    });

    it("runs a non-transactional migration's statements outside any transaction, record inside one", async () => {
      const { events, store } = harness();
      const m: Migration = {
        name: A,
        transactional: false,
        statements: [stmt("create index a")],
      };
      const result = await createMigrator({ migrations: [m], store }).migrateToLatest();

      expect(result).toEqual({ skipped: [], applied: [A], unrecognized: [] });
      expect(events).toEqual([
        { kind: "begin" },
        { kind: "commit" },
        { kind: "statements", name: A, inTx: false },
        { kind: "begin" },
        { kind: "record", name: A, inTx: true },
        { kind: "commit" },
      ]);
    });

    it("rolls back a failing transactional migration without recording it", async () => {
      const { events, applied, store } = harness({ failStatementsFor: BOOM });
      await expect(
        createMigrator({ migrations: [tx(BOOM)], store }).migrateToLatest(),
      ).rejects.toThrow(/statements failed for/);
      expect(applied.has(BOOM)).toBe(false);
      expect(events).toContainEqual({ kind: "rollback" });
      expect(events.filter((e) => e.kind === "record")).toEqual([]);
    });

    it("skips already-recorded migrations and reports unrecognized DB names", async () => {
      const { store } = harness({ initiallyApplied: [A, "legacy"] });
      const result = await createMigrator({
        migrations: [tx(A), tx(B)],
        store,
      }).migrateToLatest();
      expect(result).toEqual({ skipped: [A], applied: [B], unrecognized: ["legacy"] });
    });

    it("stops at the first failing migration and preserves earlier applied ones", async () => {
      const { applied, store } = harness({ failStatementsFor: B });
      await expect(
        createMigrator({ migrations: [tx(A), tx(B), tx(C)], store }).migrateToLatest(),
      ).rejects.toThrow(/statements failed for/);
      expect([...applied]).toEqual([A]);
    });
  });

  describe("migrateTo", () => {
    it("applies only migrations up to and including the target name", async () => {
      const { applied, store } = harness();
      const migrator = createMigrator({ migrations: [tx(A), tx(B), tx(C)], store });

      const result = await migrator.migrateTo(B);
      expect(result.applied).toEqual([A, B]);
      expect([...applied]).toEqual([A, B]);
    });

    it("resumes from the last applied migration on a later target", async () => {
      const { store } = harness({ initiallyApplied: [A] });
      const migrator = createMigrator({ migrations: [tx(A), tx(B), tx(C)], store });

      const result = await migrator.migrateTo(C);
      expect(result.skipped).toEqual([A]);
      expect(result.applied).toEqual([B, C]);
    });

    it("computes unrecognized against the full migration set, not the target prefix", async () => {
      const { store } = harness({ initiallyApplied: ["legacy"] });
      const migrator = createMigrator({ migrations: [tx(A), tx(B)], store });

      const result = await migrator.migrateTo(A);
      expect(result).toEqual({ skipped: [], applied: [A], unrecognized: ["legacy"] });
    });
  });

  describe("validation", () => {
    it("rejects a migration name that does not match the timestamp pattern", () => {
      const { store } = harness();
      expect(() => createMigrator({ migrations: [tx("bad_name")], store })).toThrow(
        /Invalid migration name/,
      );
    });

    it("rejects migrations that are not in ascending order", () => {
      const { store } = harness();
      expect(() => createMigrator({ migrations: [tx(B), tx(A)], store })).toThrow(
        /not in ascending order/,
      );
    });

    it("rejects duplicate migration names", () => {
      const { store } = harness();
      expect(() => createMigrator({ migrations: [tx(A), tx(A)], store })).toThrow(
        /not in ascending order/,
      );
    });
  });
});
