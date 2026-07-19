import { describe, expect, it } from "vitest";

import {
  type ColumnContract,
  type ReconcilerRow,
  createMigrationReconciler,
} from "./migration-reconciler.js";

const keyById = (row: ReconcilerRow): string => String(row.id);

const initial: ReconcilerRow[] = [
  { id: "1", col_a: "x", col_b: null, group_id: "1", seq: 0 },
  { id: "2", col_a: "y", col_b: null, group_id: "1", seq: 1 },
  { id: "3", col_a: "z", col_b: new Date("2020-01-01T00:00:00Z"), group_id: "3", seq: 0 },
];

/** Echoes the projection back unchanged — the identity-migration live read. */
const unchanged = (): ReconcilerRow[] => initial.map((row) => ({ ...row }));

describe("createMigrationReconciler", () => {
  it("passes an identity (index-only) migration that changes no cell", () => {
    const r = createMigrationReconciler("item", initial, keyById);
    expect(() => {
      r.reconcile("idx", {}, unchanged());
    }).not.toThrow();
  });

  it("fails a stray cell change, naming the column and key", () => {
    const r = createMigrationReconciler("item", initial, keyById);
    const live = unchanged();
    live[1].seq = 99;
    expect(() => {
      r.reconcile("stray", {}, live);
    }).toThrow(/item\.seq@2 — cell-changed/);
  });

  it("accepts a declared add whose backfill satisfies its predicate, then tracks it", () => {
    const r = createMigrationReconciler("item", initial, keyById);
    const contract: ColumnContract = {
      add: [{ column: "flag", derive: (after, before) => after === (before.col_a === "y") }],
    };
    const live = unchanged().map((row) => ({ ...row, flag: row.col_a === "y" }));
    expect(() => {
      r.reconcile("add_flag", contract, live);
    }).not.toThrow();
    expect(r.projection().get("2")?.flag).toBe(true);
  });

  it("fails a declared add whose backfill is wrong", () => {
    const r = createMigrationReconciler("item", initial, keyById);
    const contract: ColumnContract = {
      add: [{ column: "flag", derive: (after, before) => after === (before.col_a === "y") }],
    };
    const live = unchanged().map((row) => ({ ...row, flag: false }));
    expect(() => {
      r.reconcile("add_flag", contract, live);
    }).toThrow(/flag@2 — predicate-failed/);
  });

  it("verifies a rename carried its data; fails when the rename loses it", () => {
    const ok = createMigrationReconciler("item", initial, keyById);
    const renamed = unchanged().map(({ col_b, ...rest }) => ({
      ...rest,
      col_b_renamed: col_b,
    }));
    expect(() => {
      ok.reconcile("rename", { rename: [{ from: "col_b", to: "col_b_renamed" }] }, renamed);
    }).not.toThrow();
    expect(ok.projection().get("3")?.col_b_renamed).toEqual(new Date("2020-01-01T00:00:00Z"));

    const lost = createMigrationReconciler("item", initial, keyById);
    const dropped = unchanged().map(({ col_b: _drop, ...rest }) => ({
      ...rest,
      col_b_renamed: null,
    }));
    expect(() => {
      lost.reconcile("rename", { rename: [{ from: "col_b", to: "col_b_renamed" }] }, dropped);
    }).toThrow(/col_b_renamed@3 — cell-changed/);
  });

  it("accepts a declared drop but fails an undeclared disappearance", () => {
    const ok = createMigrationReconciler("item", initial, keyById);
    const withoutColA = unchanged().map(({ col_a: _s, ...rest }) => rest);
    expect(() => {
      ok.reconcile("drop_col_a", { drop: ["col_a"] }, withoutColA);
    }).not.toThrow();

    const undeclared = createMigrationReconciler("item", initial, keyById);
    expect(() => {
      undeclared.reconcile("oops", {}, withoutColA);
    }).toThrow(/col_a@\d+ — undeclared-drop/);
  });

  it("flags an undeclared new column appearing in the live read", () => {
    const r = createMigrationReconciler("item", initial, keyById);
    const live = unchanged().map((row) => ({ ...row, surprise: 1 }));
    expect(() => {
      r.reconcile("oops", {}, live);
    }).toThrow(/surprise@\d+ — undeclared-add/);
  });

  it("handles a cross-row backfill using the snapshot", () => {
    const r = createMigrationReconciler("item", initial, keyById);
    const contract: ColumnContract = {
      add: [
        {
          column: "next_id",
          derive: (after, before, snapshot) => {
            const successor = [...snapshot.values()].find(
              (r2) => r2.group_id === before.group_id && Number(r2.seq) === Number(before.seq) + 1,
            );
            return after === (successor ? successor.id : null);
          },
        },
      ],
    };
    const successorOf = (row: ReconcilerRow): unknown =>
      initial.find((r2) => r2.group_id === row.group_id && Number(r2.seq) === Number(row.seq) + 1)
        ?.id ?? null;
    const live = unchanged().map((row) => ({ ...row, next_id: successorOf(row) }));
    expect(() => {
      r.reconcile("backfill_next", contract, live);
    }).not.toThrow();
    expect(r.projection().get("1")?.next_id).toBe("2");
    expect(r.projection().get("3")?.next_id).toBe(null);
  });

  it("handles a nondeterministic COALESCE(col, now()) envelope predicate", () => {
    const start = new Date("2021-06-01T00:00:00Z");
    const r = createMigrationReconciler("item", initial, keyById);
    const contract: ColumnContract = {
      add: [
        {
          column: "ts",
          derive: (after, before) => {
            const prior = before.col_b;
            if (prior !== null) return equalDate(after, prior);
            return after instanceof Date && after.getTime() >= start.getTime();
          },
        },
      ],
    };
    const live = unchanged().map((row) => ({
      ...row,
      ts: row.col_b ?? new Date("2021-06-01T00:00:05Z"),
    }));
    expect(() => {
      r.reconcile("backfill_ts", contract, live);
    }).not.toThrow();
  });

  it("reports a removed row", () => {
    const r = createMigrationReconciler("item", initial, keyById);
    const live = unchanged().filter((row) => row.id !== "2");
    expect(() => {
      r.reconcile("oops", {}, live);
    }).toThrow(/item@2 — row-removed/);
  });

  it("threads the projection so a later migration compares against the adopted baseline", () => {
    const r = createMigrationReconciler("item", initial, keyById);
    const afterAdd: ReconcilerRow[] = unchanged().map((row) => ({
      ...row,
      flag: row.col_a === "y",
    }));
    r.reconcile("add_flag", { add: [{ column: "flag", derive: () => true }] }, afterAdd);
    const afterDrop = afterAdd.map(({ col_a: _s, ...rest }) => rest);
    expect(() => {
      r.reconcile("drop_col_a", { drop: ["col_a"] }, afterDrop);
    }).not.toThrow();
    expect(r.projection().get("2")).toEqual({
      id: "2",
      flag: true,
      col_b: null,
      group_id: "1",
      seq: 1,
    });
  });

  it("supports a constant-value predicate for a deterministic default add", () => {
    const r = createMigrationReconciler("item", initial, keyById);
    const live = unchanged().map((row) => ({ ...row, flag: false }));
    expect(() => {
      r.reconcile(
        "add_flag",
        { add: [{ column: "flag", derive: (after) => after === false }] },
        live,
      );
    }).not.toThrow();
  });
});

const equalDate = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
