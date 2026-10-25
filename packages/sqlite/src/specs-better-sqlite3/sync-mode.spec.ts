import Database from "better-sqlite3";
import {
  type BaseTxContext,
  type StateAdapter,
  createClient,
  createInProcessNotifyAdapter,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";
import { syncModeTestSuite } from "queuert/testing";
import { expect, test } from "vitest";

import { createSyncSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createBetterSqlite3SyncProvider } from "../state-provider/state-provider.better-sqlite3.js";

syncModeTestSuite({
  createStateAdapter: async () => {
    const db = new Database(":memory:");
    const stateAdapter = createSyncSqliteStateAdapter({
      stateProvider: createBetterSqlite3SyncProvider({ db }),
    });
    stateAdapter.migrateToLatest();
    return {
      stateAdapter: stateAdapter as unknown as StateAdapter<BaseTxContext, string, "sync">,
      dispose: async () => {
        db.close();
      },
    };
  },
});

const jobTypes = defineJobTypes<{
  greet: { entry: true; input: { name: string }; output: { greeting: string } };
}>();

const setup = () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  const stateAdapter = createSyncSqliteStateAdapter({
    stateProvider: createBetterSqlite3SyncProvider({ db }),
  });
  stateAdapter.migrateToLatest();
  const notifyAdapter = createInProcessNotifyAdapter();
  const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
  return {
    db,
    client,
    [Symbol.asyncDispose]: async () => {
      await notifyAdapter.close();
      stateAdapter.close();
      db.close();
    },
  };
};

test("createChain runs inside a native better-sqlite3 transaction", async () => {
  await using context = setup();
  const { db, client } = context;
  const insertUser = db.prepare("INSERT INTO users (name) VALUES (?) RETURNING id");

  const chain = withTransactionHooks((transactionHooks) =>
    db.transaction(() => {
      const user = insertUser.get("alice") as { id: number };
      return client.createChain({
        db,
        transactionHooks,
        typeName: "greet",
        input: { name: `user-${user.id}` },
      });
    })(),
  );

  expect(client.getChain({ id: chain.id })?.id).toBe(chain.id);

  expect(() =>
    withTransactionHooks((transactionHooks) =>
      db.transaction(() => {
        insertUser.get("bob");
        client.createChain({ db, transactionHooks, typeName: "greet", input: { name: "bob" } });
        throw new Error("roll back");
      })(),
    ),
  ).toThrow("roll back");
  expect(db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 1 });
  expect(client.listChains({ typeName: "greet" }).items).toHaveLength(1);
});

test("an autocommit statement throws while a raw transaction is held open", async () => {
  await using context = setup();
  const { db, client } = context;

  db.exec("BEGIN");
  try {
    expect(() => client.listChainTypeNames()).toThrow("must not stay open across an await");
  } finally {
    db.exec("ROLLBACK");
  }
});
