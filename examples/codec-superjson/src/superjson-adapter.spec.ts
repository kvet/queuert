import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import {
  type JobTypeDefinitions,
  JobTypeValidationError,
  createClient,
  defineJobTypes,
  createWorkerRunner,
  createProcessors,
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

const createStateAdapter = () => {
  const stateAdapter = createSqliteStateAdapter({
    stateProvider: createBetterSqlite3StateProvider({
      db: new Database(":memory:"),
    }),
  });
  stateAdapter.migrateToLatest();
  return stateAdapter;
};

test("stores superjson's envelope and hands the runtime form to readers", async () => {
  using stateAdapter = createStateAdapter();
  const client = createClient({ stateAdapter, jobTypes: buildJobTypes() });

  const chain = stateAdapter.withTransaction((ctx) =>
    client.createChain({
      ...ctx,
      typeName: "remind",
      input: { sendAt: new Date("2024-06-01T09:00:00.000Z"), tags: new Set(["billing"]) },
    }),
  );

  const [stored] = stateAdapter.getJobs({ jobIds: [chain.id] });
  expect(stored?.input).toMatchObject({
    json: { sendAt: "2024-06-01T09:00:00.000Z", tags: ["billing"] },
    meta: { values: { sendAt: ["Date"], tags: ["set"] } },
  });

  const job = client.getJob({ id: chain.id, typeName: "remind" });
  expect(job?.input.sendAt).toEqual(new Date("2024-06-01T09:00:00.000Z"));
  expect(job?.input.tags).toEqual(new Set(["billing"]));
});

test("round-trips a Date and a bigint through the worker and back out of a client read", async () => {
  const jobTypes = buildJobTypes();
  using stateAdapter = createStateAdapter();
  const client = createClient({ stateAdapter, jobTypes });

  const sentAt = new Date("2024-07-04T12:00:00.000Z");

  await using workerRunner = createWorkerRunner({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        remind: {
          attemptHandler: async ({ job, complete }) => {
            expect(job.input.sendAt).toBeInstanceOf(Date);
            return stateAdapter.withTransaction((ctx) =>
              complete({ ...ctx, output: { sentAt, attempts: 3n } }),
            );
          },
        },
      },
    }),
  });

  const chain = stateAdapter.withTransaction((ctx) =>
    client.createChain({
      ...ctx,
      typeName: "remind",
      input: { sendAt: new Date("2024-06-01T09:00:00.000Z"), tags: new Set() },
    }),
  );

  await workerRunner.start();
  const result = await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 10 });

  expect(result.output).toEqual({ sentAt, attempts: 3n });
});

test("rejects a stored value that is not a superjson envelope", async () => {
  using stateAdapter = createStateAdapter();
  const writer = createClient({
    stateAdapter,
    jobTypes: defineJobTypes<{
      remind: { entry: true; input: { sendAt: string }; output: null };
    }>(),
  });
  const reader = createClient({ stateAdapter, jobTypes: buildJobTypes() });

  const chain = stateAdapter.withTransaction((ctx) =>
    writer.createChain({
      ...ctx,
      typeName: "remind",
      input: { sendAt: "2024-06-01T09:00:00.000Z" },
    }),
  );

  expect(() => reader.getJob({ id: chain.id })).toThrow(JobTypeValidationError);
});

test("carries the runtime types as the job type definitions", () => {
  const jobTypes = buildJobTypes();
  expectTypeOf<JobTypeDefinitions<typeof jobTypes>>().toEqualTypeOf<ReminderJobTypes>();
});

test("requires every job type name", () => {
  // @ts-expect-error — "remind" is missing
  createSuperjsonJobTypes<ReminderJobTypes>({});
});
