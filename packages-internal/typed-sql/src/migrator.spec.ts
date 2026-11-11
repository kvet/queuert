import { describe, expect, it } from "vitest";

import {
  type Migration as GenericMigration,
  type MigrationStore,
  assertMigrationLockOptions,
  createMigrator,
} from "./migrator.ts";

type TxCtx = { tx: true };
type Migration = GenericMigration<TxCtx>;
type Store = MigrationStore<TxCtx>;

type RunEvent =
  | { kind: "begin" }
  | { kind: "commit" }
  | { kind: "rollback" }
  | { kind: "statement"; sql: string; inTx: boolean }
  | { kind: "record"; name: string; inTx: boolean }
  | { kind: "unrecord"; name: string; inTx: boolean }
  | { kind: "script"; name: string }
  | { kind: "acquire"; acquired: boolean }
  | { kind: "extend"; extended: boolean | "reject" }
  | { kind: "release" };

const harness = (
  options: {
    initiallyApplied?: string[];
    failStatementsFor?: string;
    lock?: {
      acquireResults?: boolean[];
      extendResults?: (boolean | "reject")[];
    };
  } = {},
) => {
  const events: RunEvent[] = [];
  const applied = new Set<string>(options.initiallyApplied ?? []);
  let acquireCursor = 0;
  let extendCursor = 0;
  const hooks: {
    beforeStatement: (statement: string) => Promise<void>;
    afterStatement: (statement: string) => Promise<void>;
  } = {
    beforeStatement: async () => {},
    afterStatement: async () => {},
  };

  const runStatement = async (statement: string, txCtx?: TxCtx): Promise<void> => {
    await hooks.beforeStatement(statement);
    events.push({ kind: "statement", sql: statement, inTx: txCtx !== undefined });
    if (options.failStatementsFor === statement) {
      throw new Error(`statement failed for ${statement}`);
    }
    await hooks.afterStatement(statement);
  };

  const tx = (name: string): Migration => ({
    name,
    up: async (txCtx) => runStatement(name, txCtx),
    down: async (txCtx) => runStatement(`undo ${name}`, txCtx),
  });
  const nonTx = (name: string): Migration => ({
    name,
    type: "non-transactional",
    up: async () => runStatement(name),
    down: async () => runStatement(`undo ${name}`),
  });

  const base: Store = {
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
    recordMigration: async (txCtx, name) => {
      events.push({ kind: "record", name, inTx: txCtx !== undefined });
      applied.add(name);
    },
    unrecordMigration: async (txCtx, name) => {
      events.push({ kind: "unrecord", name, inTx: txCtx !== undefined });
      applied.delete(name);
    },
  };

  const store: Store = options.lock
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

  return { events, applied, store, hooks, tx, nonTx };
};

const A = "001_alpha";
const B = "002_bravo";
const C = "003_charlie";
const BOOM = "004_boom";

