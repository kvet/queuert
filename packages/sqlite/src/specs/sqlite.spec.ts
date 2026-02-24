import { type UUID } from "node:crypto";
import { createClient, createInProcessWorker, defineJobTypes, withTransactionHooks } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { withWorkers } from "queuert/testing";
import { it as baseIt, expectTypeOf, vi } from "vitest";
import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { extendWithStateSqlite } from "../testing.js";
import { createBetterSqlite3Provider } from "./state-provider.better-sqlite3.js";

const it = extendWithStateSqlite(baseIt);

it("should infer types correctly with custom ID", async ({ db }) => {
  const stateProvider = createBetterSqlite3Provider({ db });
  const stateAdapter = await createSqliteStateAdapter({
    stateProvider,
    tablePrefix: "myapp_",
    idType: "TEXT",
    idGenerator: () => `job.${crypto.randomUUID()}`,
  });

  await stateAdapter.migrateToLatest();

  const notifyAdapter = createInProcessNotifyAdapter();
  const log = vi.fn();
  const registry = defineJobTypes<{
    test: {
      entry: true;
      input: { foo: string };
      output: { bar: number };
    };
  }>();

  const client = await createClient({
    stateAdapter,
    notifyAdapter,
    log,
    registry,
  });
  const worker = await createInProcessWorker({
    client,
    processors: {
      test: {
        attemptHandler: async ({ job, complete }) => {
          expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

          return complete(async () => ({ bar: 42 }));
        },
      },
    },
  });

  const outerDb = db;
  const runInTransaction = async <T>(fn: (db: typeof outerDb) => Promise<T>): Promise<T> => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(outerDb);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const jobChain = await withTransactionHooks(async (transactionHooks) =>
    runInTransaction(async (db) =>
      client.startJobChain({
        db,
        transactionHooks,
        typeName: "test",
        input: { foo: "hello" },
      }),
    ),
  );
  expectTypeOf(jobChain.id).toEqualTypeOf<`job.${UUID}`>();

  await withWorkers([await worker.start()], async () => {
    await client.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
  });
});
