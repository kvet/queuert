import {
  createClient,
  createInProcessStateAdapter,
  createInProcessWorker,
  createProcessors,
  withTransactionHooks,
} from "queuert";
import { expect, test } from "vitest";
import { z } from "zod";

import { createZodCodecJobTypes } from "./zod-codec-adapter.js";

const zDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (iso) => new Date(iso),
  encode: (date) => date.toISOString(),
});

const buildJobTypes = () =>
  createZodCodecJobTypes({
    remind: {
      entry: true,
      input: z.object({ sendAt: zDate }),
      output: z.object({ sentAt: zDate }),
    },
  });

test("stores the encoded form and hands the runtime form to readers", async () => {
  const jobTypes = buildJobTypes();
  const stateAdapter = await createInProcessStateAdapter();
  const client = await createClient({ stateAdapter, jobTypes });

  const sendAt = new Date("2024-06-01T09:00:00.000Z");
  const chain = await withTransactionHooks(async (transactionHooks) =>
    stateAdapter.withTransaction(async (ctx) =>
      client.createChain({ ...ctx, transactionHooks, typeName: "remind", input: { sendAt } }),
    ),
  );

  const [stored] = await stateAdapter.getJobs({ jobIds: [chain.id] });
  expect(stored?.input).toEqual({ sendAt: "2024-06-01T09:00:00.000Z" });

  const job = await client.getJob({ id: chain.id, typeName: "remind" });
  expect(job?.input.sendAt).toBeInstanceOf(Date);

  await stateAdapter.close();
});

test("round-trips a Date through the worker and back out of a client read", async () => {
  const jobTypes = buildJobTypes();
  const stateAdapter = await createInProcessStateAdapter();
  const client = await createClient({ stateAdapter, jobTypes });

  const sentAt = new Date("2024-07-04T12:00:00.000Z");
  let seen: unknown;

  const worker = await createInProcessWorker({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        remind: {
          attemptHandler: async ({ job, complete }) => {
            seen = job.input.sendAt;
            return complete(async () => ({ sentAt }));
          },
        },
      },
    }),
  });

  const chain = await withTransactionHooks(async (transactionHooks) =>
    stateAdapter.withTransaction(async (ctx) =>
      client.createChain({
        ...ctx,
        transactionHooks,
        typeName: "remind",
        input: { sendAt: new Date("2024-06-01T09:00:00.000Z") },
      }),
    ),
  );

  const stop = await worker.start();
  const result = await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 10 });
  await stop();

  expect(seen).toBeInstanceOf(Date);
  expect(result.output.sentAt).toEqual(sentAt);

  const [stored] = await stateAdapter.getJobs({ jobIds: [chain.id] });
  expect(stored?.output).toEqual({ sentAt: "2024-07-04T12:00:00.000Z" });

  await stateAdapter.close();
});

test("rejects a schema whose encoded form is not JSON-serializable", () => {
  createZodCodecJobTypes(
    // @ts-expect-error z.date() persists a Date — it needs a codec to lower it to a string
    {
      remind: {
        entry: true,
        input: z.object({ sendAt: z.date() }),
        output: z.object({ ok: z.boolean() }),
      },
    },
  );
});
