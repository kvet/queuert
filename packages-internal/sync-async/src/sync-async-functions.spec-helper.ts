import { type MaybePromise, type SyncAsync, syncAsync, step } from "@queuert/sync-async";

export type Db = {
  query: (sql: string) => MaybePromise<string[]>;
  log: (entry: string) => MaybePromise<void>;
};

export const findRow: SyncAsync<[db: Db, key: string], string | undefined> = syncAsync(
  function* (db, key) {
    const [row] = yield* step(db.query(key));
    return row;
  },
);

export const findRows: SyncAsync<[db: Db, keys: string[]], string[]> = syncAsync(
  function* (db, keys) {
    const found: string[] = [];
    for (const key of keys) {
      const row = yield* findRow.steps(db, key);
      if (row !== undefined) found.push(row);
    }
    return found;
  },
);

export const findRowsLogged: SyncAsync<[db: Db, key: string], string> = syncAsync(
  function* (db, key) {
    try {
      const rows = yield* step(db.query(key));
      return rows.join(",");
    } catch (error) {
      return `failed: ${(error as Error).message}`;
    } finally {
      yield* step(db.log(`queried ${key}`));
    }
  },
);

export function* findRowsLoggedSteps(db: Db, key: string) {
  try {
    const rows = yield* step(db.query(key));
    return rows.join(",");
  } catch (error) {
    return `failed: ${(error as Error).message}`;
  } finally {
    yield* step(db.log(`queried ${key}`));
  }
}

export const countRows: SyncAsync<[db: Db, keys: string[]], number> = syncAsync(
  function* (db, keys) {
    const countOne = syncAsync(function* (key: string) {
      const rows = yield* step(db.query(key));
      return rows.length;
    });
    let total = 0;
    for (const key of keys) total += yield* countOne.steps(key);
    return total;
  },
);

export const self = syncAsync(function* (this: unknown) {
  return yield* step(this);
});
