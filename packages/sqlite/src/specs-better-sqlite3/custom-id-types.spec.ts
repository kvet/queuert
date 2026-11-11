import type { UUID } from "node:crypto";

import { createAsyncRwLock } from "@queuert/helpers";
import Database from "better-sqlite3";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";
import { expectTypeOf, it, onTestFinished, vi } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

it("infers custom ID types through the full stack", async () => {
  const db = new Database(":memory:");
  onTestFinished(() => {
    db.close();
  });
  const lock = createAsyncRwLock();
  const stateProvider = createBetterSqlite3Provider({ db, lock });
  const stateAdapter = createSqliteStateAdapter({
    stateProvider,
    tablePrefix: "myapp_",
    jobIdType: "TEXT",
    generateJobId: () => `job.${crypto.randomUUID()}`,
  });

  await stateAdapter.migrateToLatest();

  const log = vi.fn();
  const jobTypes = defineJobTypes<{
    test: {
      entry: true;
      input: { foo: string };
      output: { bar: number };
    };
  }>();

  const client = createClient({
    stateAdapter,
    log,
    jobTypes,
  });

  const withTransaction = async <T>(fn: (txDb: typeof db) => Promise<T>): Promise<T> => {
    using _h = await lock.acquireWrite();
    db.exec("BEGIN");
    try {
      const result = await fn(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    }
  };

  await using workerRunner = createWorkerRunner({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        test: {
          attemptHandler: async ({ job, complete, fence }) => {
            expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();
            expectTypeOf(fence).parameter(0).toEqualTypeOf<{ db: Database.Database }>();

            await withTransaction(async (db) => fence({ db }));

            return withTxHooks(async (txHooks) =>
              withTransaction(async (db) => {
                await fence({ db });
                return complete({ db, txHooks, output: { bar: 42 } });
              }),
            );
          },
        },
      },
    }),
  });

  const chain = await withTxHooks(async (txHooks) =>
    withTransaction(async (db) =>
      client.createChain({
        db,
        txHooks,
        typeName: "test",
        input: { foo: "hello" },
      }),
    ),
  );
  expectTypeOf(chain.id).toEqualTypeOf<`job.${UUID}`>();

  await workerRunner.start();
  await client.awaitChain(chain, { timeoutMs: 1000 });
});
