/**
 * superjson Codec Example
 *
 * Job types are declared with plain TypeScript types that hold a `Date`, a
 * `Map` and a `bigint`. One superjson codec carries them through every job
 * type: through a `continueWith` hop, into the completed output, and back out
 * of a client read — with no per-type schema.
 */

import {
  createClient,
  createInProcessStateAdapter,
  createWorkerRunner,
  createProcessors,
  withTxHooks,
} from "queuert";

import { createSuperjsonJobTypes } from "./superjson-adapter.ts";

const jobTypes = createSuperjsonJobTypes<{
  //  tally-votes ──▶ publish-results
  "tally-votes": {
    entry: true;
    input: { pollId: string; closesAt: Date };
    continueWith: { typeName: "publish-results" };
  };
  "publish-results": {
    input: { pollId: string; votes: Map<string, bigint> };
    output: { publishedAt: Date; total: bigint };
  };
}>({ "tally-votes": true, "publish-results": true });

const stateAdapter = createInProcessStateAdapter();

const client = createClient({ stateAdapter, jobTypes });

const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "tally-votes": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`closesAt is a ${job.input.closesAt.constructor.name}`);

          const votes = new Map([
            ["yes", 1_204_331n],
            ["no", 987_112n],
          ]);
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                continueWith: {
                  typeName: "publish-results",
                  input: { pollId: job.input.pollId, votes },
                },
              }),
            ),
          );
        },
      },
      "publish-results": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`votes is a ${job.input.votes.constructor.name}`);

          let total = 0n;
          for (const count of job.input.votes.values()) total += count;
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({ ...ctx, txHooks, output: { publishedAt: new Date(), total } }),
            ),
          );
        },
      },
    },
  }),
});

const stopWorkerRunner = await workerRunner.start();

const chain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "tally-votes",
      input: { pollId: "budget-2024", closesAt: new Date("2024-06-01T18:00:00.000Z") },
    }),
  ),
);

const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`\npublishedAt is a ${result.output.publishedAt.constructor.name}`);
console.log(`total is a ${typeof result.output.total}: ${result.output.total}`);

const [stored] = await stateAdapter.getJobs({ jobIds: [chain.id] });
console.log(`\nStored input: ${JSON.stringify(stored?.input)}`);

await stopWorkerRunner();
await stateAdapter.close();
console.log("\n=== Done ===");
