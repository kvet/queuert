import { expectToThrow } from "@queuert/helpers/expect.spec-helper";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "./state-provider.better-sqlite3.ts";
import type { ModeSqliteStateProvider } from "./state-provider.sqlite.ts";

const createItemsDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE item (name TEXT)");
  return db;
};

const insertItem = { sql: "INSERT INTO item (name) VALUES (?)", paramTypes: {}, columnTypes: {} };
const selectItems = {
  sql: "SELECT name FROM item",
  params: [],
  paramTypes: {},
  columnTypes: { name: "string" as const },
  readOnly: true,
};

describe.each(["async", "sync"] as const)("createBetterSqlite3Provider in %s mode", (mode) => {
  const createProvider = (db: Database.Database): ModeSqliteStateProvider<BetterSqlite3Context> =>
    createBetterSqlite3Provider({ db, mode });

  it("commits the writes of a transaction", async () => {
    const db = createItemsDb();
    const provider = createProvider(db);

    await provider.withTransaction((txCtx) =>
      provider.executeSql({ txCtx, ...insertItem, params: ["a"], readOnly: false }),
    );

    expect(await provider.executeSql(selectItems)).toEqual([{ name: "a" }]);
  });

  it("rolls back the writes of a transaction that throws", async () => {
    const db = createItemsDb();
    const provider = createProvider(db);

    await expectToThrow(
      () =>
        provider.withTransaction((txCtx) => {
          void provider.executeSql({ txCtx, ...insertItem, params: ["a"], readOnly: false });
          throw new Error("boom");
        }),
      "boom",
    );

    expect(db.inTransaction).toBe(false);
    expect(await provider.executeSql(selectItems)).toEqual([]);
  });

  it("throws on a statement without txCtx while the connection is inside a transaction", async () => {
    const db = createItemsDb();
    const provider = createProvider(db);
    db.exec("BEGIN");

    await expectToThrow(
      () => provider.executeSql({ ...insertItem, params: ["a"], readOnly: false }),
      /inside a transaction/,
    );

    db.exec("ROLLBACK");
    expect(await provider.executeSql(selectItems)).toEqual([]);
  });

  it("returns results in its mode and carries the sync brand only in the sync mode", async () => {
    const provider = createProvider(createItemsDb());

    expect(provider.executeSql(selectItems) instanceof Promise).toBe(mode === "async");
    expect("sync" in provider).toBe(mode === "sync");
  });
});

describe("createBetterSqlite3Provider in sync mode", () => {
  it("rolls back and throws when the transaction callback returns a promise", () => {
    const db = createItemsDb();
    const provider = createBetterSqlite3Provider({ db, mode: "sync" });

    expect(() => {
      void provider.withTransaction(async (txCtx) => {
        txCtx.db.prepare("INSERT INTO item (name) VALUES (?)").run("a");
      });
    }).toThrow(/returned a promise/);

    expect(db.inTransaction).toBe(false);
    expect(db.prepare("SELECT name FROM item").all()).toEqual([]);
  });
});
