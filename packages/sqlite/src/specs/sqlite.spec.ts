import { type UUID } from "node:crypto";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
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
    stateAdapter,
    notifyAdapter,
    log,
    registry,
    processors: {
      test: {
        attemptHandler: async ({ job, complete }) => {
          expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

          return complete(async () => ({ bar: 42 }));
        },
      },
    },
  });

  const jobChain = await client.withNotify(async () => {
    db.exec("BEGIN IMMEDIATE");
    try {
      return await client.startJobChain({
        db,
        typeName: "test",
        input: { foo: "hello" },
      });
    } finally {
      db.exec("COMMIT");
    }
  });
  expectTypeOf(jobChain.id).toEqualTypeOf<`job.${UUID}`>();

  await withWorkers([await worker.start()], async () => {
    await client.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
  });
});
