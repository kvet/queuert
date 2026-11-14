import { type UUID, randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { expectTypeOf, it, onTestFinished } from "vitest";

import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";
import { type SqliteStateAdapter, createSqliteStateAdapter } from "./state-adapter.sqlite.ts";

it("infers custom ID types and the provider's mode", () => {
  const db = new Database(":memory:");
  onTestFinished(() => {
    db.close();
  });

  expectTypeOf(
    createSqliteStateAdapter({
      stateProvider: createBetterSqlite3Provider({ db }),
      generateJobId: (): `job.${UUID}` => `job.${randomUUID()}`,
    }),
  ).toEqualTypeOf<SqliteStateAdapter<BetterSqlite3Context, `job.${UUID}`>>();
  expectTypeOf(
    createSqliteStateAdapter({
      stateProvider: createBetterSqlite3Provider({ db, mode: "sync" }),
      generateJobId: (): `job.${UUID}` => `job.${randomUUID()}`,
      generateWorkerId: (): `worker.${UUID}` => `worker.${randomUUID()}`,
    }),
  ).toEqualTypeOf<
    SqliteStateAdapter<BetterSqlite3Context, `job.${UUID}`, `worker.${UUID}`, "sync">
  >();
});
