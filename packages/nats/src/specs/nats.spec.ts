import { extendWithNats } from "@queuert/testcontainers";
import { connect } from "nats";
import { createQueuert, defineJobTypes } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
import { it as baseIt, vi } from "vitest";
import { createNatsNotifyAdapter } from "../notify-adapter/notify-adapter.nats.js";

const it = extendWithNats(baseIt, import.meta.url);

it("should work end-to-end with NATS notify adapter", async ({ natsConnectionOptions }) => {
  const nc = await connect(natsConnectionOptions);

  const js = nc.jetstream();
  const kv = await js.views.kv("queuert_e2e_test", { ttl: 60_000 });

  const notifyAdapter = await createNatsNotifyAdapter({
    nc,
    kv,
    subjectPrefix: "queuert.e2e",
  });

  const stateAdapter = createInProcessStateAdapter();

  const queuert = await createQueuert({
    stateAdapter,
    notifyAdapter,
    log: vi.fn(),
    jobTypeRegistry: defineJobTypes<{
      test: {
        entry: true;
        input: { message: string };
        output: { processed: true };
      };
    }>(),
  });

  const jobSequence = await queuert.withNotify(async () =>
    stateAdapter.provideContext(async (ctx) =>
      stateAdapter.runInTransaction(ctx, async (txCtx) =>
        queuert.startJobSequence({
          ...txCtx,
          typeName: "test",
          input: { message: "hello from nats" },
        }),
      ),
    ),
  );

  const worker = queuert.createWorker().implementJobType({
    typeName: "test",
    process: async ({ complete }) => {
      return complete(async () => ({ processed: true }));
    },
  });

  const stopWorker = await worker.start();

  await queuert.waitForJobSequenceCompletion(jobSequence, { timeoutMs: 5000 });

  await stopWorker();

  await nc.close();
});

it("should work end-to-end without JetStream KV", async ({ natsConnectionOptions }) => {
  const nc = await connect(natsConnectionOptions);

  const notifyAdapter = await createNatsNotifyAdapter({
    nc,
    subjectPrefix: "queuert.e2e.nokv",
  });

  const stateAdapter = createInProcessStateAdapter();

  const queuert = await createQueuert({
    stateAdapter,
    notifyAdapter,
    log: vi.fn(),
    jobTypeRegistry: defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { doubled: number };
      };
    }>(),
  });

  const jobSequence = await queuert.withNotify(async () =>
    stateAdapter.provideContext(async (ctx) =>
      stateAdapter.runInTransaction(ctx, async (txCtx) =>
        queuert.startJobSequence({
          ...txCtx,
          typeName: "test",
          input: { value: 21 },
        }),
      ),
    ),
  );

  const worker = queuert.createWorker().implementJobType({
    typeName: "test",
    process: async ({ job, complete }) => {
      return complete(async () => ({ doubled: job.input.value * 2 }));
    },
  });

  const stopWorker = await worker.start();

  await queuert.waitForJobSequenceCompletion(jobSequence, { timeoutMs: 5000 });

  await stopWorker();

  await nc.close();
});
