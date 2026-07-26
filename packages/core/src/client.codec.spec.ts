import { describe, expect, it } from "vitest";

import { createClient } from "./client.js";
import { type JobTypes, type ResolvedJobTypeValue, createJobTypes } from "./entities/job-types.js";
import { JobTypeValidationError } from "./errors.js";
import { createInProcessWorker } from "./in-process-worker.js";
import { createInProcessStateAdapter } from "./state-adapter/state-adapter.in-process.js";
import { withTransactionHooks } from "./transaction-hooks.js";
import { createProcessors } from "./worker/create-processors.js";

/**
 * `timed` carries a `Date` at runtime and an ISO string at rest — the case the
 * codec API exists for. `lax` passes anything through until `strictLax` is
 * flipped on, which lets a test read back a value written under a looser schema.
 */
type Defs = {
  timed: { entry: true; input: { at: Date }; output: { doneAt: Date } };
  lax: { entry: true; input: { n: number }; output: null };
};

type CodecRegistry = {
  jobTypes: JobTypes<Defs>;
  encodeCalls: (readonly ResolvedJobTypeValue[])[];
  decodeCalls: (readonly ResolvedJobTypeValue[])[];
  /** Turn on the tightened `lax` decoder, simulating a schema that drifted. */
  setStrictLax: (strict: boolean) => void;
};

const createCodecRegistry = (): CodecRegistry => {
  const encodeCalls: (readonly ResolvedJobTypeValue[])[] = [];
  const decodeCalls: (readonly ResolvedJobTypeValue[])[] = [];
  let strictLax = false;

  const jobTypes = createJobTypes<Defs>({
    getTypeNames: () => ["timed", "lax"],
    validateEntry: () => {},
    encode: async (items) => {
      encodeCalls.push(items);
      return items.map((item) => {
        if (item.typeName === "lax") return item.value;
        if (item.value === null) return null;
        const key = item.direction === "input" ? "at" : "doneAt";
        const date = (item.value as Record<string, unknown>)[key];
        if (!(date instanceof Date)) throw new Error(`expected a Date at "${key}"`);
        return { [key]: date.toISOString() };
      });
    },
    decode: async (items) => {
      decodeCalls.push(items);
      return items.map((item) => {
        if (item.typeName === "lax") {
          const n = (item.value as Record<string, unknown> | null)?.n;
          if (strictLax && typeof n !== "number") throw new Error(`expected a number at "n"`);
          return item.value;
        }
        if (item.value === null) return null;
        const key = item.direction === "input" ? "at" : "doneAt";
        const iso = (item.value as Record<string, unknown>)[key];
        if (typeof iso !== "string") throw new Error(`expected a string at "${key}"`);
        return { [key]: new Date(iso) };
      });
    },
    validateContinueWith: () => {},
    validateBlockers: () => {},
  });

  return { jobTypes, encodeCalls, decodeCalls, setStrictLax: (s) => (strictLax = s) };
};

const setup = async () => {
  const registry = createCodecRegistry();
  const stateAdapter = await createInProcessStateAdapter();
  const client = await createClient({ stateAdapter, jobTypes: registry.jobTypes });
  return { ...registry, stateAdapter, client };
};

describe("codec write paths", () => {
  it("encodes a multi-chain create in a single batch", async () => {
    const { client, stateAdapter, encodeCalls } = await setup();

    await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "timed", input: { at: new Date("2024-01-01T00:00:00.000Z") } },
            { typeName: "timed", input: { at: new Date("2024-02-01T00:00:00.000Z") } },
            { typeName: "lax", input: { n: 1 } },
          ],
        }),
      ),
    );

    expect(encodeCalls).toHaveLength(1);
    expect(encodeCalls[0]).toHaveLength(3);
    expect(encodeCalls[0].map((item) => item.direction)).toEqual(["input", "input", "input"]);
  });

  it("surfaces an encode failure as JobTypeValidationError", async () => {
    const { client, stateAdapter } = await setup();

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        stateAdapter.withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "timed",
            input: { at: "2024-01-01" as unknown as Date },
          }),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects an encoded value that is not JSON-serializable", async () => {
    const stateAdapter = await createInProcessStateAdapter();
    const jobTypes = createJobTypes<Defs>({
      getTypeNames: () => ["timed"],
      validateEntry: () => {},
      // Identity encode leaks the runtime `Date` into the storage form.
      encode: async (items) => items.map((item) => item.value),
      decode: async (items) => items.map((item) => item.value),
      validateContinueWith: () => {},
      validateBlockers: () => {},
    });
    const client = await createClient({ stateAdapter, jobTypes });

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        stateAdapter.withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "timed",
            input: { at: new Date("2024-01-01T00:00:00.000Z") },
          }),
        ),
      ),
    ).rejects.toThrow(/not JSON-serializable at "at"/);
  });
});

describe("codec read paths", () => {
  it("decodes a page of mixed jobs in a single batch covering inputs and outputs", async () => {
    const { client, stateAdapter, jobTypes, decodeCalls } = await setup();

    const completed = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "timed", input: { at: new Date("2024-01-01T00:00:00.000Z") } },
            { typeName: "timed", input: { at: new Date("2024-02-01T00:00:00.000Z") } },
          ],
        }),
      ),
    );

    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          timed: {
            attemptHandler: async ({ complete }) =>
              complete(async () => ({ doneAt: new Date("2024-03-01T00:00:00.000Z") })),
          },
        },
      }),
    });
    const stop = await worker.start();
    for (const chain of completed) {
      await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 10 });
    }
    await stop();

    // A pending job so the page mixes decoded inputs with decoded outputs.
    await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "lax", input: { n: 7 } }),
      ),
    );

    decodeCalls.length = 0;
    const page = await client.listJobs({ limit: 10 });

    expect(page.items).toHaveLength(3);
    expect(decodeCalls).toHaveLength(1);
    expect(decodeCalls[0]).toHaveLength(5);
    expect(decodeCalls[0].filter((item) => item.direction === "output")).toHaveLength(2);
  });

  it("reports a persisted value the decoder rejects as JobTypeValidationError", async () => {
    const { client, stateAdapter, setStrictLax } = await setup();

    // Written while `lax` accepted anything...
    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "lax",
          input: { n: "drifted" as unknown as number },
        }),
      ),
    );

    // ...read back after the schema tightened.
    setStrictLax(true);
    await expect(client.getJob({ id: chain.id })).rejects.toThrow(JobTypeValidationError);
  });

  it("hands the worker the runtime form and round-trips a Date back to the client", async () => {
    const { client, stateAdapter, jobTypes } = await setup();

    const at = new Date("2024-01-01T00:00:00.000Z");
    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "timed", input: { at } }),
      ),
    );

    let seen: unknown;
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          timed: {
            attemptHandler: async ({ job, complete }) => {
              seen = job.input.at;
              return complete(async () => ({ doneAt: new Date("2024-03-01T00:00:00.000Z") }));
            },
          },
        },
      }),
    });
    const stop = await worker.start();
    await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 10 });
    await stop();

    expect(seen).toBeInstanceOf(Date);
    expect((seen as Date).toISOString()).toBe(at.toISOString());

    const job = await client.getJob({ id: chain.id, typeName: "timed" });
    expect(job?.input.at).toBeInstanceOf(Date);
    if (job?.status !== "completed" || job.continuedToId !== null) {
      throw new Error("expected a terminally completed job");
    }
    expect(job.output.doneAt).toEqual(new Date("2024-03-01T00:00:00.000Z"));
  });
});
