import { describe, expect, test } from "vitest";

import { syncAsyncCompiler } from "./plugin.ts";
import {
  countRows,
  type Db,
  findRow,
  findRows,
  findRowsLogged,
  findRowsLoggedSteps,
  self,
} from "./sync-async-functions.spec-helper.ts";
import { syncAsync } from "./sync-async.ts";

const tables: Record<string, string[]> = { users: ["ann", "bob"], admins: ["ann"], empty: [] };

const createSyncDb = () => {
  const logged: string[] = [];
  const db: Db = {
    query: (sql) => {
      if (!(sql in tables)) throw new Error(`no table ${sql}`);
      return tables[sql];
    },
    log: (entry) => {
      logged.push(entry);
    },
  };
  return { db, logged };
};

const createAsyncDb = () => {
  const { db, logged } = createSyncDb();
  const asyncDb: Db = {
    query: async (sql) => db.query(sql),
    log: async (entry) => db.log(entry),
  };
  return { db: asyncDb, logged };
};

describe("sync-async functions compiled by the plugin", () => {
  test("run without a generator in either mode", () => {
    for (const compiled of [findRow, findRows, findRowsLogged, countRows]) {
      expect(compiled.sync.toString()).not.toContain("yield");
      expect(compiled.async.toString()).not.toContain("yield");
    }
  });

  test("return the body's result in both modes", async () => {
    const keys = ["users", "admins", "empty"];

    expect(findRows.sync(createSyncDb().db, keys)).toEqual(["ann", "ann"]);
    expect(await findRows.async(createAsyncDb().db, keys)).toEqual(["ann", "ann"]);
  });

  test("let the async copy await plain values as well as promises", async () => {
    expect(await findRows.async(createSyncDb().db, ["users"])).toEqual(["ann"]);
  });

  test("run catch and finally blocks when a step throws or rejects", async () => {
    const sync = createSyncDb();
    expect(findRowsLogged.sync(sync.db, "users")).toBe("ann,bob");
    expect(findRowsLogged.sync(sync.db, "missing")).toBe("failed: no table missing");
    expect(sync.logged).toEqual(["queried users", "queried missing"]);

    const async = createAsyncDb();
    expect(await findRowsLogged.async(async.db, "users")).toBe("ann,bob");
    expect(await findRowsLogged.async(async.db, "missing")).toBe("failed: no table missing");
    expect(async.logged).toEqual(["queried users", "queried missing"]);
  });

  test("fail a sync call whose step gets a promise, inside the body where catch sees it", () => {
    const { db: asyncDb } = createAsyncDb();
    const { db: syncDb, logged } = createSyncDb();

    expect(() => findRow.sync(asyncDb, "users")).toThrow(
      "A synchronous step got a promise: the value must be synchronous",
    );
    expect(findRowsLogged.sync({ ...syncDb, query: asyncDb.query }, "users")).toBe(
      "failed: A synchronous step got a promise: the value must be synchronous",
    );
    expect(logged).toEqual(["queried users"]);
  });

  test("compile sync-async functions created inside a sync-async body", async () => {
    expect(countRows.sync(createSyncDb().db, ["users", "admins"])).toBe(3);
    expect(await countRows.async(createAsyncDb().db, ["users", "admins"])).toBe(3);
    expect(countRows.async.toString()).toContain("await countOne.async(key)");
  });

  test("give the results of the uncompiled body in both modes", async () => {
    const uncompiled = syncAsync(findRowsLoggedSteps);

    for (const key of ["users", "missing"]) {
      const [compiledSync, uncompiledSync] = [createSyncDb(), createSyncDb()];
      expect(findRowsLogged.sync(compiledSync.db, key)).toBe(
        uncompiled.sync(uncompiledSync.db, key),
      );
      expect(compiledSync.logged).toEqual(uncompiledSync.logged);

      const [compiledAsync, uncompiledAsync] = [createAsyncDb(), createAsyncDb()];
      expect(await findRowsLogged.async(compiledAsync.db, key)).toBe(
        await uncompiled.async(uncompiledAsync.db, key),
      );
      expect(compiledAsync.logged).toEqual(uncompiledAsync.logged);
    }
  });

  test("call the body with the sync-async function as this", async () => {
    expect(self.sync()).toBe(self);
    expect(await self.async()).toBe(self);
  });
});

describe("syncAsyncCompiler", () => {
  const source = `import { syncAsync, step } from "@queuert/sync-async";

export const findRow = syncAsync(function* (db) {
  return yield* step(db.query());
});
`;

  test("transforms ids with a query and modules that import with either quote", () => {
    const { id, code } = syncAsyncCompiler().transform.filter;

    expect(id.include.test("/src/find.ts?v=1")).toBe(true);
    expect(id.include.test("/src/find.mts")).toBe(true);
    expect(id.exclude.test("/src/find.d.ts?v=1")).toBe(true);
    expect(code.test(`import { syncAsync } from '@queuert/sync-async';`)).toBe(true);
    expect(code.test(`import { syncAsync } from "@queuert/sync-async";`)).toBe(true);
    expect(code.test(`import { syncAsyncCompiler } from "@queuert/sync-async/plugin";`)).toBe(
      false,
    );
  });

  test("leaves excluded modules and modules without sync-async functions untouched", () => {
    const { transform } = syncAsyncCompiler({ exclude: /\.spec\.ts$/ });

    expect(transform.handler(source, "/src/find.spec.ts")).toBeNull();
    expect(
      transform.handler(`import { step } from "@queuert/sync-async";\n`, "/src/find.ts"),
    ).toBeNull();
  });

  test("returns the compiled code with a source map", () => {
    const result = syncAsyncCompiler().transform.handler(source, "/src/find.ts");

    expect(result?.code).toContain("sync: function (db) {");
    expect(result?.map).toMatch(/"mappings":"[^"]+"/);
  });
});
