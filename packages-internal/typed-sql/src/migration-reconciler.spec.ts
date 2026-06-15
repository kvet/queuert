import { describe, expect, it } from "vitest";

import {
  type ColumnContract,
  type ReconcilerRow,
  createMigrationReconciler,
} from "./migration-reconciler.js";

const keyById = (row: ReconcilerRow): string => String(row.id);

/** A small fixture mirroring the shapes the real migrations touch. */
const initial: ReconcilerRow[] = [
  { id: "1", status: "pending", leased_until: null, chain_id: "1", chain_index: 0 },
  { id: "2", status: "blocked", leased_until: null, chain_id: "1", chain_index: 1 },
  {
    id: "3",
    status: "running",
    leased_until: new Date("2020-01-01T00:00:00Z"),
    chain_id: "3",
    chain_index: 0,
  },
];

/** Echoes the projection back unchanged — the identity-migration live read. */
const unchanged = (): ReconcilerRow[] => initial.map((row) => ({ ...row }));

describe("createMigrationReconciler", () => {
  it("passes an identity (index-only) migration that changes no cell", () => {
    const r = createMigrationReconciler("job", initial, keyById);
    expect(() => {
      r.reconcile("idx", {}, unchanged());
    }).not.toThrow();
  });

  it("fails a stray cell change, naming the column and key", () => {
    const r = createMigrationReconciler("job", initial, keyById);
    const live = unchanged();
    live[1].chain_index = 99; // a botched UPDATE
    expect(() => {
      r.reconcile("stray", {}, live);
    }).toThrow(/job\.chain_index@2 — cell-changed/);
  });

  it("accepts a declared add whose backfill satisfies its predicate, then tracks it", () => {
    const r = createMigrationReconciler("job", initial, keyById);
    const contract: ColumnContract = {
      add: [
        { column: "blocked", derive: (after, before) => after === (before.status === "blocked") },
      ],
    };
    const live = unchanged().map((row) => ({ ...row, blocked: row.status === "blocked" }));
    expect(() => {
      r.reconcile("add_blocked", contract, live);
    }).not.toThrow();
    expect(r.projection().get("2")?.blocked).toBe(true);
  });

  it("fails a declared add whose backfill is wrong", () => {
    const r = createMigrationReconciler("job", initial, keyById);
    const contract: ColumnContract = {
      add: [
        { column: "blocked", derive: (after, before) => after === (before.status === "blocked") },
      ],
    };
    const live = unchanged().map((row) => ({ ...row, blocked: false })); // never set true
    expect(() => {
      r.reconcile("add_blocked", contract, live);
    }).toThrow(/blocked@2 — predicate-failed/);
  });

  it("verifies a rename carried its data; fails when the rename loses it", () => {
    const ok = createMigrationReconciler("job", initial, keyById);
    const renamed = unchanged().map(({ leased_until, ...rest }) => ({
      ...rest,
      attempt_until: leased_until,
    }));
    expect(() => {
      ok.reconcile("rename", { rename: [{ from: "leased_until", to: "attempt_until" }] }, renamed);
    }).not.toThrow();
    expect(ok.projection().get("3")?.attempt_until).toEqual(new Date("2020-01-01T00:00:00Z"));

    const lost = createMigrationReconciler("job", initial, keyById);
    const dropped = unchanged().map(({ leased_until: _drop, ...rest }) => ({
      ...rest,
      attempt_until: null, // rename that silently dropped its values
    }));
    expect(() => {
      lost.reconcile(
        "rename",
        { rename: [{ from: "leased_until", to: "attempt_until" }] },
        dropped,
      );
    }).toThrow(/attempt_until@3 — cell-changed/);
  });

  it("accepts a declared drop but fails an undeclared disappearance", () => {
    const ok = createMigrationReconciler("job", initial, keyById);
    const withoutStatus = unchanged().map(({ status: _s, ...rest }) => rest);
    expect(() => {
      ok.reconcile("drop_status", { drop: ["status"] }, withoutStatus);
    }).not.toThrow();

    const undeclared = createMigrationReconciler("job", initial, keyById);
    expect(() => {
      undeclared.reconcile("oops", {}, withoutStatus);
    }).toThrow(/status@\d+ — undeclared-drop/);
  });

  it("flags an undeclared new column appearing in the live read", () => {
    const r = createMigrationReconciler("job", initial, keyById);
    const live = unchanged().map((row) => ({ ...row, surprise: 1 }));
    expect(() => {
      r.reconcile("oops", {}, live);
    }).toThrow(/surprise@\d+ — undeclared-add/);
  });

  it("handles a cross-row in-place backfill (continued_to_id from chain position)", () => {
    const r = createMigrationReconciler("job", initial, keyById);
    // continued_to_id = id of the same-chain row at chain_index + 1, else null.
    const contract: ColumnContract = {
      add: [
        {
          column: "continued_to_id",
          derive: (after, before, snapshot) => {
            const successor = [...snapshot.values()].find(
              (r2) =>
                r2.chain_id === before.chain_id &&
                Number(r2.chain_index) === Number(before.chain_index) + 1,
            );
            return after === (successor ? successor.id : null);
          },
        },
      ],
    };
    const successorOf = (row: ReconcilerRow): unknown =>
      initial.find(
        (r2) =>
          r2.chain_id === row.chain_id && Number(r2.chain_index) === Number(row.chain_index) + 1,
      )?.id ?? null;
    const live = unchanged().map((row) => ({ ...row, continued_to_id: successorOf(row) }));
    expect(() => {
      r.reconcile("backfill_continued", contract, live);
    }).not.toThrow();
    expect(r.projection().get("1")?.continued_to_id).toBe("2"); // chain 1, index 0 → index 1
    expect(r.projection().get("3")?.continued_to_id).toBe(null); // chain 3 has one row
  });

  it("handles a nondeterministic COALESCE(col, now()) envelope predicate", () => {
    const start = new Date("2021-06-01T00:00:00Z");
    const r = createMigrationReconciler("job", initial, keyById);
    const contract: ColumnContract = {
      add: [
        {
          column: "leased_at",
          derive: (after, before) => {
            const prior = before.leased_until;
            if (prior !== null) return equalDate(after, prior);
            return after instanceof Date && after.getTime() >= start.getTime();
          },
        },
      ],
    };
    const live = unchanged().map((row) => ({
      ...row,
      leased_at: row.leased_until ?? new Date("2021-06-01T00:00:05Z"),
    }));
    expect(() => {
      r.reconcile("backfill_leased_at", contract, live);
    }).not.toThrow();
  });

  it("reports a removed row", () => {
    const r = createMigrationReconciler("job", initial, keyById);
    const live = unchanged().filter((row) => row.id !== "2");
    expect(() => {
      r.reconcile("oops", {}, live);
    }).toThrow(/job@2 — row-removed/);
  });

  it("threads the projection so a later migration compares against the adopted baseline", () => {
    const r = createMigrationReconciler("job", initial, keyById);
    // 1) add blocked
    const afterAdd: ReconcilerRow[] = unchanged().map((row) => ({
      ...row,
      blocked: row.status === "blocked",
    }));
    r.reconcile("add_blocked", { add: [{ column: "blocked", derive: () => true }] }, afterAdd);
    // 2) drop status — projection now carries `blocked`, must still match
    const afterDrop = afterAdd.map(({ status: _s, ...rest }) => rest);
    expect(() => {
      r.reconcile("drop_status", { drop: ["status"] }, afterDrop);
    }).not.toThrow();
    expect(r.projection().get("2")).toEqual({
      id: "2",
      blocked: true,
      leased_until: null,
      chain_id: "1",
      chain_index: 1,
    });
  });

  it("supports a constant-value predicate for a deterministic default add", () => {
    const r = createMigrationReconciler("job", initial, keyById);
    const live = unchanged().map((row) => ({ ...row, blocked: false }));
    expect(() => {
      r.reconcile(
        "add_blocked",
        { add: [{ column: "blocked", derive: (after) => after === false }] },
        live,
      );
    }).not.toThrow();
  });
});

const equalDate = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
