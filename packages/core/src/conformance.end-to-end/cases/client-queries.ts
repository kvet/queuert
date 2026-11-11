import assert from "node:assert/strict";

import { sleep, withWorkerRunners } from "@queuert/helpers";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { ChainTypeMismatchError, JobTypeMismatchError } from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

const jobTypes = defineJobTypes<{
  order: {
    entry: true;
    input: { amount: number };
    output: { receipt: string };
    continueWith: { typeName: "order_fulfill" };
  };
  order_fulfill: {
    input: { orderId: string };
    output: { shipped: boolean };
  };
  notification: {
    entry: true;
    input: { message: string };
    output: { sent: boolean };
  };
  report: {
    entry: true;
    input: { type: string };
    output: { data: string };
    blockers: [{ typeName: "order" }];
  };
}>();

export const clientQueriesGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "client-queries",
  cases: [
    {
      name: "getChain > getChain returns undefined for nonexistent chain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain = await client.getChain({
          typeName: "order",
          id: "00000000-0000-0000-0000-000000000000",
        });

        assert.equal(chain, undefined);
      },
    },

    {
      name: "getChain > getChain returns chain by id",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const created = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 42 },
          }),
        );

        const chain = await client.getChain({ id: created.id });

        assert.notEqual(chain, null);
        assert.equal(chain!.id, created.id);
        assert.equal(chain!.typeName, "order");
        assert.deepEqual(chain!.input, { amount: 42 });
        assert.equal(chain!.status, "running");
      },
    },

    {
      name: "getChain > getChain narrows return type by typeName",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const created = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hello" },
          }),
        );

        const chain = await client.getChain({ typeName: "notification", id: created.id });

        assert.notEqual(chain, null);
      },
    },

    {
      name: "getChain > getChain returns without typeName",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const created = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 42 },
          }),
        );

        const chain = await client.getChain({ id: created.id });

        assert.notEqual(chain, null);
        assert.equal(chain!.typeName, "order");
      },
    },

    {
      name: "getChain > getChain throws on typeName mismatch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const created = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 42 },
          }),
        );

        await assert.rejects(
          async () => client.getChain({ typeName: "notification", id: created.id }),
          ChainTypeMismatchError,
        );
      },
    },

    {
      name: "getChains > getChains returns empty array for empty ids",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chains = await client.getChains({ ids: [] });

        assert.deepEqual(chains, []);
      },
    },

    {
      name: "getChains > getChains returns undefined for nonexistent ids",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chains = await client.getChains({
          ids: ["00000000-0000-0000-0000-000000000000"],
        });

        assert.deepEqual(chains, [undefined]);
      },
    },

    {
      name: "getChains > getChains returns chains in input order",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 42 },
          }),
        );
        const notification = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hello" },
          }),
        );

        const chains = await client.getChains({ ids: [notification.id, order.id] });

        assert.equal(chains.length, 2);
        assert.equal(chains[0]!.id, notification.id);
        assert.equal(chains[1]!.id, order.id);
      },
    },

    {
      name: "getChains > getChains returns mix of found and undefined",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const created = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 42 },
          }),
        );

        const chains = await client.getChains({
          ids: ["00000000-0000-0000-0000-000000000000", created.id],
        });

        assert.equal(chains.length, 2);
        assert.equal(chains[0], undefined);
        assert.equal(chains[1]!.id, created.id);
      },
    },

    {
      name: "getChains > getChains narrows return type by typeName",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const created = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hello" },
          }),
        );

        const chains = await client.getChains({
          typeName: "notification",
          ids: [created.id],
        });

        assert.equal(chains.length, 1);
      },
    },

    {
      name: "getChains > getChains throws on typeName mismatch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const created = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 42 },
          }),
        );

        await assert.rejects(
          async () => client.getChains({ typeName: "notification", ids: [created.id] }),
          ChainTypeMismatchError,
        );
      },
    },

    {
      name: "getChains > getChains skips typeName check for undefined entries",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chains = await client.getChains({
          typeName: "order",
          ids: ["00000000-0000-0000-0000-000000000000"],
        });

        assert.deepEqual(chains, [undefined]);
      },
    },

    {
      name: "getJob > getJob returns undefined for nonexistent job",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const job = await client.getJob({
          typeName: "order",
          id: "00000000-0000-0000-0000-000000000000",
        });

        assert.equal(job, undefined);
      },
    },

    {
      name: "getJob > getJob returns job by id",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hello" },
          }),
        );

        const job = await client.getJob({ id: chain.id });

        assert.notEqual(job, null);
        assert.equal(job!.id, chain.id);
        assert.equal(job!.typeName, "notification");
        assert.deepEqual(job!.input, { message: "hello" });
        assert.equal(job!.status, "pending");
      },
    },

    {
      name: "getJob > getJob returns without typeName",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hello" },
          }),
        );

        const job = await client.getJob({ id: chain.id });

        assert.notEqual(job, null);
        assert.equal(job!.typeName, "notification");
      },
    },

    {
      name: "getJob > getJob throws on typeName mismatch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hello" },
          }),
        );

        await assert.rejects(
          async () => client.getJob({ typeName: "order", id: chain.id }),
          JobTypeMismatchError,
        );
      },
    },

    {
      name: "getJobs > getJobs returns empty array for empty ids",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const jobs = await client.getJobs({ ids: [] });

        assert.deepEqual(jobs, []);
      },
    },

    {
      name: "getJobs > getJobs returns undefined for nonexistent ids",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const jobs = await client.getJobs({
          ids: ["00000000-0000-0000-0000-000000000000"],
        });

        assert.deepEqual(jobs, [undefined]);
      },
    },

    {
      name: "getJobs > getJobs returns jobs in input order",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 42 },
          }),
        );
        const notification = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hello" },
          }),
        );

        const jobs = await client.getJobs({ ids: [notification.id, order.id] });

        assert.equal(jobs.length, 2);
        assert.equal(jobs[0]!.id, notification.id);
        assert.equal(jobs[1]!.id, order.id);
      },
    },

    {
      name: "getJobs > getJobs returns mix of found and undefined",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const created = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hello" },
          }),
        );

        const jobs = await client.getJobs({
          ids: ["00000000-0000-0000-0000-000000000000", created.id],
        });

        assert.equal(jobs.length, 2);
        assert.equal(jobs[0], undefined);
        assert.equal(jobs[1]!.id, created.id);
      },
    },

    {
      name: "getJobs > getJobs narrows return type by typeName",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const created = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hello" },
          }),
        );

        const jobs = await client.getJobs({
          typeName: "notification",
          ids: [created.id],
        });

        assert.equal(jobs.length, 1);
      },
    },

    {
      name: "getJobs > getJobs throws on typeName mismatch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const created = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hello" },
          }),
        );

        await assert.rejects(
          async () => client.getJobs({ typeName: "order", ids: [created.id] }),
          JobTypeMismatchError,
        );
      },
    },

    {
      name: "getJobs > getJobs skips typeName check for undefined entries",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const jobs = await client.getJobs({
          typeName: "order",
          ids: ["00000000-0000-0000-0000-000000000000"],
        });

        assert.deepEqual(jobs, [undefined]);
      },
    },

    {
      name: "getChainTypeNames > getChainTypeNames returns empty array when no chains exist",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const names = await client.getChainTypeNames();

        assert.deepEqual(names, []);
      },
    },

    {
      name: "getChainTypeNames > getChainTypeNames returns sorted distinct chain type names",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hi" },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 2 },
          }),
        );

        const names = await client.getChainTypeNames();

        assert.deepEqual(names, ["notification", "order"]);
      },
    },

    {
      name: "getChainTypeNames > getChainTypeNames does not include continuation-only type names",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...order,
            handler: async ({ job, completeJob }) => {
              if (job.typeName === "order") {
                return completeJob(job, async ({ complete }) =>
                  complete({
                    continueWith: { typeName: "order_fulfill", input: { orderId: "o1" } },
                  }),
                );
              }
            },
          }),
        );

        const names = await client.getChainTypeNames();

        assert.deepEqual(names, ["order"]);
      },
    },

    {
      name: "getJobTypeNames > getJobTypeNames returns empty array when no jobs exist",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const names = await client.getJobTypeNames();

        assert.deepEqual(names, []);
      },
    },

    {
      name: "getJobTypeNames > getJobTypeNames returns sorted distinct job type names",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hi" },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 2 },
          }),
        );

        const names = await client.getJobTypeNames();

        assert.deepEqual(names, ["notification", "order"]);
      },
    },

    {
      name: "getJobTypeNames > getJobTypeNames includes continuation job type names",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...order,
            handler: async ({ job, completeJob }) => {
              if (job.typeName === "order") {
                return completeJob(job, async ({ complete }) =>
                  complete({
                    continueWith: { typeName: "order_fulfill", input: { orderId: "o1" } },
                  }),
                );
              }
            },
          }),
        );

        const names = await client.getJobTypeNames();

        assert.deepEqual(names, ["order", "order_fulfill"]);
      },
    },

    {
      name: "countChainsByTypeName > returns empty array for empty input",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const counts = await client.countChainsByTypeName({ typeNames: [] });
        assert.deepEqual(counts, []);
      },
    },

    {
      name: "countChainsByTypeName > counts running chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "order", input: { amount: 1 } }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hi" },
          }),
        );

        const counts = await client.countChainsByTypeName({
          typeNames: ["order", "notification", "report"],
        });

        assert.deepEqual(counts, [
          { running: { count: 1, hasMore: false }, completed: { count: 0, hasMore: false } },
          { running: { count: 1, hasMore: false }, completed: { count: 0, hasMore: false } },
          { running: { count: 0, hasMore: false }, completed: { count: 0, hasMore: false } },
        ]);
      },
    },

    {
      name: "countChainsByTypeName > counts completed chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          task_a: { entry: true; input: null; output: null };
          task_b: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chainA = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "task_a", input: null }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "task_a", input: null }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "task_b", input: null }),
        );

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              task_a: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
              task_b: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(chainA, completionOptions);
        });

        const counts = await client.countChainsByTypeName({ typeNames: ["task_a", "task_b"] });

        assert.ok(counts[0].completed.count >= 1);
        assert.equal(counts[0].running.count + counts[0].completed.count, 2);
        assert.ok(counts[1].running.count + counts[1].completed.count >= 1);
      },
    },

    {
      name: "countJobsByTypeName > returns empty array for empty input",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const counts = await client.countJobsByTypeName({ typeNames: [] });
        assert.deepEqual(counts, []);
      },
    },

    {
      name: "countJobsByTypeName > counts pending jobs",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "order", input: { amount: 1 } }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "order", input: { amount: 2 } }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hi" },
          }),
        );

        const counts = await client.countJobsByTypeName({
          typeNames: ["order", "notification", "report"],
        });

        assert.deepEqual(counts, [
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 2, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 1, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);
      },
    },

    {
      name: "countJobsByTypeName > counts running and completed jobs",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          task_a: { entry: true; input: null; output: null };
          task_b: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "task_a", input: null }),
        );
        const toComplete = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "task_a", input: null }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "task_b", input: null }),
        );

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              task_a: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
              task_b: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(toComplete, completionOptions);
        });

        const counts = await client.countJobsByTypeName({ typeNames: ["task_a", "task_b"] });

        assert.ok(counts[0].completed.count >= 1);
        assert.equal(
          counts[0].pending.count + counts[0].running.count + counts[0].completed.count,
          2,
        );
        assert.ok(
          counts[1].pending.count + counts[1].running.count + counts[1].completed.count >= 1,
        );
      },
    },

    {
      name: "listChains > listChains returns empty page when no chains exist",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const page = await client.listChains({ typeName: "order" });

        assert.deepEqual(page.items, []);
        assert.equal(page.nextCursor, null);
      },
    },

    {
      name: "listChains > listChains returns chains of the given type",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain1 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 100 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hi" },
          }),
        );

        const page = await client.listChains({ typeName: "order" });

        assert.equal(page.items.length, 1);
        assert.equal(page.items[0].id, chain1.id);
      },
    },

    {
      name: "listChains > listChains filters root-only (excludes blocker chains)",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "summary" },
            blockers: [order],
          }),
        );

        const allChains = await client.listChains({ typeName: "order" });
        const rootChains = await client.listChains({ typeName: "order", independent: true });

        assert.equal(allChains.items.length, 1);
        assert.equal(rootChains.items.length, 0);
      },
    },

    {
      name: "listChains > listChains filters by status",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hi" },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "summary" },
            blockers: [order],
          }),
        );

        const running = await client.listChains({ typeName: "order", status: "running" });

        assert.equal(running.items.length, 1);
      },
    },

    {
      name: "listChains > listChains orders ascending",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );
        await sleep(5);
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 2 },
          }),
        );

        const desc = await client.listChains({ typeName: "order" });
        const asc = await client.listChains({ typeName: "order", orderDirection: "asc" });

        assert.equal(desc.items.length, 2);
        assert.equal(asc.items.length, 2);
        assert.equal(asc.items[0].id, desc.items[1].id);
        assert.equal(asc.items[1].id, desc.items[0].id);
      },
    },

    {
      name: "listChains > listChains paginates with cursor",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 2 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 3 },
          }),
        );

        const page1 = await client.listChains({ typeName: "order", limit: 2 });
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = await client.listChains({
          typeName: "order",
          limit: 2,
          cursor: page1.nextCursor!,
        });
        assert.equal(page2.items.length, 1);
        assert.equal(page2.nextCursor, null);

        const allIds = [...page1.items, ...page2.items].map((c) => c.id);
        assert.equal(new Set(allIds).size, 3);
      },
    },

    {
      name: "listChains > listChains filters by date range",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const first = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );
        const second = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 2 },
          }),
        );

        const createdMs = [first.createdAt.getTime(), second.createdAt.getTime()];
        const earliest = Math.min(...createdMs);
        const latest = Math.max(...createdMs);

        const page = await client.listChains({
          typeName: "order",
          from: new Date(earliest - 1000),
          to: new Date(latest + 1000),
        });

        assert.equal(page.items.length, 2);

        const empty = await client.listChains({
          typeName: "order",
          from: new Date(latest + 60_000),
        });
        assert.equal(empty.items.length, 0);
      },
    },

    {
      name: "listChains > listChains sorts completed chains by completedAt when orderBy is completedAt",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          task_a: {
            entry: true;
            input: null;
            output: null;
          };
          task_b: {
            entry: true;
            input: null;
            output: null;
          };
        }>();

        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              task_a: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
              task_b: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });

        const chainA = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "task_a", input: null }),
        );
        await sleep(5);
        const chainB = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "task_a", input: null }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(chainA, completionOptions);
          await client.awaitChain(chainB, completionOptions);
        });

        const byCreatedAt = await client.listChains({
          typeName: "task_a",
          status: "completed",
          orderBy: "createdAt",
          orderDirection: "asc",
        });
        assert.equal(byCreatedAt.items[0].id, chainA.id);
        assert.equal(byCreatedAt.items[1].id, chainB.id);

        const byCompletedAt = await client.listChains({
          typeName: "task_a",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
        });
        assert.equal(byCompletedAt.items.length, 2);
        const [first, second] = byCompletedAt.items;
        assert.equal(first.status, "completed");
        assert.equal(second.status, "completed");
        if (first.status === "completed" && second.status === "completed") {
          assert.ok(first.completedAt.getTime() >= second.completedAt.getTime());
        }
      },
    },

    {
      name: "listChains > listChains returns correct chain shape",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 42 },
          }),
        );

        const page = await client.listChains({
          typeName: "order",
        });

        const result = page.items[0];
        assert.equal(result.id, chain.id);
        assert.equal(result.typeName, "order");
        assert.deepEqual(result.input, { amount: 42 });
        assert.equal(result.status, "running");
        const resultJob = await client.getJob({ id: chain.id });
        assert.equal(resultJob!.status, "pending");
        assert.ok(result.createdAt instanceof Date);
      },
    },

    {
      name: "listJobs > listJobs returns empty page when no jobs exist",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const page = await client.listJobs({ typeName: "order" });

        assert.deepEqual(page.items, []);
        assert.equal(page.nextCursor, null);
      },
    },

    {
      name: "listJobs > listJobs returns jobs of the given type",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 100 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hi" },
          }),
        );

        const page = await client.listJobs({ typeName: "order" });

        assert.equal(page.items.length, 1);
      },
    },

    {
      name: "listJobs > listJobs filters by status",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hi" },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "summary" },
            blockers: [order],
          }),
        );

        const pending = await client.listJobs({ typeName: "report", status: "pending" });
        const blocked = await client.listJobs({ typeName: "report", status: "blocked" });
        const runnable = await client.listJobs({ typeName: "order", status: "pending" });

        assert.equal(pending.items.length, 0);

        assert.equal(blocked.items.length, 1);
        assert.equal(blocked.items[0].typeName, "report");
        assert.equal(blocked.items[0].status, "blocked");

        assert.equal(runnable.items.length, 1);
        assert.equal(runnable.items[0].typeName, "order");
      },
    },

    {
      name: "listJobs > listJobs orders ascending",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );
        await sleep(5);
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 2 },
          }),
        );

        const desc = await client.listJobs({ typeName: "order" });
        const asc = await client.listJobs({ typeName: "order", orderDirection: "asc" });

        assert.equal(desc.items.length, 2);
        assert.equal(asc.items.length, 2);
        assert.equal(asc.items[0].id, desc.items[1].id);
        assert.equal(asc.items[1].id, desc.items[0].id);
      },
    },

    {
      name: "listJobs > listJobs paginates with cursor",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 2 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 3 },
          }),
        );

        const page1 = await client.listJobs({ typeName: "order", limit: 2 });
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = await client.listJobs({
          typeName: "order",
          limit: 2,
          cursor: page1.nextCursor!,
        });
        assert.equal(page2.items.length, 1);
        assert.equal(page2.nextCursor, null);
      },
    },

    {
      name: "listJobs > listJobs filters by date range",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const first = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );
        const second = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 2 },
          }),
        );

        const createdMs = [first.createdAt.getTime(), second.createdAt.getTime()];
        const earliest = Math.min(...createdMs);
        const latest = Math.max(...createdMs);

        const page = await client.listJobs({
          typeName: "order",
          from: new Date(earliest - 1000),
          to: new Date(latest + 1000),
        });
        assert.equal(page.items.length, 2);

        const futureOnly = await client.listJobs({
          typeName: "order",
          from: new Date(latest + 60_000),
        });
        assert.equal(futureOnly.items.length, 0);

        const pastOnly = await client.listJobs({
          typeName: "order",
          to: new Date(earliest - 60_000),
        });
        assert.equal(pastOnly.items.length, 0);
      },
    },

    {
      name: "listJobs > listJobs sorts completed jobs by completedAt when orderBy is completedAt",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          job_a: {
            entry: true;
            input: null;
            output: null;
          };
          job_b: {
            entry: true;
            input: null;
            output: null;
          };
        }>();

        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              job_a: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
              job_b: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });

        const chainA = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "job_a", input: null }),
        );
        await sleep(5);
        const chainB = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "job_a", input: null }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(chainA, completionOptions);
          await client.awaitChain(chainB, completionOptions);
        });

        const byCreatedAt = await client.listJobs({
          typeName: "job_a",
          status: "completed",
          orderBy: "createdAt",
          orderDirection: "asc",
        });
        assert.equal(byCreatedAt.items[0].id, chainA.id);
        assert.equal(byCreatedAt.items[1].id, chainB.id);

        const byCompletedAt = await client.listJobs({
          typeName: "job_a",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
        });
        assert.equal(byCompletedAt.items.length, 2);
        const [first, second] = byCompletedAt.items;
        assert.equal(first.status, "completed");
        assert.equal(second.status, "completed");
        if (first.status === "completed" && second.status === "completed") {
          assert.ok(first.completedAt.getTime() >= second.completedAt.getTime());
        }
      },
    },

    {
      name: "listJobs > listJobs sorts pending jobs by scheduledAt when orderBy is scheduledAt",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );
        await sleep(5);
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 2 },
          }),
        );

        const byScheduledAt = await client.listJobs({
          typeName: "order",
          status: "pending",
          orderBy: "scheduledAt",
          orderDirection: "asc",
        });
        assert.equal(byScheduledAt.items.length, 2);
        assert.ok(
          byScheduledAt.items[0].scheduledAt.getTime() <=
            byScheduledAt.items[1].scheduledAt.getTime(),
        );
      },
    },

    {
      name: "listJobs > listJobs returns correct job shape",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "test" },
          }),
        );

        const page = await client.listJobs({ typeName: "notification" });
        const job = page.items[0];

        assert.equal(job.typeName, "notification");
        assert.deepEqual(job.input, { message: "test" });
        assert.equal(job.status, "pending");
        assert.ok(job.createdAt instanceof Date);
        assert.ok(job.scheduledAt instanceof Date);
        assert.equal(job.id, job.chainId);
        assert.equal(job.chainIndex, 0);
        assert.equal(job.attempt, 0);
      },
    },

    {
      name: "listChainJobs > listChainJobs returns empty page for nonexistent chain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const page = await client.listChainJobs({
          chainId: "00000000-0000-0000-0000-000000000000",
        });

        assert.deepEqual(page.items, []);
      },
    },

    {
      name: "listChainJobs > listChainJobs returns jobs in chain in continuedToId order",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          step: {
            entry: true;
            input: { n: number };
            output: { done: boolean };
            continueWith: { typeName: "step" };
          };
        }>();

        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              step: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    job.input.n < 2
                      ? complete({
                          ...txCtx,
                          txHooks,
                          continueWith: { typeName: "step", input: { n: job.input.n + 1 } },
                        })
                      : complete({ ...txCtx, txHooks, output: { done: true } }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "step", input: { n: 0 } }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(chain, completionOptions);
        });

        const page = await client.listChainJobs({ chainId: chain.id });

        assert.equal(page.items.length, 3);
        const [first, second, third] = page.items;
        assert.deepEqual(first.input, { n: 0 });
        assert.deepEqual(second.input, { n: 1 });
        assert.deepEqual(third.input, { n: 2 });
        assert.equal(first.id, chain.id);
        assert.deepEqual(
          page.items.map((job) => job.chainIndex),
          [0, 1, 2],
        );
        for (const job of page.items) {
          assert.equal(job.chainId, chain.id);
          assert.equal(job.status, "completed");
        }
        assert.partialDeepStrictEqual(first, { status: "completed", continuedToId: second.id });
        assert.partialDeepStrictEqual(second, { status: "completed", continuedToId: third.id });
        assert.partialDeepStrictEqual(third, { status: "completed", continuedToId: null });
        assert.equal("output" in first, false);
        assert.equal("output" in second, false);
        assert.partialDeepStrictEqual(third, { output: { done: true } });
      },
    },

    {
      name: "listChainJobs > listChainJobs orders descending",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          step: {
            entry: true;
            input: { n: number };
            output: { done: boolean };
            continueWith: { typeName: "step" };
          };
        }>();

        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              step: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    job.input.n < 1
                      ? complete({
                          ...txCtx,
                          txHooks,
                          continueWith: { typeName: "step", input: { n: job.input.n + 1 } },
                        })
                      : complete({ ...txCtx, txHooks, output: { done: true } }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "step", input: { n: 0 } }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(chain, completionOptions);
        });

        const asc = await client.listChainJobs({ chainId: chain.id });
        const desc = await client.listChainJobs({
          chainId: chain.id,
          orderDirection: "desc",
        });

        assert.equal(asc.items[0].id, chain.id);
        assert.notEqual(asc.items[1].id, chain.id);
        assert.equal(asc.items[0].chainIndex, 0);
        assert.equal(asc.items[1].chainIndex, 1);
        assert.notEqual(desc.items[0].id, chain.id);
        assert.equal(desc.items[1].id, chain.id);
        assert.equal(desc.items[0].chainIndex, 1);
        assert.equal(desc.items[1].chainIndex, 0);
      },
    },

    {
      name: "listChainJobs > listChainJobs paginates",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          step: {
            entry: true;
            input: { n: number };
            output: { done: boolean };
            continueWith: { typeName: "step" };
          };
        }>();

        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              step: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    job.input.n < 2
                      ? complete({
                          ...txCtx,
                          txHooks,
                          continueWith: { typeName: "step", input: { n: job.input.n + 1 } },
                        })
                      : complete({ ...txCtx, txHooks, output: { done: true } }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "step", input: { n: 0 } }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(chain, completionOptions);
        });

        const page1 = await client.listChainJobs({ chainId: chain.id, limit: 2 });
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);
        assert.equal(page1.items[0].id, chain.id);
        assert.deepEqual(
          page1.items.map((job) => job.chainIndex),
          [0, 1],
        );

        const page2 = await client.listChainJobs({
          chainId: chain.id,
          limit: 2,
          cursor: page1.nextCursor!,
        });
        assert.equal(page2.items.length, 1);
        assert.equal(page2.nextCursor, null);
        assert.deepEqual(page2.items[0].input, { n: 2 });
        assert.equal(page2.items[0].chainIndex, 2);
      },
    },

    {
      name: "listChainJobs > listChainJobs only returns jobs from the specified chain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain1 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "notification",
            input: { message: "hi" },
          }),
        );

        const page = await client.listChainJobs({ chainId: chain1.id });

        assert.equal(page.items.length, 1);
        assert.equal(page.items[0].chainId, chain1.id);
      },
    },

    {
      name: "listChainJobs > listChainJobs narrows return type when typeName is provided",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 42 },
          }),
        );

        const page = await client.listChainJobs({ chainId: chain.id, chainTypeName: "order" });

        assert.equal(page.items.length, 1);
        assert.equal(page.items[0].typeName, "order");
      },
    },

    {
      name: "listChainJobs > listChainJobs throws on typeName mismatch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 42 },
          }),
        );

        await assert.rejects(
          async () => client.listChainJobs({ chainId: chain.id, chainTypeName: "notification" }),
          ChainTypeMismatchError,
        );
      },
    },

    {
      name: "getJobBlockers > getJobBlockers returns empty array when job has no blockers",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 100 },
          }),
        );

        const blockers = await client.getJobBlockers({ jobId: chain.id });

        assert.deepEqual(blockers, []);
      },
    },

    {
      name: "getJobBlockers > getJobBlockers returns blocker chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        const report = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "summary" },
            blockers: [order],
          }),
        );

        const blockers = await client.getJobBlockers({ jobId: report.id });

        assert.equal(blockers.length, 1);
        assert.equal(blockers[0].id, order.id);
        assert.equal(blockers[0].typeName, "order");
        assert.deepEqual(blockers[0].input, { amount: 50 });
      },
    },

    {
      name: "getJobBlockers > getJobBlockers resolves typed blockers when typeName is provided",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        const report = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "summary" },
            blockers: [order],
          }),
        );

        const blockers = await client.getJobBlockers({
          jobId: report.id,
          typeName: "report",
        });

        assert.equal(blockers.length, 1);
        assert.equal(blockers[0].typeName, "order");
        assert.deepEqual(blockers[0].input, { amount: 50 });
      },
    },

    {
      name: "getJobBlockers > getJobBlockers throws on typeName mismatch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        const report = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "summary" },
            blockers: [order],
          }),
        );

        await assert.rejects(
          async () => client.getJobBlockers({ jobId: report.id, typeName: "order" }),
          JobTypeMismatchError,
        );
      },
    },

    {
      name: "getJobBlockers > getJobBlockers reflects blocker completion status",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          dep: {
            entry: true;
            input: { v: number };
            output: { ok: boolean };
          };
          main: {
            entry: true;
            input: { start: boolean };
            output: { result: string };
            blockers: [{ typeName: "dep" }];
          };
        }>();

        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              dep: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { ok: true } }),
                  ),
              },
              main: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: "done" } }),
                  ),
              },
            },
          }),
        });

        const { mainChain } = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
          const depChain = await client.createChain({
            ...txCtx,
            txHooks,
            typeName: "dep",
            input: { v: 1 },
          });
          const mainChain = await client.createChain({
            ...txCtx,
            txHooks,
            typeName: "main",
            input: { start: true },
            blockers: [depChain],
          });
          return { depChain, mainChain };
        });

        const blockersBefore = await client.getJobBlockers({ jobId: mainChain.id });
        assert.notEqual(blockersBefore[0].status, "completed");

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(mainChain, completionOptions);
        });

        const blockersAfter = await client.getJobBlockers({ jobId: mainChain.id });
        assert.equal(blockersAfter[0].status, "completed");
      },
    },

    {
      name: "listBlockedJobs > listBlockedJobs returns empty page when chain has no dependents",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 100 },
          }),
        );

        const page = await client.listBlockedJobs({ chainId: chain.id });

        assert.deepEqual(page.items, []);
        assert.equal(page.nextCursor, null);
      },
    },

    {
      name: "listBlockedJobs > listBlockedJobs returns jobs blocked by chain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        const report = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "summary" },
            blockers: [order],
          }),
        );

        const page = await client.listBlockedJobs({ chainId: order.id });

        assert.equal(page.items.length, 1);
        assert.equal(page.items[0].id, report.id);
        assert.equal(page.items[0].typeName, "report");
        assert.equal(page.items[0].status, "blocked");
      },
    },

    {
      name: "listBlockedJobs > listBlockedJobs paginates",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "a" },
            blockers: [order],
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "b" },
            blockers: [order],
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "c" },
            blockers: [order],
          }),
        );

        const page1 = await client.listBlockedJobs({ chainId: order.id, limit: 2 });
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = await client.listBlockedJobs({
          chainId: order.id,
          limit: 2,
          cursor: page1.nextCursor!,
        });
        assert.equal(page2.items.length, 1);
        assert.equal(page2.nextCursor, null);
      },
    },

    {
      name: "listBlockedJobs > listBlockedJobs narrows return type when typeName is provided",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        const report = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "summary" },
            blockers: [order],
          }),
        );

        const page = await client.listBlockedJobs({
          chainId: order.id,
          typeName: "order",
        });

        assert.equal(page.items.length, 1);
        assert.equal(page.items[0].id, report.id);
        assert.equal(page.items[0].typeName, "report");
      },
    },

    {
      name: "listBlockedJobs > listBlockedJobs throws on typeName mismatch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "summary" },
            blockers: [order],
          }),
        );

        await assert.rejects(
          async () => client.listBlockedJobs({ chainId: order.id, typeName: "notification" }),
          ChainTypeMismatchError,
        );
      },
    },

    {
      name: "listBlockedJobs > listBlockedJobs orders ascending",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const order = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 50 },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "a" },
            blockers: [order],
          }),
        );
        await sleep(5);
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "report",
            input: { type: "b" },
            blockers: [order],
          }),
        );

        const desc = await client.listBlockedJobs({ chainId: order.id });
        const asc = await client.listBlockedJobs({ chainId: order.id, orderDirection: "asc" });

        assert.equal(desc.items.length, 2);
        assert.equal(asc.items.length, 2);
        assert.equal(asc.items[0].id, desc.items[1].id);
        assert.equal(asc.items[1].id, desc.items[0].id);
      },
    },

    {
      name: "getWorker > returns a worker with its type names and concurrency",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          send_email: { entry: true; input: null; output: null };
          sync_crm: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });
        const attemptStarted = Promise.withResolvers<void>();
        const releaseAttempt = Promise.withResolvers<void>();
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 2,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              send_email: {
                attemptHandler: async ({ complete }) => {
                  attemptStarted.resolve();
                  await releaseAttempt.promise;
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  );
                },
              },
              sync_crm: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });
        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "send_email", input: null }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await attemptStarted.promise;
          const job = await client.getJob({ id: chain.id, typeName: "send_email" });
          if (job?.status !== "running") {
            throw new Error("job is not running");
          }

          const worker = await client.getWorker({ id: job.attemptBy });
          assert.ok(worker);
          const { startedAt, leaseUntil, ...rest } = worker;
          assert.ok(startedAt instanceof Date);
          assert.ok(leaseUntil instanceof Date);
          assert.deepEqual(rest, {
            id: job.attemptBy,
            typeNames: ["send_email", "sync_crm"],
            concurrency: 2,
            expired: false,
          });

          releaseAttempt.resolve();
          await client.awaitChain(chain, completionOptions);
        });
      },
    },

    {
      name: "getWorker > returns undefined once the worker stops",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          send_email: { entry: true; input: null; output: null };
          sync_crm: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });
        const attemptStarted = Promise.withResolvers<void>();
        const releaseAttempt = Promise.withResolvers<void>();
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 2,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              send_email: {
                attemptHandler: async ({ complete }) => {
                  attemptStarted.resolve();
                  await releaseAttempt.promise;
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  );
                },
              },
              sync_crm: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });
        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "send_email", input: null }),
        );

        const job = await withWorkerRunners([await workerRunner.start()], async () => {
          await attemptStarted.promise;
          const runningJob = await client.getJob({ id: chain.id, typeName: "send_email" });
          releaseAttempt.resolve();
          await client.awaitChain(chain, completionOptions);
          return runningJob;
        });

        if (job?.status !== "running") {
          throw new Error("job is not running");
        }
        assert.equal(await client.getWorker({ id: job.attemptBy }), undefined);
      },
    },

    {
      name: "getWorkers > returns workers in input order with undefined for missing ids",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          send_email: { entry: true; input: null; output: null };
          sync_crm: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });
        const attemptStarted = Promise.withResolvers<void>();
        const releaseAttempt = Promise.withResolvers<void>();
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 2,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              send_email: {
                attemptHandler: async ({ complete }) => {
                  attemptStarted.resolve();
                  await releaseAttempt.promise;
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  );
                },
              },
              sync_crm: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });
        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "send_email", input: null }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await attemptStarted.promise;
          const job = await client.getJob({ id: chain.id, typeName: "send_email" });
          if (job?.status !== "running") {
            throw new Error("job is not running");
          }

          assert.deepEqual(
            (
              await client.getWorkers({
                ids: [job.attemptBy, stateAdapter.config.generateWorkerId()],
              })
            ).map((found) => found?.id),
            [job.attemptBy, undefined],
          );
          assert.deepEqual(await client.getWorkers({ ids: [] }), []);

          releaseAttempt.resolve();
          await client.awaitChain(chain, completionOptions);
        });
      },
    },

    {
      name: "listWorkers > lists workers with their running job count",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          send_email: { entry: true; input: null; output: null };
          sync_crm: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });
        const attemptStarted = Promise.withResolvers<void>();
        const releaseAttempt = Promise.withResolvers<void>();
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 2,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              send_email: {
                attemptHandler: async ({ complete }) => {
                  attemptStarted.resolve();
                  await releaseAttempt.promise;
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  );
                },
              },
              sync_crm: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });
        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "send_email", input: null }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await attemptStarted.promise;
          const job = await client.getJob({ id: chain.id, typeName: "send_email" });
          if (job?.status !== "running") {
            throw new Error("job is not running");
          }

          assert.deepEqual(
            (await client.listWorkers()).items.map((listed) => [listed.id, listed.concurrency]),
            [[job.attemptBy, 2]],
          );

          releaseAttempt.resolve();
          await client.awaitChain(chain, completionOptions);
        });
      },
    },

    {
      name: "listWorkers > narrows by typeName",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          send_email: { entry: true; input: null; output: null };
          sync_crm: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });
        const attemptStarted = Promise.withResolvers<void>();
        const releaseAttempt = Promise.withResolvers<void>();
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 2,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              send_email: {
                attemptHandler: async ({ complete }) => {
                  attemptStarted.resolve();
                  await releaseAttempt.promise;
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  );
                },
              },
              sync_crm: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });
        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "send_email", input: null }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await attemptStarted.promise;
          const job = await client.getJob({ id: chain.id, typeName: "send_email" });
          if (job?.status !== "running") {
            throw new Error("job is not running");
          }

          assert.deepEqual(
            (await client.listWorkers({ typeName: "sync_crm" })).items.map((listed) => listed.id),
            [job.attemptBy],
          );
          assert.deepEqual(await client.listWorkers({ typeName: "order" }), {
            items: [],
            nextCursor: null,
          });

          releaseAttempt.resolve();
          await client.awaitChain(chain, completionOptions);
        });
      },
    },

    {
      name: "listWorkers > pages through workers with cursor and limit",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          send_email: { entry: true; input: { index: number }; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });
        const attemptsStarted = [
          Promise.withResolvers<void>(),
          Promise.withResolvers<void>(),
          Promise.withResolvers<void>(),
        ];
        const releaseAttempts = Promise.withResolvers<void>();
        const processors = createProcessors({
          client,
          jobTypes,
          processors: {
            send_email: {
              attemptHandler: async ({ job, complete }) => {
                attemptsStarted[job.input.index].resolve();
                await releaseAttempts.promise;
                return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                  complete({ ...txCtx, txHooks, output: null }),
                );
              },
            },
          },
        });
        const workerRunners = [0, 1, 2].map(() =>
          createWorkerRunner({ client, concurrency: 1, processors }),
        );
        const chains = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChains({
            ...txCtx,
            txHooks,
            items: [0, 1, 2].map((index) => ({ typeName: "send_email", input: { index } })),
          }),
        );

        await withWorkerRunners(
          await Promise.all(workerRunners.map(async (workerRunner) => workerRunner.start())),
          async () => {
            await Promise.all(
              attemptsStarted.map(async (attemptStarted) => attemptStarted.promise),
            );
            const allWorkerIds = (await client.listWorkers()).items.map((listed) => listed.id);
            assert.equal(allWorkerIds.length, 3);

            const firstPage = await client.listWorkers({ limit: 2 });
            assert.deepEqual(
              firstPage.items.map((listed) => listed.id),
              allWorkerIds.slice(0, 2),
            );
            const secondPage = await client.listWorkers({
              limit: 2,
              cursor: firstPage.nextCursor!,
            });
            assert.deepEqual(
              secondPage.items.map((listed) => listed.id),
              allWorkerIds.slice(2),
            );
            assert.equal(secondPage.nextCursor, null);
            assert.deepEqual(
              (await client.listWorkers({ orderDirection: "desc" })).items.map(
                (listed) => listed.id,
              ),
              allWorkerIds.toReversed(),
            );

            releaseAttempts.resolve();
            await Promise.all(
              chains.map(async (chain) => client.awaitChain(chain, completionOptions)),
            );
          },
        );
      },
    },

    {
      name: "worker counts > counts workers, workers per type name and running jobs per worker",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          send_email: { entry: true; input: null; output: null };
          sync_crm: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });
        const attemptStarted = Promise.withResolvers<void>();
        const releaseAttempt = Promise.withResolvers<void>();
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 2,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              send_email: {
                attemptHandler: async ({ complete }) => {
                  attemptStarted.resolve();
                  await releaseAttempt.promise;
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  );
                },
              },
              sync_crm: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });
        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "send_email", input: null }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await attemptStarted.promise;
          const job = await client.getJob({ id: chain.id, typeName: "send_email" });
          if (job?.status !== "running") {
            throw new Error("job is not running");
          }

          assert.deepEqual(await client.countWorkers(), { live: 1, expired: 0 });
          assert.deepEqual(
            await client.countWorkersByTypeName({ typeNames: ["sync_crm", "order", "send_email"] }),
            [
              { live: 1, expired: 0 },
              { live: 0, expired: 0 },
              { live: 1, expired: 0 },
            ],
          );
          assert.deepEqual(
            await client.countRunningJobsByWorkerId({
              workerIds: [job.attemptBy, stateAdapter.config.generateWorkerId()],
            }),
            [1, 0],
          );

          releaseAttempt.resolve();
          await client.awaitChain(chain, completionOptions);
        });
      },
    },

    {
      name: "listWorkerJobs > returns the running job, then nothing once it completes",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          send_email: { entry: true; input: null; output: null };
          sync_crm: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });
        const attemptStarted = Promise.withResolvers<void>();
        const releaseAttempt = Promise.withResolvers<void>();
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 2,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              send_email: {
                attemptHandler: async ({ complete }) => {
                  attemptStarted.resolve();
                  await releaseAttempt.promise;
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  );
                },
              },
              sync_crm: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });
        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "send_email", input: null }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await attemptStarted.promise;
          const job = await client.getJob({ id: chain.id, typeName: "send_email" });
          if (job?.status !== "running") {
            throw new Error("job is not running");
          }

          assert.deepEqual(
            (await client.listWorkerJobs({ workerId: job.attemptBy })).items.map((running) => [
              running.id,
              running.status,
            ]),
            [[chain.id, "running"]],
          );

          releaseAttempt.resolve();
          await client.awaitChain(chain, completionOptions);

          assert.deepEqual(await client.listWorkerJobs({ workerId: job.attemptBy }), {
            items: [],
            nextCursor: null,
          });
        });
      },
    },

    {
      name: "listWorkerJobs > pages through a worker's running jobs with cursor and limit",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          send_email: { entry: true; input: { index: number }; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });
        const attemptsStarted = [
          Promise.withResolvers<void>(),
          Promise.withResolvers<void>(),
          Promise.withResolvers<void>(),
        ];
        const releaseAttempts = Promise.withResolvers<void>();
        const processors = createProcessors({
          client,
          jobTypes,
          processors: {
            send_email: {
              attemptHandler: async ({ job, complete }) => {
                attemptsStarted[job.input.index].resolve();
                await releaseAttempts.promise;
                return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                  complete({ ...txCtx, txHooks, output: null }),
                );
              },
            },
          },
        });
        const workerRunner = createWorkerRunner({ client, concurrency: 3, processors });
        const chains = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChains({
            ...txCtx,
            txHooks,
            items: [0, 1, 2].map((index) => ({ typeName: "send_email", input: { index } })),
          }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await Promise.all(attemptsStarted.map(async (attemptStarted) => attemptStarted.promise));
          const job = await client.getJob({ id: chains[0].id, typeName: "send_email" });
          if (job?.status !== "running") {
            throw new Error("job is not running");
          }
          const allJobIds = (await client.listWorkerJobs({ workerId: job.attemptBy })).items.map(
            (running) => running.id,
          );
          assert.deepEqual(
            allJobIds.toSorted((a, b) => a.localeCompare(b)),
            chains.map((chain) => chain.id).toSorted((a, b) => a.localeCompare(b)),
          );

          const firstPage = await client.listWorkerJobs({ workerId: job.attemptBy, limit: 2 });
          assert.deepEqual(
            firstPage.items.map((running) => running.id),
            allJobIds.slice(0, 2),
          );
          const secondPage = await client.listWorkerJobs({
            workerId: job.attemptBy,
            limit: 2,
            cursor: firstPage.nextCursor!,
          });
          assert.deepEqual(
            secondPage.items.map((running) => running.id),
            allJobIds.slice(2),
          );
          assert.equal(secondPage.nextCursor, null);
          assert.deepEqual(
            (
              await client.listWorkerJobs({ workerId: job.attemptBy, orderDirection: "desc" })
            ).items.map((running) => running.id),
            allJobIds.toReversed(),
          );

          releaseAttempts.resolve();
          await Promise.all(
            chains.map(async (chain) => client.awaitChain(chain, completionOptions)),
          );
        });
      },
    },

    {
      name: "cross-method integration > query methods return consistent data after chain completion",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          task: {
            entry: true;
            input: { n: number };
            output: { result: number };
            continueWith: { typeName: "task_next" };
          };
          task_next: {
            input: { n: number };
            output: { final: number };
          };
        }>();

        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              task: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      continueWith: { typeName: "task_next", input: { n: job.input.n + 1 } },
                    }),
                  ),
              },
              task_next: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { final: job.input.n * 10 } }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "task", input: { n: 1 } }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(chain, completionOptions);
        });

        const headJob = await client.getJob({ id: chain.id });
        assert.notEqual(headJob, null);
        assert.equal(headJob!.status, "completed");

        const chains = await client.listChains({ typeName: "task" });
        assert.equal(chains.items.length, 1);
        const completedChain = chains.items[0];
        assert.equal(completedChain.status, "completed");
        assert.deepEqual((completedChain as { output: unknown }).output, { final: 20 });

        const jobs = await client.listJobs({ typeName: "task" });
        assert.equal(jobs.items.length, 1);
        assert.equal(jobs.items[0].status, "completed");

        const chainJobs = await client.listChainJobs({ chainId: chain.id });
        assert.equal(chainJobs.items.length, 2);
        assert.equal(chainJobs.items[0].typeName, "task");
        assert.equal(chainJobs.items[1].typeName, "task_next");
      },
    },

    {
      name: "cross-method integration > query methods work with blockers across chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          dep: {
            entry: true;
            input: { v: number };
            output: { ok: boolean };
          };
          main: {
            entry: true;
            input: { start: boolean };
            output: { result: string };
            blockers: [{ typeName: "dep" }];
          };
        }>();

        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              dep: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { ok: true } }),
                  ),
              },
              main: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: "done" } }),
                  ),
              },
            },
          }),
        });

        const { depChain, mainChain } = await withCaseTransaction(
          stateAdapter,
          async (txCtx, txHooks) => {
            const depChain = await client.createChain({
              ...txCtx,
              txHooks,
              typeName: "dep",
              input: { v: 1 },
            });
            const mainChain = await client.createChain({
              ...txCtx,
              txHooks,
              typeName: "main",
              input: { start: true },
              blockers: [depChain],
            });
            return { depChain, mainChain };
          },
        );

        const mainJob = await client.getJob({ id: mainChain.id });
        assert.equal(mainJob!.status, "blocked");

        const blocked = await client.listBlockedJobs({ chainId: depChain.id });
        assert.equal(blocked.items.length, 1);
        assert.equal(blocked.items[0].id, mainChain.id);

        const blockers = await client.getJobBlockers({ jobId: mainChain.id });
        assert.equal(blockers.length, 1);
        assert.equal(blockers[0].id, depChain.id);

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(mainChain, completionOptions);
        });

        const completedMain = await client.getJob({ id: mainChain.id });
        assert.equal(completedMain!.status, "completed");

        const completedDep = await client.getJob({ id: depChain.id });
        assert.equal(completedDep!.status, "completed");
      },
    },

    {
      name: "cross-method integration > default limit is applied when not specified",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes,
        });

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "order",
            input: { amount: 1 },
          }),
        );

        const chains = await client.listChains({ typeName: "order" });
        const jobs = await client.listJobs({ typeName: "order" });

        assert.equal(chains.items.length, 1);
        assert.equal(jobs.items.length, 1);
      },
    },
  ],
};
