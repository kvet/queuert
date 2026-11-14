import { describe, expect, test } from "vitest";

import { type MaybePromise, syncAsync, resource, step, wait } from "./index.ts";

type Db = { query: (key: string) => MaybePromise<string[]> };

const rows: Record<string, string[]> = { a: ["row-a"], c: ["row-c"] };
const syncDb: Db = {
  query: (key) => {
    if (key === "boom") throw new Error("boom");
    return rows[key] ?? [];
  },
};
const asyncDb: Db = { query: async (key) => syncDb.query(key) };

function* findBody(db: Db, key: string) {
  const [row] = yield* step(db.query(key));
  return row;
}
const find = syncAsync(findBody);

function* findAllBody(db: Db, keys: string[]) {
  const found: string[] = [];
  for (const key of keys) {
    const row = yield* find.steps(db, key);
    if (row !== undefined) found.push(row);
  }
  return found;
}
const findAll = syncAsync(findAllBody);

function* findOrNoneBody(db: Db, key: string) {
  try {
    return yield* step(db.query(key));
  } catch (error) {
    return `none: ${(error as Error).message}`;
  }
}
const findOrNone = syncAsync(findOrNoneBody);

function* findAfterBody(db: Db, key: string, delay: Promise<void>) {
  yield* wait(delay);
  return yield* find.steps(db, key);
}
const findAfter = syncAsync(findAfterBody);

function* useBody(events: string[], key: string) {
  const skipped = yield* resource(null);
  const handle = yield* resource(
    Promise.resolve({ [Symbol.dispose]: () => void events.push(`disposed ${key}`) }),
  );
  try {
    events.push(`using ${key}`);
    return skipped === null && handle !== undefined;
  } finally {
    events.push(`finally ${key}`);
  }
}
const use = syncAsync(useBody);

describe("syncAsync without the compiler", () => {
  test("runs a body synchronously or awaiting each step, with the same result", async () => {
    expect(findAll.sync(syncDb, ["a", "b", "c"])).toEqual(["row-a", "row-c"]);
    const pending = findAll.async(asyncDb, ["a", "b", "c"]);
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toEqual(["row-a", "row-c"]);
    expect(await findAll.async(syncDb, ["a"])).toEqual(["row-a"]);
  });

  test("throws a sync step's promise error into the body, where catch sees it", () => {
    expect(() => find.sync(asyncDb, "a")).toThrow(
      "A synchronous step got a promise: the value must be synchronous",
    );
    expect(findOrNone.sync(asyncDb, "a")).toBe(
      "none: A synchronous step got a promise: the value must be synchronous",
    );
    expect(findOrNone.sync(syncDb, "boom")).toBe("none: boom");
  });

  test("rejects the async run when a step throws synchronously", async () => {
    const result = findAll.async(syncDb, ["boom"]);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toThrow("boom");
  });

  test("returns a promise from the sync run of a body that waits, with synchronous steps", async () => {
    expect(await findAfter.sync(syncDb, "a", Promise.resolve())).toBe("row-a");
    await expect(findAfter.sync(asyncDb, "a", Promise.resolve())).rejects.toThrow(
      "A synchronous step got a promise",
    );
  });

  test("disposes resources when the body ends, after its finally blocks, skipping null", async () => {
    const events: string[] = [];

    expect(await use.sync(events, "first")).toBe(true);
    expect(await use.async(events, "second")).toBe(true);
    expect(events).toEqual([
      "using first",
      "finally first",
      "disposed first",
      "using second",
      "finally second",
      "disposed second",
    ]);
  });

  test("calls the body with the sync-async function as this", async () => {
    const self = syncAsync(function* (this: unknown) {
      return yield* step(this);
    });

    expect(self.sync()).toBe(self);
    expect(await self.async()).toBe(self);
  });
});
