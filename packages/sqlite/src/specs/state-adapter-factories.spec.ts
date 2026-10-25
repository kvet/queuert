import { type MigrationResult } from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { expect, expectTypeOf, test } from "vitest";

import {
  createAsyncSqliteStateAdapter,
  createSyncSqliteStateAdapter,
} from "../state-adapter/state-adapter.sqlite.js";
import {
  createBetterSqlite3Provider,
  createBetterSqlite3SyncProvider,
} from "../state-provider/state-provider.better-sqlite3.js";

test("each factory fixes the adapter's mode", async () => {
  const db = new Database(":memory:");
  const syncAdapter = createSyncSqliteStateAdapter({
    stateProvider: createBetterSqlite3SyncProvider({ db }),
  });
  const asyncAdapter = createAsyncSqliteStateAdapter({
    stateProvider: createBetterSqlite3Provider({ db }),
  });

  // @ts-expect-error -- an async provider cannot back a sync adapter
  createSyncSqliteStateAdapter({ stateProvider: createBetterSqlite3Provider({ db }) });

  expectTypeOf(syncAdapter.mode).toEqualTypeOf<"sync">();
  expectTypeOf(asyncAdapter.mode).toEqualTypeOf<"async">();
  expect(syncAdapter.mode).toBe("sync");
  expect(asyncAdapter.mode).toBe("async");
  expectTypeOf(syncAdapter.migrateToLatest).returns.toEqualTypeOf<MigrationResult>();
  expectTypeOf(asyncAdapter.migrateToLatest).returns.toEqualTypeOf<Promise<MigrationResult>>();
  expect(syncAdapter.migrateToLatest().applied.length).toBeGreaterThan(0);
  syncAdapter.close();
  await asyncAdapter.close();
  db.close();
});
