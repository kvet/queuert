import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { createClient } from "./client.js";
import { createInProcessWorker } from "./in-process-worker.js";
import { createProcessors } from "./job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "./job-types/define-job-types.js";
import {
  type InProcessContext,
  createInProcessStateAdapter,
} from "./state-adapter/state-adapter.in-process.js";
import { type StateAdapter } from "./state-adapter/state-adapter.js";
import { withStateAdapterTransaction } from "./state-adapter/tx-context.js";
import {
  type TransactionHooks,
  createTransactionHooks,
  withTransactionHooks,
} from "./transaction-hooks.js";

type Defs = {
  greet: { entry: true; input: { name: string }; output: { greeting: string } };
};

const jobTypes = defineJobTypes<Defs>();

const createImplicitStateAdapter = async ({
  commitDelayMs,
}: {
  commitDelayMs?: number;
} = {}): Promise<StateAdapter<InProcessContext, string, string, "implicit">> => {
  const base = await createInProcessStateAdapter();
  const transactionHooksByJournal = new WeakMap<object, TransactionHooks>();

  const withTransaction = async <T>(fn: (txCtx: InProcessContext) => Promise<T>): Promise<T> => {
    const { transactionHooks, flush, discard } = createTransactionHooks();
    const result = await base
      .withTransaction(async (txCtx) => {
        transactionHooksByJournal.set(txCtx.journal!, transactionHooks);
        return fn(txCtx);
      })
      .catch(async (error: unknown) => {
        await discard();
        throw error;
      });
    if (commitDelayMs === undefined) {
      await flush();
    } else {
      void sleep(commitDelayMs).then(flush);
    }
    return result;
  };

  return {
    ...base,
    withTransaction,
    getTransactionHooks: (txCtx) =>
      txCtx.journal === undefined ? undefined : transactionHooksByJournal.get(txCtx.journal),
  };
};

const startGreetWorker = async ({
  stateAdapter,
  log,
}: {
  stateAdapter: StateAdapter<InProcessContext, string, string, "implicit">;
  log?: (entry: { type: string }) => void;
}) => {
  const client = await createClient({ stateAdapter, jobTypes, log });
  const worker = await createInProcessWorker({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        greet: {
          attemptHandler: async ({ job, complete }) =>
            stateAdapter.withTransaction(async (txCtx) =>
              complete({ ...txCtx, output: { greeting: `hello ${job.input.name}` } }),
            ),
        },
      },
    }),
  });
  return { client, stop: await worker.start() };
};

describe("implicit transaction hooks", () => {
  it("creates and completes a chain without passing transactionHooks", async () => {
    const stateAdapter = await createImplicitStateAdapter();
    const { client, stop } = await startGreetWorker({ stateAdapter });

    const chain = await stateAdapter.withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "greet", input: { name: "ada" } }),
    );
    const completed = await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 20 });
    await stop();

    expect(completed.output).toEqual({ greeting: "hello ada" });
  });

  it("counts a complete whose transaction commits after the handler returned", async () => {
    const stateAdapter = await createImplicitStateAdapter({ commitDelayMs: 50 });
    const logTypes: string[] = [];
    const { client, stop } = await startGreetWorker({
      stateAdapter,
      log: (entry) => {
        logTypes.push(entry.type);
      },
    });

    const chain = await stateAdapter.withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "greet", input: { name: "ada" } }),
    );
    await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 20 });
    await stop();

    expect(logTypes).toContain("job_attempt_completed");
    expect(logTypes).not.toContain("job_attempt_failed");
    expect(logTypes).not.toContain("job_attempt_lost");
  });

  it("rejects transactionHooks passed to a mutating method", async () => {
    const stateAdapter = await createImplicitStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });
    const { transactionHooks } = createTransactionHooks();

    await expect(
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          // @ts-expect-error -- an implicit state adapter supplies the transactionHooks
          transactionHooks,
          typeName: "greet",
          input: { name: "ada" },
        }),
      ),
    ).rejects.toThrow("createChain does not accept transactionHooks");
  });

  it("rejects a transaction with no bound transactionHooks", async () => {
    const base = await createInProcessStateAdapter();
    const stateAdapter = await createImplicitStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    await expect(
      base.withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, typeName: "greet", input: { name: "ada" } }),
      ),
    ).rejects.toThrow("createChain requires a transaction with bound transactionHooks");
  });

  it("completes a chain from outside a worker without transactionHooks", async () => {
    const stateAdapter = await createImplicitStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });
    const chain = await stateAdapter.withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "greet", input: { name: "ada" } }),
    );

    const completed = await stateAdapter.withTransaction(async (txCtx) =>
      client.completeChain({
        ...txCtx,
        typeName: "greet",
        id: chain.id,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete, ...completeOptions }) => {
            expect(completeOptions).not.toHaveProperty("transactionHooks");
            return complete({ output: { greeting: "hello from outside" } });
          }),
      }),
    );

    expect(completed.output).toEqual({ greeting: "hello from outside" });
  });
});

describe("explicit transaction hooks", () => {
  it("rejects a mutating method called without transactionHooks", async () => {
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    await expect(
      stateAdapter.withTransaction(async (txCtx) =>
        // @ts-expect-error -- an explicit state adapter requires transactionHooks
        client.createChain({ ...txCtx, typeName: "greet", input: { name: "ada" } }),
      ),
    ).rejects.toThrow("createChain requires transactionHooks");
  });

  it("accepts transactionHooks passed with the transaction context", async () => {
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "greet",
          input: { name: "ada" },
        }),
      ),
    );

    expect(chain.typeName).toBe("greet");
  });
});

describe("withStateAdapterTransaction", () => {
  it("passes transactionHooks into the context for an explicit state adapter", async () => {
    const stateAdapter = await createInProcessStateAdapter();

    const txCtx = await withStateAdapterTransaction(stateAdapter, async (txCtx) => txCtx);

    expect(txCtx).toHaveProperty("transactionHooks");
  });

  it("passes the bare context for an implicit state adapter", async () => {
    const stateAdapter = await createImplicitStateAdapter();

    const txCtx = await withStateAdapterTransaction(stateAdapter, async (txCtx) => txCtx);

    expect(txCtx).not.toHaveProperty("transactionHooks");
  });
});
