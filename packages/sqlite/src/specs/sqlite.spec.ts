import { createInProcessNotifyAdapter, createQueuert, defineUnionJobTypes } from "queuert";
import { UUID } from "crypto";
import { it as baseIt, expectTypeOf, vi } from "vitest";
import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { extendWithStateSqlite } from "../testing.js";
import { createBetterSqlite3Provider } from "./state-provider.better-sqlite3.js";

const it = extendWithStateSqlite(baseIt);

it("should infer types correctly with custom ID", async ({ db }) => {
  const stateProvider = createBetterSqlite3Provider({ db });
  const stateAdapter = createSqliteStateAdapter({
    stateProvider,
    tablePrefix: "myapp_",
    idType: "TEXT",
    idGenerator: () => `job.${crypto.randomUUID()}`,
  });

  await stateAdapter.migrateToLatest({ db });

  const queuert = await createQueuert({
    stateAdapter,
    notifyAdapter: createInProcessNotifyAdapter(),
    log: vi.fn(),
    jobTypeDefinitions: defineUnionJobTypes<{
      test: {
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
    name: "test",
    process: async ({ job, complete }) => {
      expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

      return complete(async () => ({ bar: 42 }));
    },
  });

  const stopWorker = await worker.start();

  await queuert.waitForJobSequenceCompletion({ ...jobSequence, timeoutMs: 1000 });

  await stopWorker();
});
