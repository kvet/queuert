# Queuert

Control flow library for your persistency layer driven applications.

Run your application logic as a series of background jobs that are started alongside state change transactions in your persistency layer. Perform long-running tasks with side-effects reliably in the background and keep track of their progress in your database. Own your stack and avoid vendor lock-in by using the tools you trust.

## Sorry, what?

Imagine you have some long-running process. For example, performing image processing and asset distribution after a user uploads an image.

```ts
const queuert = createQueuert({
  stateAdapter: ...,
  notifyAdapter: ...,
  jobTypeDefinitions: defineUnionJobTypes<{
    'process-image': {
      input: { imageId: string };
      output: DefineContinuationOutput<"distribute-image">;
    };
    'distribute-image': {
      input: DefineContinuationInput<{ imageId: string; minifiedImageId: string }>;
      output: { done: true };
    };
  }>(),
})

db.transaction(queuert.withNotify(async (tx) => {
  const image = await tx.images.create({ ... });

  await queuert.startJobSequence({
    tx,
    firstJobTypeName: "process-image",
    input: { imageId: image.id },
  });
}));
```

We scheduled the task inside a database transaction. This ensures that if the transaction rolls back, the job is not started. (Refer to transactional outbox pattern.)

Later, a background worker picks up the job and processes it:

```ts
queuert.createWorker()
  .implementJobType({
    name: "process-image",
    handler: async ({ job, prepare }) => {
      const [{ finalize }, image] = await prepare({ mode: "staged" }, async ({ tx }) => {
        return tx.images.getById(job.input.imageId);
      });

      const minifiedImage = await minifyImage(image);

      return finalize(async ({ tx, continueWith }) => {
        const saved = await tx.minifiedImages.create({ image: minifiedImage });

        return continueWith({
          tx,
          typeName: "distribute-image",
          input: { imageId: job.input.imageId, minifiedImageId: saved.id },
        });
      });
    },
  })
  .implementJobType({
    name: "distribute-image",
    handler: async ({ job, prepare }) => {
      const [{ finalize }, [image, minifiedImage]] = await prepare({ mode: "staged" }, async ({ tx }) => {
        return Promise.all([
          tx.images.getById(job.input.imageId),
          tx.minifiedImages.getById(job.input.minifiedImageId),
        ]);
      });

      const cdnUrl = await distributeImageToCDN(minifiedImage, 'some-cdn');

      return finalize(async ({ tx }) => {
        await tx.distributions.create({
          imageId: image.id,
          minifiedImageId: minifiedImage.id,
          cdnUrl,
        });

        return { done: true };
      });
    },
  })
```

Each task is performed in a database transaction, so you can safely read and write data as part of your job processing. Task is split into prepare and finalize phases, with automatic lease renewal in between.

In the prepare phase you can read data and perform non side-effecting operations within a transaction.

Between prepare and finalize, you can perform long-running work (CPU-intensive processing, network calls, etc.). The worker automatically renews the job lease at configured intervals. Make sure to implement this phase in an idempotent way, as it may be retried if the worker crashes or the lease expires.

In the finalize phase you can commit state changes and continue to the next job. If the worker crashes during finalize, the whole job is retried from the beginning.

## It looks familiar, right?

This library is inspired by workflow engines like [Temporal](https://temporal.io/) and queue engines like [BullMQ](https://docs.bullmq.io/).

However, instead of introducing a new persistence layer, Queuert leverages your existing database as the source of truth for both your application state and control flow. This allows you to avoid vendor lock-in and use the tools you already trust. Additionally, Queuert focuses on providing a simple and flexible API for defining and processing jobs, without the complexity of a full-fledged workflow engine and not well structured queue engine. By running jobs as database transactions, Queuert ensures data consistency and reliability, making it a great fit for applications that require robust background processing capabilities.
