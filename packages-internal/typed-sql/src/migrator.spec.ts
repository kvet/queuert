import { describe, expect, it } from "vitest";

import { type Migration, type MigrationStore, createMigrator } from "./migrator.js";
import { sql } from "./sql.js";

type TxCtx = { tx: true };

type RunEvent =
  | { kind: "begin" }
  | { kind: "commit" }
  | { kind: "rollback" }
  | { kind: "statement"; sql: string; inTx: boolean }
  | { kind: "batch"; sql: string; inTx: boolean }
  | { kind: "record"; name: string; inTx: boolean }
  | { kind: "acquire"; acquired: boolean }
  | { kind: "extend"; extended: boolean | "reject" }
  | { kind: "release" };

const harness = (
  options: {
    initiallyApplied?: string[];
    failStatementsFor?: string;
    batchCounts?: Map<string, number[]>;
    lock?: {
      acquireResults?: boolean[];
      extendResults?: (boolean | "reject")[];
    };
  } = {},
) => {
  const events: RunEvent[] = [];
  const applied = new Set<string>(options.initiallyApplied ?? []);
  const batchCursors = new Map<string, number>();
  let acquireCursor = 0;
  let extendCursor = 0;

  const base: MigrationStore<TxCtx> = {
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
    executeMigrationStatement: async (txCtx, statement) => {
      events.push({ kind: "statement", sql: statement.sql, inTx: txCtx !== undefined });
      if (options.failStatementsFor === statement.sql) {
        throw new Error(`statement failed for ${statement.sql}`);
      }
    },
    executeBatchMigrationStatement: async (txCtx, statement) => {
      const key = statement.sql;
      events.push({ kind: "batch", sql: key, inTx: txCtx !== undefined });
      const counts = options.batchCounts?.get(key) ?? [0];
      const cursor = batchCursors.get(key) ?? 0;
      const count = counts[Math.min(cursor, counts.length - 1)];
      batchCursors.set(key, cursor + 1);
      return count;
    },
    recordMigration: async (txCtx, name) => {
      events.push({ kind: "record", name, inTx: txCtx !== undefined });
      applied.add(name);
    },
  };

  // The lock methods are all-or-none in the type, so the locked variant has to
  // be its own complete literal rather than a conditional spread.
  const store: MigrationStore<TxCtx> = options.lock
    ? {
        ...base,
        acquireMigrationLock: async () => {
          const results = options.lock?.acquireResults ?? [true];
          const acquired = results[Math.min(acquireCursor, results.length - 1)];
          acquireCursor += 1;
          events.push({ kind: "acquire", acquired });
          return acquired;
        },
        extendMigrationLock: async () => {
          const results = options.lock?.extendResults ?? [true];
          const extended = results[Math.min(extendCursor, results.length - 1)];
          extendCursor += 1;
          events.push({ kind: "extend", extended });
          if (extended === "reject") throw new Error("heartbeat connection failed");
          return extended;
        },
        releaseMigrationLock: async () => {
          events.push({ kind: "release" });
        },
      }
    : base;

  return { events, applied, store };
};

const A = "20240101000000_alpha";
const B = "20240201000000_bravo";
const C = "20240301000000_charlie";
const BOOM = "20240401000000_boom";

