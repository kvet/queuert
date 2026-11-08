/**
 * Shared lifecycle for the job type registry measurements.
 *
 * Every registry is measured on the in-process state and notify adapters with the same
 * order payload, so the only thing that differs between measurements is the registry: the
 * `defineJobTypes` baseline passes values through, the others validate (and encode/decode)
 * every input and output through a schema library.
 */

import {
  type JobTypes,
  createClient,
  createProcessors,
  createWorkerRunner,
  withTxHooks,
} from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";

import { createCompletionCounter, printHeader, runDoubleRunBenchmark } from "./utils.ts";

export type OrderInput = {
  orderId: string;
  customer: { id: string; email: string; name: string };
  items: { sku: string; quantity: number; price: number }[];
  note?: string;
};

export type OrderOutput = { processed: boolean; total: number };

export type OrderJobTypes = {
  "process-order": { entry: true; input: OrderInput; output: OrderOutput };
};

const orderInput = (i: number): OrderInput => ({
  orderId: `order-${i}`,
  customer: { id: `customer-${i % 100}`, email: `customer-${i % 100}@example.com`, name: "Ada" },
  items: [
    { sku: "sku-a", quantity: 1, price: 1250 },
    { sku: "sku-b", quantity: 2, price: 499 },
    { sku: "sku-c", quantity: 1, price: 7900 },
  ],
});

export const runValidationBenchmark = async ({
  name,
  title,
  jobTypes,
}: {
  name: string;
  title: string;
  jobTypes: JobTypes<OrderJobTypes>;
}): Promise<void> => {
  printHeader(title);

  await runDoubleRunBenchmark({
    name,
    setupInfrastructure: async () => ({ infra: undefined, teardown: async () => {} }),
    runLifecycle: async (_infra, { step, processStep, jobCount }) => {
      const completions = createCompletionCounter(jobCount);

      const stateAdapter = await step("After creating state adapter", async () =>
        createInProcessStateAdapter(),
      );

      const setup = await step("After creating client + worker", async () => {
        const client = createClient({ stateAdapter, jobTypes });
        const workerRunner = createWorkerRunner({
          client,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              "process-order": {
                attemptHandler: async ({ job, complete }) => {
                  const total = job.input.items.reduce(
                    (sum, item) => sum + item.quantity * item.price,
                    0,
                  );
                  const result = await withTxHooks(async (txHooks) =>
                    stateAdapter.withTransaction(async (ctx) =>
                      complete({ ...ctx, txHooks, output: { processed: true, total } }),
                    ),
                  );
                  completions.record();
                  return result;
                },
              },
            },
          }),
        });
        const stopWorkerRunner = await workerRunner.start();
        return { client, stopWorkerRunner };
      });

      await processStep(`After processing ${jobCount} jobs`, async () => {
        for (let i = 0; i < jobCount; i++) {
          await withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              setup.client.createChain({
                ...ctx,
                txHooks,
                typeName: "process-order",
                input: orderInput(i),
              }),
            ),
          );
        }
        await completions.done;
      });

      await setup.stopWorkerRunner();
      await stateAdapter.close();
    },
  });
};
