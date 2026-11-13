import { describe, expect, test } from "vitest";

import { type Modal, modal } from "./modal.ts";
import { step } from "./steps.ts";

type Db = { query: (sql: string) => string[] | Promise<string[]> };

class DuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateError";
  }
}

const syncDb = (rows: Record<string, string[]>): Db => ({
  query: (sql) => {
    if (sql === "duplicate") throw new DuplicateError(sql);
    return rows[sql] ?? [];
  },
});

const asyncDb = (rows: Record<string, string[]>): Db => ({
  query: async (sql) => syncDb(rows).query(sql),
});

const find: Modal<[db: Db, key: string], string | undefined> = modal(function* (db, key) {
  const [row] = yield* step(db.query(key));
  return row;
});

const findAll: Modal<[db: Db, keys: string[]], string[]> = modal(function* (db, keys) {
  const found: string[] = [];
  for (const key of keys) {
    const row = yield* find.steps(db, key);
    if (row !== undefined) found.push(row);
  }
  return found;
});

const insert: Modal<[db: Db, sql: string], string> = modal(function* (db, sql) {
  try {
    yield* step(db.query(sql));
  } catch (error) {
    if (error instanceof DuplicateError) return "exists";
    throw error;
  }
  return "inserted";
});

const rows = { a: ["row-a"], c: ["row-c"] };

describe("modal", () => {
  test("sync returns a plain value and async a promise with the same result", async () => {
    expect(findAll.sync(syncDb(rows), ["a", "b", "c"])).toEqual(["row-a", "row-c"]);
    const pending = findAll.async(asyncDb(rows), ["a", "b", "c"]);
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toEqual(["row-a", "row-c"]);
  });

  test("async awaits steps that return plain values", async () => {
    await expect(findAll.async(syncDb(rows), ["a"])).resolves.toEqual(["row-a"]);
  });

  test("a try/catch around a step catches the error in both modes", async () => {
    expect(insert.sync(syncDb(rows), "duplicate")).toBe("exists");
    await expect(insert.async(asyncDb(rows), "duplicate")).resolves.toBe("exists");
    expect(insert.sync(syncDb(rows), "new")).toBe("inserted");
  });

  test("sync throws when a step gets a promise", () => {
    expect(() => findAll.sync(asyncDb(rows), ["a"])).toThrow("A synchronous step got a promise");
  });

  test("a synchronous throw inside async is a rejection", async () => {
    const throwing: Db = {
      query: () => {
        throw new Error("boom");
      },
    };
    const result = findAll.async(throwing, ["a"]);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toThrow("boom");
  });
});
