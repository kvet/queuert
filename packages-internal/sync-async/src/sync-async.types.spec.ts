import { describe, expectTypeOf, test } from "vitest";

import {
  dynamicSyncAsync,
  type MaybePromise,
  type Mode,
  type SyncAsync,
  syncAsync,
  type ResultModeOf,
  type ModeResult,
  step,
  wait,
} from "./index.ts";

type Db = { query: (key: string) => MaybePromise<string[]> };

const find = syncAsync(function* (db: Db, key: string) {
  const [row] = yield* step(db.query(key));
  return row;
});

const findAfter = syncAsync(function* (db: Db, key: string, delay: Promise<void>) {
  yield* wait(delay);
  return yield* find.steps(db, key);
});

const findAllAfter = syncAsync(function* (db: Db, keys: string[], delay: Promise<void>) {
  const rows: string[] = [];
  for (const key of keys) rows.push(yield* findAfter.steps(db, key, delay));
  return rows;
});

describe("syncAsync", () => {
  test("types sync as returning the result, or a promise of it when the body waits", () => {
    expectTypeOf(find.sync).returns.toEqualTypeOf<string>();
    expectTypeOf(findAfter.sync).returns.toEqualTypeOf<Promise<string>>();
    expectTypeOf(findAllAfter.sync).returns.toEqualTypeOf<Promise<string[]>>();
    expectTypeOf(findAfter.async).returns.toEqualTypeOf<Promise<string>>();
  });

  test("does not let a body that waits pass as one that does not", () => {
    expectTypeOf(find).toExtend<SyncAsync<[db: Db, key: string], string>>();
    expectTypeOf(findAfter).not.toExtend<
      SyncAsync<[db: Db, key: string, delay: Promise<void>], string>
    >();
  });
});

describe("step", () => {
  test("accepts a promise-like value and yields what it resolves to", () => {
    const thenable: PromiseLike<number> = Promise.resolve(1);
    syncAsync(function* () {
      const value = yield* step(thenable);
      expectTypeOf(value).toEqualTypeOf<number>();
    });
  });
});

describe("dynamicSyncAsync", () => {
  test("rejects a body that yields anything other than steps", () => {
    // @ts-expect-error a plain yield is not a step
    dynamicSyncAsync(function* () {
      yield 1;
    });
  });
});

describe("ResultModeOf", () => {
  test("is async for a promise, sync for a plain value and either for a maybe-promise", () => {
    expectTypeOf<ResultModeOf<Promise<number>>>().toEqualTypeOf<"async">();
    expectTypeOf<ResultModeOf<number>>().toEqualTypeOf<"sync">();
    expectTypeOf<ResultModeOf<MaybePromise<number>>>().toEqualTypeOf<Mode>();
  });
});

describe("ModeResult", () => {
  test("is a promise in the async mode, the value in the sync mode and either for Mode", () => {
    expectTypeOf<ModeResult<"async", number>>().toEqualTypeOf<Promise<number>>();
    expectTypeOf<ModeResult<"sync", number>>().toEqualTypeOf<number>();
    expectTypeOf<ModeResult<Mode, number>>().toEqualTypeOf<MaybePromise<number>>();
  });
});
