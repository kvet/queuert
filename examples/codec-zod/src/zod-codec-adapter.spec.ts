import {
  createClient,
  createInProcessStateAdapter,
  createInProcessWorker,
  createProcessors,
  withTransactionHooks,
} from "queuert";
import { runValidationAdapterConformance } from "queuert/conformance";
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
            return withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (ctx) =>
                complete({ ...ctx, transactionHooks, output: { sentAt } }),
              ),
            );
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

test("validates structural blockers against the runtime form", async () => {
  const jobTypes = createZodCodecJobTypes({
    remind: {
      entry: true,
      input: z.object({ sendAt: zDate }),
      output: z.object({ sentAt: zDate }),
    },
    digest: {
      entry: true,
      input: z.null(),
      output: z.null(),
      blockers: z.array(z.object({ input: z.object({ sendAt: z.date() }) })),
    },
  });
  const stateAdapter = await createInProcessStateAdapter();
  const client = await createClient({ stateAdapter, jobTypes });

  const digest = await withTransactionHooks(async (transactionHooks) =>
    stateAdapter.withTransaction(async (ctx) => {
      const remind = await client.createChain({
        ...ctx,
        transactionHooks,
        typeName: "remind",
        input: { sendAt: new Date("2024-06-01T09:00:00.000Z") },
      });
      return client.createChain({
        ...ctx,
        transactionHooks,
        typeName: "digest",
        input: null,
        blockers: [{ id: remind.id }],
      });
    }),
  );

  expect(digest.status).toBe("running");

  await stateAdapter.close();
});

test("zod codec adapter passes validation conformance", async () => {
  await runValidationAdapterConformance(async () => ({
    basic: {
      buildEntry: () =>
        createZodCodecJobTypes({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            output: z.object({ ok: z.boolean() }),
          },
        }),
      buildNonEntry: () =>
        createZodCodecJobTypes({
          internal: {
            input: z.object({ id: z.string() }),
            output: z.object({ ok: z.boolean() }),
          },
        }),
      buildContinuationOnly: () =>
        createZodCodecJobTypes({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            continueWith: z.object({ typeName: z.literal("next") }),
          },
          next: {
            input: z.object({ data: z.string() }),
            output: z.object({ done: z.boolean() }),
          },
        }),
    },
    continuations: {
      buildNominal: () =>
        createZodCodecJobTypes({
          step1: {
            entry: true,
            input: z.object({ id: z.string() }),
            continueWith: z.object({ typeName: z.literal("step2") }),
          },
          step2: {
            input: z.object({ data: z.unknown() }),
            output: z.object({ done: z.boolean() }),
          },
        }),
      buildStructural: () =>
        createZodCodecJobTypes({
          router: {
            entry: true,
            input: z.object({ route: z.string() }),
            continueWith: z.object({ input: z.object({ payload: z.string() }) }),
          },
          handler: {
            input: z.object({ payload: z.string() }),
            output: z.object({ handled: z.boolean() }),
          },
        }),
    },
    blockers: {
      buildNominal: () =>
        createZodCodecJobTypes({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            output: z.object({ done: z.boolean() }),
            blockers: z.array(z.object({ typeName: z.literal("auth") })),
          },
          auth: {
            entry: true,
            input: z.object({ token: z.string() }),
            output: z.object({ userId: z.string() }),
          },
        }),
      buildStructural: () =>
        createZodCodecJobTypes({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            output: z.object({ done: z.boolean() }),
            blockers: z.array(z.object({ input: z.object({ token: z.string() }) })),
          },
          auth: {
            entry: true,
            input: z.object({ token: z.string() }),
            output: z.object({ userId: z.string() }),
          },
        }),
    },
    external: {
      buildWithExternalSlice: () => {
        const notifications = createZodCodecJobTypes({
          "notifications.send-notification": {
            entry: true,
            input: z.object({ userId: z.string(), message: z.string() }),
            output: z.object({ sentAt: z.string() }),
          },
        });
        return createZodCodecJobTypes(
          {
            "orders.place-order": {
              entry: true,
              input: z.object({ userId: z.string() }),
              continueWith: z.object({ typeName: z.literal("orders.confirm-order") }),
            },
            "orders.confirm-order": {
              input: z.object({ orderId: z.number() }),
              output: z.object({ confirmedAt: z.string() }),
              blockers: z.tuple([
                z.object({ typeName: z.literal("notifications.send-notification") }),
              ]),
            },
          },
          notifications,
        );
      },
      buildWithExternalSlices: () => {
        const notifications = createZodCodecJobTypes({
          "notifications.send-notification": {
            entry: true,
            input: z.object({ userId: z.string(), message: z.string() }),
            output: z.object({ sentAt: z.string() }),
          },
        });
        const payments = createZodCodecJobTypes({
          "payments.charge": {
            entry: true,
            input: z.object({ amount: z.number() }),
            output: z.object({ receiptId: z.string() }),
          },
        });
        return createZodCodecJobTypes(
          {
            "orders.place-order": {
              entry: true,
              input: z.object({ userId: z.string() }),
              continueWith: z.object({ typeName: z.literal("orders.confirm-order") }),
            },
            "orders.confirm-order": {
              input: z.object({ orderId: z.number() }),
              output: z.object({ confirmedAt: z.string() }),
              blockers: z.tuple([
                z.object({ typeName: z.literal("notifications.send-notification") }),
                z.object({ typeName: z.literal("payments.charge") }),
              ]),
            },
          },
          [notifications, payments] as const,
        );
      },
    },
  }));
});
