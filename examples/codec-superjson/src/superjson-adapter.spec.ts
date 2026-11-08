import {
  type JobTypeDefinitions,
  JobTypeValidationError,
  createClient,
  defineJobTypes,
  createInProcessStateAdapter,
  createWorkerRunner,
  createProcessors,
  withTxHooks,
} from "queuert";
import { expect, expectTypeOf, test } from "vitest";

import { createSuperjsonJobTypes } from "./superjson-adapter.ts";

type ReminderJobTypes = {
  remind: {
    entry: true;
    input: { sendAt: Date; tags: Set<string> };
    output: { sentAt: Date; attempts: bigint };
  };
};

const buildJobTypes = () => createSuperjsonJobTypes<ReminderJobTypes>({ remind: true });

test("stores superjson's envelope and hands the runtime form to readers", async () => {
  const stateAdapter = createInProcessStateAdapter();
  const client = createClient({ stateAdapter, jobTypes: buildJobTypes() });

  const chain = await withTxHooks(async (txHooks) =>
    stateAdapter.withTransaction(async (ctx) =>
      client.createChain({
        ...ctx,
        txHooks,
        typeName: "remind",
        input: { sendAt: new Date("2024-06-01T09:00:00.000Z"), tags: new Set(["billing"]) },
      }),
    ),
  );

  const [stored] = await stateAdapter.getJobs({ jobIds: [chain.id] });
  expect(stored?.input).toMatchObject({
    json: { sendAt: "2024-06-01T09:00:00.000Z", tags: ["billing"] },
    meta: { values: { sendAt: ["Date"], tags: ["set"] } },
  });

  const job = await client.getJob({ id: chain.id, typeName: "remind" });
  expect(job?.input.sendAt).toEqual(new Date("2024-06-01T09:00:00.000Z"));
  expect(job?.input.tags).toEqual(new Set(["billing"]));

  await stateAdapter.close();
});

test("round-trips a Date and a bigint through the worker and back out of a client read", async () => {
  const jobTypes = buildJobTypes();
  const stateAdapter = createInProcessStateAdapter();
  const client = createClient({ stateAdapter, jobTypes });

  const sentAt = new Date("2024-07-04T12:00:00.000Z");

  const workerRunner = createWorkerRunner({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        remind: {
          attemptHandler: async ({ job, complete }) => {
            expect(job.input.sendAt).toBeInstanceOf(Date);
            return withTxHooks(async (txHooks) =>
              stateAdapter.withTransaction(async (ctx) =>
                complete({ ...ctx, txHooks, output: { sentAt, attempts: 3n } }),
              ),
            );
          },
        },
      },
    }),
  });

  const chain = await withTxHooks(async (txHooks) =>
    stateAdapter.withTransaction(async (ctx) =>
      client.createChain({
        ...ctx,
        txHooks,
        typeName: "remind",
        input: { sendAt: new Date("2024-06-01T09:00:00.000Z"), tags: new Set() },
      }),
    ),
  );

  const stop = await workerRunner.start();
  const result = await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 10 });
  await stop();

  expect(result.output).toEqual({ sentAt, attempts: 3n });

  await stateAdapter.close();
});

test("rejects a stored value that is not a superjson envelope", async () => {
  const stateAdapter = createInProcessStateAdapter();
  const writer = createClient({
    stateAdapter,
    jobTypes: defineJobTypes<{
      remind: { entry: true; input: { sendAt: string }; output: null };
    }>(),
  });
  const reader = createClient({ stateAdapter, jobTypes: buildJobTypes() });

  const chain = await withTxHooks(async (txHooks) =>
    stateAdapter.withTransaction(async (ctx) =>
      writer.createChain({
        ...ctx,
        txHooks,
        typeName: "remind",
        input: { sendAt: "2024-06-01T09:00:00.000Z" },
      }),
    ),
  );

  await expect(reader.getJob({ id: chain.id })).rejects.toThrow(JobTypeValidationError);

  await stateAdapter.close();
});

test("carries the runtime types as the job type definitions", () => {
  const jobTypes = buildJobTypes();
  expectTypeOf<JobTypeDefinitions<typeof jobTypes>>().toEqualTypeOf<ReminderJobTypes>();
});

test("requires every job type name", () => {
  // @ts-expect-error — "remind" is missing
  createSuperjsonJobTypes<ReminderJobTypes>({});
});