describe("createMigrator", () => {
  describe("migrateToLatest", () => {
    it("runs a transactional migration's `up` and record inside one transaction", async () => {
      const { events, store, tx } = harness();
      const result = await createMigrator({ migrations: [tx(A)], store }).migrateToLatest();

      expect(result).toEqual({ skipped: [], applied: [A], reverted: [], unrecognized: [] });
      expect(events).toEqual([
        { kind: "begin" },
        { kind: "commit" },
        { kind: "begin" },
        { kind: "statement", sql: A, inTx: true },
        { kind: "record", name: A, inTx: true },
        { kind: "commit" },
      ]);
    });

    it("runs the `up` of a non-transactional migration outside a transaction and records it after", async () => {
      const { events, store, nonTx } = harness();
      const result = await createMigrator({ migrations: [nonTx(A)], store }).migrateToLatest();

      expect(result).toEqual({ skipped: [], applied: [A], reverted: [], unrecognized: [] });
      expect(events).toEqual([
        { kind: "begin" },
        { kind: "commit" },
        { kind: "statement", sql: A, inTx: false },
        { kind: "record", name: A, inTx: false },
      ]);
    });

    it("rolls back a failing transactional migration without recording it", async () => {
      const { events, applied, store, tx } = harness({ failStatementsFor: BOOM });
      await expect(
        createMigrator({ migrations: [tx(BOOM)], store }).migrateToLatest(),
      ).rejects.toThrow(/statement failed for/);
      expect(applied.has(BOOM)).toBe(false);
      expect(events).toContainEqual({ kind: "rollback" });
      expect(events.filter((e) => e.kind === "record")).toEqual([]);
    });

    it("does not record a non-transactional migration whose `up` throws", async () => {
      const { applied, store, nonTx } = harness({ failStatementsFor: A });
      await expect(
        createMigrator({ migrations: [nonTx(A)], store }).migrateToLatest(),
      ).rejects.toThrow(/statement failed for/);

      expect([...applied]).toEqual([]);
    });

    it("skips a transactional migration that another run recorded after the applied-set read", async () => {
      const { events, applied, store, tx } = harness();
      const getAppliedMigrationNames = store.getAppliedMigrationNames;
      store.getAppliedMigrationNames = async (txCtx) => {
        const names = await getAppliedMigrationNames(txCtx);
        applied.add(A);
        return names;
      };
      const result = await createMigrator({ migrations: [tx(A), tx(B)], store }).migrateToLatest();

      expect(result).toEqual({ skipped: [A], applied: [B], reverted: [], unrecognized: [] });
      expect(events.filter((e) => e.kind === "statement").map((e) => e.sql)).toEqual([B]);
    });

    it("skips already-recorded migrations and reports unrecognized DB names", async () => {
      const { store, tx } = harness({ initiallyApplied: [A, "legacy"] });
      const result = await createMigrator({
        migrations: [tx(A), tx(B)],
        store,
      }).migrateToLatest();
      expect(result).toEqual({
        skipped: [A],
        applied: [B],
        reverted: [],
        unrecognized: ["legacy"],
      });
    });

    it("names the failing migration, keeping the original error as the cause", async () => {
      const { store, tx } = harness({ failStatementsFor: B });
      const failure = await createMigrator({ migrations: [tx(A), tx(B)], store })
        .migrateToLatest()
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        'Migration "002_bravo" failed: statement failed for 002_bravo',
      );
      expect((failure as Error).cause).toEqual(new Error("statement failed for 002_bravo"));
    });

    it("stops at the first failing migration and preserves earlier applied ones", async () => {
      const { applied, store, tx } = harness({ failStatementsFor: B });
      await expect(
        createMigrator({ migrations: [tx(A), tx(B), tx(C)], store }).migrateToLatest(),
      ).rejects.toThrow(/statement failed for/);
      expect([...applied]).toEqual([A]);
    });
  });

  describe("before/after scripts", () => {
    it("runs `before` ahead of the applied-set read and `after` behind the last migration", async () => {
      const { events, applied, store, tx } = harness();
      const result = await createMigrator({
        migrations: [tx(A)],
        store,
        before: async () => void events.push({ kind: "script", name: "before" }),
        after: async () => void events.push({ kind: "script", name: "after" }),
      }).migrateToLatest();

      expect(result).toEqual({ skipped: [], applied: [A], reverted: [], unrecognized: [] });
      expect(events).toEqual([
        { kind: "script", name: "before" },
        { kind: "begin" },
        { kind: "commit" },
        { kind: "begin" },
        { kind: "statement", sql: A, inTx: true },
        { kind: "record", name: A, inTx: true },
        { kind: "commit" },
        { kind: "script", name: "after" },
      ]);
      expect([...applied]).toEqual([A]);
    });

    it("records nothing for a script itself", async () => {
      const { events, applied, store } = harness();
      await createMigrator({
        migrations: [],
        store,
        before: async () => void events.push({ kind: "script", name: "before" }),
        after: async () => void events.push({ kind: "script", name: "after" }),
      }).migrateToLatest();

      expect([...applied]).toEqual([]);
      expect(events.some((e) => e.kind === "record")).toBe(false);
    });

    it("does not run the migrations when `before` throws", async () => {
      const { events, applied, store, tx } = harness();
      await expect(
        createMigrator({
          migrations: [tx(A)],
          store,
          before: async () => {
            throw new Error("cannot upgrade");
          },
        }).migrateToLatest(),
      ).rejects.toThrow(/cannot upgrade/);

      expect([...applied]).toEqual([]);
      expect(events.some((e) => e.kind === "record")).toBe(false);
    });

    it("aborts a long-running script once the lease is lost", async () => {
      const { applied, store } = harness({
        lock: { extendResults: [false] },
      });
      await expect(
        createMigrator({
          migrations: [],
          store,
          lock: { heartbeatIntervalMs: 5 },
          after: async ({ assertLockHeld }) => {
            for (let batch = 0; batch < 10; batch++) {
              assertLockHeld();
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          },
        }).migrateToLatest(),
      ).rejects.toThrow(/no longer held by this run/);

      expect([...applied]).toEqual([]);
    });
  });

  describe("migration lock", () => {
    const stretchStatementsPastHeartbeat = (hooks: ReturnType<typeof harness>["hooks"]): void => {
      hooks.afterStatement = async () => new Promise((resolve) => setTimeout(resolve, 50));
    };

    it("acquires the lease before reading the applied set and releases it afterwards", async () => {
      const { events, store, tx } = harness({ lock: {} });
      const result = await createMigrator({ migrations: [tx(A)], store }).migrateToLatest();

      expect(result.applied).toEqual([A]);
      expect(events[0]).toEqual({ kind: "acquire", acquired: true });
      expect(events[1]).toEqual({ kind: "begin" });
      expect(events.at(-1)).toEqual({ kind: "release" });
    });

    it("polls until the lease is free, then sees the winner's work in the re-read applied set", async () => {
      const { events, applied, store, tx } = harness({
        lock: { acquireResults: [false, false, true] },
      });
      applied.add(A);
      const result = await createMigrator({
        migrations: [tx(A)],
        store,
        lock: { pollIntervalMs: 1 },
      }).migrateToLatest();

      expect(result).toEqual({ skipped: [A], applied: [], reverted: [], unrecognized: [] });
      expect(events.filter((e) => e.kind === "acquire")).toEqual([
        { kind: "acquire", acquired: false },
        { kind: "acquire", acquired: false },
        { kind: "acquire", acquired: true },
      ]);
    });

    it("heartbeats the lease while migrating", async () => {
      const { events, store, hooks, tx } = harness({ lock: {} });
      stretchStatementsPastHeartbeat(hooks);
      await createMigrator({
        migrations: [tx(A)],
        store,
        lock: { heartbeatIntervalMs: 5 },
      }).migrateToLatest();

      expect(events.some((e) => e.kind === "extend" && e.extended)).toBe(true);
    });

    it("aborts before the next migration when the lease is lost", async () => {
      const { events, applied, store, hooks, tx } = harness({
        lock: { extendResults: [false] },
      });
      stretchStatementsPastHeartbeat(hooks);
      await expect(
        createMigrator({
          migrations: [tx(A), tx(B)],
          store,
          lock: { heartbeatIntervalMs: 5 },
        }).migrateToLatest(),
      ).rejects.toThrow(/no longer held by this run/);

      expect([...applied]).toEqual([A]);
      expect(events.filter((e) => e.kind === "acquire")).toEqual([
        { kind: "acquire", acquired: true },
      ]);
      expect(events.filter((e) => e.kind === "extend")).toEqual([
        { kind: "extend", extended: false },
      ]);
      expect(events.at(-1)).toEqual({ kind: "release" });
    });

    it("passes the `up` of a non-transactional migration an assertLockHeld that throws once the lease is lost", async () => {
      const { applied, store } = harness({ lock: { extendResults: [false] } });
      await expect(
        createMigrator({
          migrations: [
            {
              name: A,
              type: "non-transactional",
              up: async ({ assertLockHeld }) => {
                for (let batch = 0; batch < 10; batch++) {
                  assertLockHeld();
                  await new Promise((resolve) => setTimeout(resolve, 20));
                }
              },
              down: async () => {},
            },
          ],
          store,
          lock: { heartbeatIntervalMs: 5 },
        }).migrateToLatest(),
      ).rejects.toThrow(/no longer held by this run/);

      expect([...applied]).toEqual([]);
    });

    it("does not record a non-transactional migration whose `up` outlasted the lease without checking it", async () => {
      const { applied, store } = harness({ lock: { extendResults: [false] } });
      await expect(
        createMigrator({
          migrations: [
            {
              name: A,
              type: "non-transactional",
              up: async () => new Promise((resolve) => setTimeout(resolve, 50)),
              down: async () => {},
            },
          ],
          store,
          lock: { heartbeatIntervalMs: 5 },
        }).migrateToLatest(),
      ).rejects.toThrow(/no longer held by this run/);

      expect([...applied]).toEqual([]);
    });

    it("waits for an in-flight heartbeat before releasing the lease", async () => {
      const { events, store, hooks, tx } = harness({ lock: {} });
      let signalExtendStarted!: () => void;
      const extendStarted = new Promise<void>((resolve) => {
        signalExtendStarted = resolve;
      });
      const extendMigrationLock = store.extendMigrationLock!;
      store.extendMigrationLock = async (ownerId, ttlMs) => {
        signalExtendStarted();
        await new Promise((resolve) => setTimeout(resolve, 40));
        return extendMigrationLock(ownerId, ttlMs);
      };
      hooks.beforeStatement = async () => extendStarted;
      await createMigrator({
        migrations: [tx(A)],
        store,
        lock: { heartbeatIntervalMs: 5 },
      }).migrateToLatest();
      const settled = events.length;
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(events.slice(-2)).toEqual([{ kind: "extend", extended: true }, { kind: "release" }]);
      expect(events).toHaveLength(settled);
    });

    it("renews a lease that went stale while a non-transactional migration ran, before recording it", async () => {
      const { applied, store, hooks, nonTx } = harness({ lock: {} });
      let openGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      const extendMigrationLock = store.extendMigrationLock!;
      store.extendMigrationLock = async (ownerId, ttlMs) => {
        await gate;
        return extendMigrationLock(ownerId, ttlMs);
      };
      hooks.afterStatement = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        openGate();
      };
      const result = await createMigrator({
        migrations: [nonTx(A)],
        store,
        lock: { ttlMs: 60, heartbeatIntervalMs: 10 },
      }).migrateToLatest();

      expect(result.applied).toEqual([A]);
      expect([...applied]).toEqual([A]);
    });

    it("renews a lease that went stale while its heartbeat waited on a long statement, before the next migration", async () => {
      const { events, store, hooks, tx } = harness({ lock: {} });
      let openGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      const extendMigrationLock = store.extendMigrationLock!;
      store.extendMigrationLock = async (ownerId, ttlMs) => {
        await gate;
        return extendMigrationLock(ownerId, ttlMs);
      };
      hooks.afterStatement = async (statement) => {
        if (statement === A) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          openGate();
        }
      };
      const result = await createMigrator({
        migrations: [tx(A), tx(B)],
        store,
        lock: { ttlMs: 60, heartbeatIntervalMs: 10 },
      }).migrateToLatest();

      expect(result.applied).toEqual([A, B]);
      expect(events.filter((e) => e.kind === "extend").length).toBeGreaterThanOrEqual(2);
    });

    it("runs one heartbeat at a time when extending outlasts the interval", async () => {
      const { store, hooks, tx } = harness({ lock: {} });
      let inFlight = 0;
      let maxInFlight = 0;
      const extendMigrationLock = store.extendMigrationLock!;
      store.extendMigrationLock = async (ownerId, ttlMs) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return extendMigrationLock(ownerId, ttlMs);
      };
      stretchStatementsPastHeartbeat(hooks);
      await createMigrator({
        migrations: [tx(A), tx(B)],
        store,
        lock: { heartbeatIntervalMs: 1 },
      }).migrateToLatest();

      expect(maxInFlight).toBe(1);
    });

    it("aborts when heartbeats keep failing past the lease TTL", async () => {
      const { applied, store, hooks, tx } = harness({
        lock: { extendResults: ["reject"] },
      });
      stretchStatementsPastHeartbeat(hooks);
      await expect(
        createMigrator({
          migrations: [tx(A), tx(B)],
          store,
          lock: { heartbeatIntervalMs: 5, ttlMs: 20 },
        }).migrateToLatest(),
      ).rejects.toThrow(/could not be extended in time/);

      expect([...applied]).toEqual([A]);
    });

    it("runs unlocked when the store provides no lock methods", async () => {
      const { events, store, tx } = harness();
      const result = await createMigrator({ migrations: [tx(A)], store }).migrateToLatest();
      expect(result.applied).toEqual([A]);
      expect(events.some((e) => e.kind === "acquire" || e.kind === "release")).toBe(false);
    });
  });

  describe("migrateTo", () => {
    it("applies only migrations up to and including the target", async () => {
      const { applied, store, tx } = harness();
      const migrator = createMigrator({ migrations: [tx(A), tx(B), tx(C)], store });

      const result = await migrator.migrateTo(B);
      expect(result.applied).toEqual([A, B]);
      expect([...applied]).toEqual([A, B]);
    });

    it("resumes from the last applied migration on a later target", async () => {
      const { store, tx } = harness({ initiallyApplied: [A] });
      const migrator = createMigrator({ migrations: [tx(A), tx(B), tx(C)], store });

      const result = await migrator.migrateTo(C);
      expect(result.skipped).toEqual([A]);
      expect(result.applied).toEqual([B, C]);
    });

    it("computes unrecognized against the full migration set, not the target prefix", async () => {
      const { store, tx } = harness({ initiallyApplied: ["legacy"] });
      const migrator = createMigrator({ migrations: [tx(A), tx(B)], store });

      const result = await migrator.migrateTo(A);
      expect(result).toEqual({
        skipped: [],
        applied: [A],
        reverted: [],
        unrecognized: ["legacy"],
      });
    });

    it("rejects a target that is not in the list before taking the lease", async () => {
      const { events, store, tx } = harness({ lock: {} });
      await expect(createMigrator({ migrations: [tx(A)], store }).migrateTo(B)).rejects.toThrow(
        /Unknown migration "002_bravo"/,
      );
      expect(events).toEqual([]);
    });

    it("reverts the applied migrations after the target, last first, each with its record in one transaction", async () => {
      const { events, applied, store, tx } = harness({ initiallyApplied: [A, B, C] });
      const result = await createMigrator({
        migrations: [tx(A), tx(B), tx(C)],
        store,
      }).migrateTo(A);

      expect(result).toEqual({ skipped: [A], applied: [], reverted: [C, B], unrecognized: [] });
      expect([...applied]).toEqual([A]);
      expect(events.slice(2)).toEqual([
        { kind: "begin" },
        { kind: "statement", sql: `undo ${C}`, inTx: true },
        { kind: "unrecord", name: C, inTx: true },
        { kind: "commit" },
        { kind: "begin" },
        { kind: "statement", sql: `undo ${B}`, inTx: true },
        { kind: "unrecord", name: B, inTx: true },
        { kind: "commit" },
      ]);
    });

    it("refuses a `null` target, changing nothing, when the database has migrations the code doesn't know", async () => {
      const { events, applied, store, tx } = harness({ initiallyApplied: [A, "legacy"] });
      await expect(createMigrator({ migrations: [tx(A)], store }).migrateTo(null)).rejects.toThrow(
        /applied migrations the code doesn't know: "legacy"/,
      );

      expect([...applied]).toEqual([A, "legacy"]);
      expect(events.some((e) => e.kind === "statement" || e.kind === "unrecord")).toBe(false);
    });

    it("reverts every applied migration with a `null` target", async () => {
      const { applied, store, tx } = harness({ initiallyApplied: [A, B] });
      const result = await createMigrator({ migrations: [tx(A), tx(B), tx(C)], store }).migrateTo(
        null,
      );

      expect(result).toEqual({ skipped: [], applied: [], reverted: [B, A], unrecognized: [] });
      expect([...applied]).toEqual([]);
    });

    it("runs `before` and `after` around a revert", async () => {
      const { events, store, tx } = harness({ initiallyApplied: [A, B] });
      await createMigrator({
        migrations: [tx(A), tx(B)],
        store,
        before: async () => void events.push({ kind: "script", name: "before" }),
        after: async () => void events.push({ kind: "script", name: "after" }),
      }).migrateTo(A);

      expect(events[0]).toEqual({ kind: "script", name: "before" });
      expect(events.at(-1)).toEqual({ kind: "script", name: "after" });
    });

    it("reverts a non-transactional migration outside a transaction, unrecording it last", async () => {
      const { events, store, tx, nonTx } = harness({ initiallyApplied: [A, B] });
      await createMigrator({ migrations: [tx(A), nonTx(B)], store }).migrateTo(A);

      expect(events.slice(2)).toEqual([
        { kind: "statement", sql: `undo ${B}`, inTx: false },
        { kind: "unrecord", name: B, inTx: false },
      ]);
    });

    it("keeps the record when a transactional `down` fails", async () => {
      const { applied, store, tx } = harness({
        initiallyApplied: [A, B],
        failStatementsFor: `undo ${B}`,
      });
      await expect(
        createMigrator({ migrations: [tx(A), tx(B)], store }).migrateTo(A),
      ).rejects.toThrow(
        'Reverting migration "002_bravo" failed: statement failed for undo 002_bravo',
      );

      expect([...applied]).toEqual([A, B]);
    });

    it("skips a transactional revert that another run made after the applied-set read", async () => {
      const { events, applied, store, tx } = harness({ initiallyApplied: [A, B] });
      const getAppliedMigrationNames = store.getAppliedMigrationNames;
      store.getAppliedMigrationNames = async (txCtx) => {
        const names = await getAppliedMigrationNames(txCtx);
        applied.delete(B);
        return names;
      };
      const result = await createMigrator({ migrations: [tx(A), tx(B)], store }).migrateTo(A);

      expect(result.reverted).toEqual([]);
      expect(events.some((e) => e.kind === "statement")).toBe(false);
    });

    it("stops reverting at a `down` that throws, keeping it and the migrations before it recorded", async () => {
      const { events, applied, store, tx } = harness({ initiallyApplied: [A, B, C] });
      const irreversible: Migration = {
        ...tx(B),
        down: async () => {
          throw new Error("cannot revert 002_bravo");
        },
      };
      await expect(
        createMigrator({ migrations: [tx(A), irreversible, tx(C)], store }).migrateTo(A),
      ).rejects.toThrow('Reverting migration "002_bravo" failed: cannot revert 002_bravo');

      expect([...applied]).toEqual([A, B]);
      expect(events.filter((e) => e.kind === "unrecord")).toEqual([
        { kind: "unrecord", name: C, inTx: true },
      ]);
    });

    it("refuses to revert, changing nothing, when the database has migrations the code doesn't know", async () => {
      const { events, applied, store, tx } = harness({ initiallyApplied: [A, B, "legacy"] });
      await expect(
        createMigrator({ migrations: [tx(A), tx(B)], store }).migrateTo(A),
      ).rejects.toThrow(/applied migrations the code doesn't know: "legacy"/);

      expect([...applied]).toEqual([A, B, "legacy"]);
      expect(events.some((e) => e.kind === "statement" || e.kind === "unrecord")).toBe(false);
    });
  });

  describe("validation", () => {
    it("accepts any unique names and runs them in list order", async () => {
      const { events, store, tx } = harness();
      const result = await createMigrator({
        migrations: [tx("create_invoices"), tx("add_invoice_due_date")],
        store,
      }).migrateToLatest();

      expect(result.applied).toEqual(["create_invoices", "add_invoice_due_date"]);
      expect(events.filter((e) => e.kind === "statement").map((e) => e.sql)).toEqual([
        "create_invoices",
        "add_invoice_due_date",
      ]);
    });

    it("rejects an empty migration name", () => {
      const { store, tx } = harness();
      expect(() => createMigrator({ migrations: [tx("")], store })).toThrow(
        /Invalid migration name/,
      );
    });

    it("rejects duplicate migration names", () => {
      const { store, tx } = harness();
      expect(() => createMigrator({ migrations: [tx(A), tx(A)], store })).toThrow(
        /Duplicate migration name "001_alpha"/,
      );
    });

    it("refuses to run when a pending migration is listed before an applied one", async () => {
      const { events, applied, store, tx } = harness({ initiallyApplied: [A, C] });
      await expect(
        createMigrator({ migrations: [tx(A), tx(B), tx(C)], store }).migrateToLatest(),
      ).rejects.toThrow(
        /Pending migrations are listed before the applied migration "003_charlie": "002_bravo"/,
      );

      expect([...applied]).toEqual([A, C]);
      expect(events.some((e) => e.kind === "statement" || e.kind === "record")).toBe(false);
    });

    it("accepts the default lease timing", () => {
      expect(() => {
        assertMigrationLockOptions("createMigrator", undefined);
      }).not.toThrow();
    });

    it("names every invalid lease timing", () => {
      expect(() => {
        assertMigrationLockOptions("createPgMigrator", { ttlMs: 0, pollIntervalMs: Number.NaN });
      }).toThrow(
        expect.objectContaining({
          name: "TypeError",
          message: [
            "createPgMigrator: invalid configuration:",
            "  - lock.ttlMs must be a positive finite number (got 0)",
            "  - lock.pollIntervalMs must be a positive finite number (got NaN)",
          ].join("\n"),
        }),
      );
    });

    it("rejects a heartbeat that is not below a third of the lease TTL", () => {
      expect(() => {
        assertMigrationLockOptions("createPgMigrator", {
          ttlMs: 10_000,
          heartbeatIntervalMs: 5_000,
        });
      }).toThrow(
        "lock.heartbeatIntervalMs must be below a third of lock.ttlMs (got 5000 and 10000)",
      );
    });

    it("derives the default heartbeat from a short lease TTL", () => {
      expect(() => {
        assertMigrationLockOptions("createPgMigrator", { ttlMs: 30_000 });
      }).not.toThrow();
    });

    it("rejects a heartbeat that is not positive and finite, or too long for a timer", () => {
      expect(() => {
        assertMigrationLockOptions("createPgMigrator", { heartbeatIntervalMs: -1 });
      }).toThrow("lock.heartbeatIntervalMs must be a positive finite number (got -1)");
      expect(() => {
        assertMigrationLockOptions("createPgMigrator", {
          ttlMs: 10_000_000_000,
          heartbeatIntervalMs: 3_000_000_000,
        });
      }).toThrow("lock.heartbeatIntervalMs must be at most 2147483647 (got 3000000000)");
    });

    it("rejects a store that provides only some of the lock methods at compile time", () => {
      const { store } = harness();
      // @ts-expect-error -- the lock methods are all-or-none; a partial set matches neither union branch.
      const partial: Store = {
        ...store,
        acquireMigrationLock: async () => true,
      };
      expect(partial.acquireMigrationLock).toBeDefined();
    });
  });
});
