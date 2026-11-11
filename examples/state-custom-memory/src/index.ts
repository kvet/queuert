import { createClient, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";

import { createMemoryStateAdapter } from "./state-adapter.ts";

const jobTypes = defineJobTypes<{
  /*
   * Workflow:
   *   resize_image
   *        |
   *        v
   *   publish_image
   */
  resize_image: {
    entry: true;
    input: { imageId: string };
    continueWith: { typeName: "publish_image" };
  };
  publish_image: {
    input: { imageId: string; width: number };
    output: { url: string };
  };
}>();

// #region adapter
await using stateAdapter = createMemoryStateAdapter();
// #endregion

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      resize_image: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Resizing image ${job.input.imageId}`);
          return stateAdapter.withTransaction(async (txCtx) =>
            complete({
              ...txCtx,
              continueWith: {
                typeName: "publish_image",
                input: { imageId: job.input.imageId, width: 800 },
              },
            }),
          );
        },
      },
      publish_image: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Publishing image ${job.input.imageId} at ${job.input.width}px`);
          return stateAdapter.withTransaction(async (txCtx) =>
            complete({
              ...txCtx,
              output: {
                url: `https://cdn.example.com/${job.input.imageId}-${job.input.width}.jpg`,
              },
            }),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// #region create-chain
const chain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "resize_image",
    input: { imageId: "cat-42" },
  }),
);
// #endregion

const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Image published at ${result.output.url}`);
