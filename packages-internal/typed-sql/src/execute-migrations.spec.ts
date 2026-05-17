import { describe, expect, it } from "vitest";

import { type Migration, executeMigrations, sql } from "./index.js";

type TxCtx = { tx: true };

type RunEvent =
  | { kind: "begin" }
  | { kind: "commit" }
  | { kind: "rollback" }
  | { kind: "statements"; name: string; inTx: boolean }
  | { kind: "record"; name: string; inTx: boolean };

const stmt = (s: string) => ({ sql: sql(s) });

const runWith = async (
  migrations: Migration[],
  options: {
    initiallyApplied?: string[];
    failStatementsFor?: string;
    failRecordFor?: string;
  } = {},
) => {
  const events: RunEvent[] = [];
  const applied = new Set<string>(options.initiallyApplied ?? []);

  const runInTransaction = async <T>(fn: (txCtx: TxCtx) => Promise<T>): Promise<T> => {
    events.push({ kind: "begin" });
    try {
      const result = await fn({ tx: true });
      events.push({ kind: "commit" });
      return result;
    } catch (err) {
      events.push({ kind: "rollback" });
      throw err;
    }
  };

  const promise = executeMigrations<TxCtx>({
    migrations,
    runInTransaction,
    getAppliedMigrationNames: async () => [...applied],
    executeMigrationStatements: async (txCtx, migration) => {
      events.push({ kind: "statements", name: migration.name, inTx: txCtx !== undefined });
      if (options.failStatementsFor === migration.name) {
        throw new Error(`statements failed for ${migration.name}`);
      }
    },
    recordMigration: async (txCtx, name) => {
      events.push({ kind: "record", name, inTx: txCtx !== undefined });
      if (options.failRecordFor === name) {
        throw new Error(`record failed for ${name}`);
      }
      applied.add(name);
    },
  });

  return { events, applied, promise };
};

describe("executeMigrations", () => {
  it("runs a transactional migration with statements + record inside the same transaction", async () => {
    const m: Migration = { name: "a", transactional: true, statements: [stmt("create a")] };
    const { events, promise } = await runWith([m]);
    const result = await promise;

    expect(result).toEqual({ skipped: [], applied: ["a"], unrecognized: [] });
    expect(events).toEqual([
      { kind: "begin" }, // read previously-applied
      { kind: "commit" },
      { kind: "begin" }, // migration "a"
      { kind: "statements", name: "a", inTx: true },
      { kind: "record", name: "a", inTx: true },
      { kind: "commit" },
    ]);
  });

  it("runs a non-transactional migration with statements outside any transaction, record inside one", async () => {
    const m: Migration = { name: "a", transactional: false, statements: [stmt("create index a")] };
    const { events, promise } = await runWith([m]);
    const result = await promise;

    expect(result).toEqual({ skipped: [], applied: ["a"], unrecognized: [] });
    expect(events).toEqual([
      { kind: "begin" },
      { kind: "commit" },
      { kind: "statements", name: "a", inTx: false },
      { kind: "begin" },
      { kind: "record", name: "a", inTx: true },
      { kind: "commit" },
    ]);
  });

  it("rolls back a failing transactional migration without recording it", async () => {
    const m: Migration = { name: "boom", transactional: true, statements: [stmt("oops")] };
    const { events, applied, promise } = await runWith([m], { failStatementsFor: "boom" });

    await expect(promise).rejects.toThrow(/statements failed for boom/);
    expect(applied.has("boom")).toBe(false);
    expect(events).toContainEqual({ kind: "rollback" });
    expect(events.filter((e) => e.kind === "record")).toEqual([]);
  });

  it("does not record a non-transactional migration whose statements throw", async () => {
    const m: Migration = { name: "boom", transactional: false, statements: [stmt("oops")] };
    const { events, applied, promise } = await runWith([m], { failStatementsFor: "boom" });

    await expect(promise).rejects.toThrow(/statements failed for boom/);
    expect(applied.has("boom")).toBe(false);
    expect(events.filter((e) => e.kind === "record")).toEqual([]);
  });

  it("skips migrations already recorded and reports unrecognized names from the DB", async () => {
    const a: Migration = { name: "a", transactional: true, statements: [stmt("a")] };
    const b: Migration = { name: "b", transactional: true, statements: [stmt("b")] };
    const { events, promise } = await runWith([a, b], { initiallyApplied: ["a", "legacy"] });
    const result = await promise;

    expect(result).toEqual({ skipped: ["a"], applied: ["b"], unrecognized: ["legacy"] });
    expect(events.filter((e) => e.kind === "statements")).toEqual([
      { kind: "statements", name: "b", inTx: true },
    ]);
  });

  it("stops at the first failing migration and preserves earlier applied ones", async () => {
    const a: Migration = { name: "a", transactional: true, statements: [stmt("a")] };
    const b: Migration = { name: "b", transactional: true, statements: [stmt("b")] };
    const c: Migration = { name: "c", transactional: true, statements: [stmt("c")] };
    const { applied, promise } = await runWith([a, b, c], { failStatementsFor: "b" });

    await expect(promise).rejects.toThrow(/statements failed for b/);
    expect([...applied]).toEqual(["a"]);
  });
});
