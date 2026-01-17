import { UUID } from "crypto";
import { createInProcessNotifyAdapter, createQueuert, defineJobTypes } from "queuert";
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

  const queuert = await createQueuert({
    stateAdapter,
    notifyAdapter: createInProcessNotifyAdapter(),
    log: vi.fn(),
    jobTypeRegistry: defineJobTypes<{
      test: {
        entry: true;
        input: { foo: string };
        output: { bar: number };
      };
    }>(),
  });

  const jobSequence = await queuert.withNotify(async () => {
    db.exec("BEGIN IMMEDIATE");
    try {
      return await queuert.startJobSequence({
        db,
        typeName: "test",
        input: { foo: "hello" },
      });
    } finally {
      db.exec("COMMIT");
    }
  });
  expectTypeOf(jobSequence.id).toEqualTypeOf<`job.${UUID}`>();

  const worker = queuert.createWorker().implementJobType({
    typeName: "test",
    process: async ({ job, complete }) => {
      expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

      return complete(async () => ({ bar: 42 }));
    },
  });

  const stopWorker = await worker.start();

  await queuert.waitForJobSequenceCompletion(jobSequence, { timeoutMs: 1000 });

  await stopWorker();
});