const tx = (name: string): Migration => ({
  name,
  type: "transactional",
  statements: [sql(name)],
});
const nonTx = (name: string): Migration => ({
  name,
  type: "non-transactional",
  statements: [sql(name)],
});
const batched = (name: string, ...stmts: string[]): Migration => ({
  name,
  type: "batched",
  statements: stmts.map((s) => sql(s)),
});

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
        { kind: "statement", sql: A, inTx: true },
        { kind: "record", name: A, inTx: true },
        { kind: "commit" },
      ]);
    });

    it("runs a non-transactional migration's statements outside any transaction", async () => {
      const { events, store } = harness();
      const result = await createMigrator({ migrations: [nonTx(A)], store }).migrateToLatest();

      expect(result).toEqual({ skipped: [], applied: [A], unrecognized: [] });
      expect(events).toEqual([
        { kind: "begin" },
        { kind: "commit" },
        { kind: "statement", sql: A, inTx: false },
        { kind: "record", name: A, inTx: false },
      ]);
    });

    it("loops each batched statement until it returns 0 affected rows, then records outside a transaction", async () => {
      const s1 = "backfill_a";
      const s2 = "backfill_b";
      const batchCounts = new Map([
        [s1, [1000, 500, 0]],
        [s2, [200, 0]],
      ]);
      const { events, store } = harness({ batchCounts });
      const result = await createMigrator({
        migrations: [batched(A, s1, s2)],
        store,
      }).migrateToLatest();

      expect(result).toEqual({ skipped: [], applied: [A], unrecognized: [] });
      expect(events).toEqual([
        { kind: "begin" },
        { kind: "commit" },
        { kind: "batch", sql: s1, inTx: false },
        { kind: "batch", sql: s1, inTx: false },
        { kind: "batch", sql: s1, inTx: false },
        { kind: "batch", sql: s2, inTx: false },
        { kind: "batch", sql: s2, inTx: false },
        { kind: "record", name: A, inTx: false },
      ]);
    });

    it("rolls back a failing transactional migration without recording it", async () => {
      const { events, applied, store } = harness({ failStatementsFor: BOOM });
      await expect(
        createMigrator({ migrations: [tx(BOOM)], store }).migrateToLatest(),
      ).rejects.toThrow(/statement failed for/);
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
      ).rejects.toThrow(/statement failed for/);
      expect([...applied]).toEqual([A]);
    });
  });

  describe("migration lock", () => {
    it("acquires the lease before reading the applied set and releases it afterwards", async () => {
      const { events, store } = harness({ lock: {} });
      const result = await createMigrator({ migrations: [tx(A)], store }).migrateToLatest();

      expect(result.applied).toEqual([A]);
      expect(events[0]).toEqual({ kind: "acquire", acquired: true });
      expect(events[1]).toEqual({ kind: "begin" });
      expect(events.at(-1)).toEqual({ kind: "release" });
    });

    it("polls until the lease is free, then sees the winner's work in the re-read applied set", async () => {
      const { events, applied, store } = harness({
        lock: { acquireResults: [false, false, true] },
      });
      // Simulates the winner finishing while this process waits.
      applied.add(A);
      const result = await createMigrator({
        migrations: [tx(A)],
        store,
        lock: { pollIntervalMs: 1 },
      }).migrateToLatest();

      expect(result).toEqual({ skipped: [A], applied: [], unrecognized: [] });
      expect(events.filter((e) => e.kind === "acquire")).toEqual([
        { kind: "acquire", acquired: false },
        { kind: "acquire", acquired: false },
        { kind: "acquire", acquired: true },
      ]);
    });

    it("heartbeats the lease while migrating", async () => {
      const { events, store } = harness({ lock: {} });
      const slow: Migration = {
        name: A,
        type: "transactional",
        statements: [sql(A)],
      };
      const baseExecute = store.executeMigrationStatement;
      store.executeMigrationStatement = async (txCtx, statement) => {
        await baseExecute(txCtx, statement);
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      await createMigrator({
        migrations: [slow],
        store,
        lock: { heartbeatIntervalMs: 5 },
      }).migrateToLatest();

      expect(events.some((e) => e.kind === "extend" && e.extended)).toBe(true);
    });

    it("aborts before the next migration when the lease is stolen", async () => {
      const { events, applied, store } = harness({
        lock: { acquireResults: [true, false], extendResults: [false] },
      });
      const baseExecute = store.executeMigrationStatement;
      store.executeMigrationStatement = async (txCtx, statement) => {
        await baseExecute(txCtx, statement);
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      await expect(
        createMigrator({
          migrations: [tx(A), tx(B)],
          store,
          lock: { heartbeatIntervalMs: 5 },
        }).migrateToLatest(),
      ).rejects.toThrow(/another process took over/);

      expect([...applied]).toEqual([A]);
      expect(events.at(-1)).toEqual({ kind: "release" });
    });

    it("re-claims a merely expired lease instead of aborting a healthy run", async () => {
      const { events, applied, store } = harness({
        lock: { extendResults: [false] },
      });
      const baseExecute = store.executeMigrationStatement;
      store.executeMigrationStatement = async (txCtx, statement) => {
        await baseExecute(txCtx, statement);
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      const result = await createMigrator({
        migrations: [tx(A), tx(B)],
        store,
        lock: { heartbeatIntervalMs: 5 },
      }).migrateToLatest();

      expect(result.applied).toEqual([A, B]);
      expect([...applied]).toEqual([A, B]);
      expect(events.filter((e) => e.kind === "acquire").length).toBeGreaterThan(1);
    });

    it("aborts when heartbeats keep failing past the lease TTL", async () => {
      const { applied, store } = harness({
        lock: { extendResults: ["reject"] },
      });
      const baseExecute = store.executeMigrationStatement;
      store.executeMigrationStatement = async (txCtx, statement) => {
        await baseExecute(txCtx, statement);
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      await expect(
        createMigrator({
          migrations: [tx(A), tx(B)],
          store,
          lock: { heartbeatIntervalMs: 5, ttlMs: 20 },
        }).migrateToLatest(),
      ).rejects.toThrow(/could not be extended within its TTL/);

      expect([...applied]).toEqual([A]);
    });

    it("checks the lease between non-transactional statements", async () => {
      const { events, applied, store } = harness({
        lock: { acquireResults: [true, false], extendResults: [false] },
      });
      const baseExecute = store.executeMigrationStatement;
      store.executeMigrationStatement = async (txCtx, statement) => {
        await baseExecute(txCtx, statement);
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      const m: Migration = {
        name: A,
        type: "non-transactional",
        statements: [sql("first"), sql("second")],
      };
      await expect(
        createMigrator({
          migrations: [m],
          store,
          lock: { heartbeatIntervalMs: 5 },
        }).migrateToLatest(),
      ).rejects.toThrow(/another process took over/);

      expect(events.filter((e) => e.kind === "statement").map((e) => e.sql)).toEqual(["first"]);
      expect(applied.size).toBe(0);
    });

    it("runs unlocked when the store provides no lock methods", async () => {
      const { events, store } = harness();
      const result = await createMigrator({ migrations: [tx(A)], store }).migrateToLatest();
      expect(result.applied).toEqual([A]);
      expect(events.some((e) => e.kind === "acquire" || e.kind === "release")).toBe(false);
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

    it("rejects a store that provides only some of the lock methods at compile time", () => {
      const { store } = harness();
      // @ts-expect-error -- the lock methods are all-or-none; a partial set matches neither union branch.
      const partial: MigrationStore<TxCtx> = {
        ...store,
        acquireMigrationLock: async () => true,
      };
      expect(partial.acquireMigrationLock).toBeDefined();
    });
  });
});
