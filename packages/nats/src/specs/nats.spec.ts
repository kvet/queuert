import { extendWithNats } from "@queuert/testcontainers";
import { connect } from "nats";
import { createQueuertClient, createQueuertInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
import { withWorkers } from "queuert/testing";
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

  const log = vi.fn();
  const jobTypeRegistry = defineJobTypes<{
    test: {
      entry: true;
      input: { message: string };
      output: { processed: true };
    };
  }>();

  const client = await createQueuertClient({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypeRegistry,
  });
  const worker = await createQueuertInProcessWorker({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypeRegistry,
    jobTypeProcessors: {
      test: {
        process: async ({ complete }) => {
          return complete(async () => ({ processed: true }));
        },
      },
    },
  });

  const jobChain = await client.withNotify(async () =>
    stateAdapter.runInTransaction(async (ctx) =>
      client.startJobChain({
        ...ctx,
        typeName: "test",
        input: { message: "hello from nats" },
      }),
    ),
  );

  await withWorkers([await worker.start()], async () => {
    await client.waitForJobChainCompletion(jobChain, { timeoutMs: 5000 });
  });

  await nc.close();
});

it("should work end-to-end without JetStream KV", async ({ natsConnectionOptions }) => {
  const nc = await connect(natsConnectionOptions);

  const notifyAdapter = await createNatsNotifyAdapter({
    nc,
    subjectPrefix: "queuert.e2e.nokv",
  });

  const stateAdapter = createInProcessStateAdapter();

  const log = vi.fn();
  const jobTypeRegistry = defineJobTypes<{
    test: {
      entry: true;
      input: { value: number };
      output: { doubled: number };
    };
  }>();

  const client = await createQueuertClient({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypeRegistry,
  });
  const worker = await createQueuertInProcessWorker({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypeRegistry,
    jobTypeProcessors: {
      test: {
        process: async ({ job, complete }) => {
          return complete(async () => ({ doubled: job.input.value * 2 }));
        },
      },
    },
  });

  const jobChain = await client.withNotify(async () =>
    stateAdapter.runInTransaction(async (ctx) =>
      client.startJobChain({
        ...ctx,
        typeName: "test",
        input: { value: 21 },
      }),
    ),
  );

  await withWorkers([await worker.start()], async () => {
    await client.waitForJobChainCompletion(jobChain, { timeoutMs: 5000 });
  });

  await nc.close();
});
