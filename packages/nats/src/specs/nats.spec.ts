import { extendWithNats } from "@queuert/testcontainers";
import { connect } from "nats";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessStateAdapter,
} from "queuert";
import { withWorkers } from "queuert/testing";
import { it as baseIt, vi } from "vitest";

import { createNatsNotifyAdapter } from "../notify-adapter/notify-adapter.nats.js";

const it = extendWithNats(baseIt, import.meta.url);

it("should work end-to-end with NATS notify adapter", async ({ natsConnectionOptions }) => {
  const nc = await connect(natsConnectionOptions);

  const js = nc.jetstream();
  const kv = await js.views.kv(`queuert_e2e_test_${crypto.randomUUID()}`, { ttl: 60_000 });

  const notifyAdapter = createNatsNotifyAdapter({
    nc,
    kv,
    subjectPrefix: `queuert.e2e.${crypto.randomUUID()}`,
  });

  const stateAdapter = createInProcessStateAdapter();

  const log = vi.fn();
  const jobTypes = defineJobTypes<{
    test: {
      entry: true;
      input: { message: string };
      output: { processed: true };
    };
  }>();

  const client = createClient({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypes,
  });
  const worker = createInProcessWorker({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        test: {
          attemptHandler: async ({ complete }) => {
            return withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                complete({ ...txCtx, transactionHooks, output: { processed: true } }),
              ),
            );
          },
        },
      },
    }),
  });

  const chain = await withTransactionHooks(async (transactionHooks) =>
    stateAdapter.withTransaction(async (txCtx) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { message: "hello from nats" },
      }),
    ),
  );

  await withWorkers([await worker.start()], async () => {
    await client.awaitChain(chain, { timeoutMs: 5000 });
  });

  await nc.close();
});

it("should work end-to-end without JetStream KV", async ({ natsConnectionOptions }) => {
  const nc = await connect(natsConnectionOptions);

  const notifyAdapter = createNatsNotifyAdapter({
    nc,
    subjectPrefix: `queuert.e2e.nokv.${crypto.randomUUID()}`,
  });

  const stateAdapter = createInProcessStateAdapter();

  const log = vi.fn();
  const jobTypes = defineJobTypes<{
    test: {
      entry: true;
      input: { value: number };
      output: { doubled: number };
    };
  }>();

  const client = createClient({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypes,
  });
  const worker = createInProcessWorker({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        test: {
          attemptHandler: async ({ job, complete }) => {
            return withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                complete({ ...txCtx, transactionHooks, output: { doubled: job.input.value * 2 } }),
              ),
            );
          },
        },
      },
    }),
  });

  const chain = await withTransactionHooks(async (transactionHooks) =>
    stateAdapter.withTransaction(async (txCtx) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 21 },
      }),
    ),
  );

  await withWorkers([await worker.start()], async () => {
    await client.awaitChain(chain, { timeoutMs: 5000 });
  });

  await nc.close();
});
