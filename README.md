# Queuert

Control flow library for your persistency layer driven applications.

Run your application logic as a series of background jobs that is enqueued alongside state change transaction in your persistency layer. Perform long-running tasks with side-effects reliably in the background and keep track of their progress in your database. Own your stack and avoid vendor lock-in by using the tools you trust.

## Sorry, what?

Imagine you have some long-running process. For example, performing image processing and asset distribution after a user uploads an image.

```ts
const queuert = createQueuert({
  dbProvider: ...,
  notifyProvider: ...,
  chainDefinitions: defineUnionChains<{
    'process-and-distribute-image': {
      input: { imageId: string };
      output: { done: true };
    };
  }>(),
})

db.transaction(queuert.withNotify(async (tx) => {
  const image = await tx.images.create({ ... });

  await queuert.enqueueJobChain({
    tx,
    name: "process-and-distribute-image",
    input: { imageId: image.id },
  });
}));
```

We scheduled the task inside a database transaction. This ensures that if the transaction rolls back, the job is not enqueued. (Refer to transactional outbox pattern.)

Later, a background worker picks up the job and processes it:

```ts
queuert.createWorker()
  .createChain({
    name: "process-and-distribute-image",
    queueDefinitions: defineUnionQueues<{
      distribute: {
        input: { imageId: string; minifiedImageId: string };
      };
    }>(),
  })
  .createQueue({
    name: "process-and-distribute-image",
    handler: async ({ claim, heartbeat, finalize }) => {
      const image = await claim(async ({ tx, job }) => {
        return tx.images.getById(job.input.imageId);
      });

      // CPU-intensive image minification that blocks the event loop for a while
      await heartbeat({ leaseMs: 60000 });
      const minifiedImage = minifyImage(image);

      return finalize(async ({ tx, enqueueJob }) => {
        const minifiedImage = await tx.minifiedImages.create({ image: minifiedImage });

        return enqueueJob({
          tx,
          name: "process-and-distribute-image:distribute",
          input: { imageId: image.id, minifiedImageId: minifiedImage.id },
        });
      });
    },
  })
  .createQueue({
    name: "process-and-distribute-image:distribute",
    handler: async ({ claim, withHeartbeat, finalize }) => {
      const [image, minifiedImage] = await claim(async ({ tx, job }) => {
        return Promise.all([
          tx.images.getById(job.input.imageId),
          tx.minifiedImages.getById(job.input.imageId),
        ]);
      });

      // Network-intensive non blocking distribution that may take a while
      const distribution = await withHeartbeat(async () => {
        return distributeImageToCDN(minifiedImage, 'some-cdn');
      }, { intervalMs: 10000, leaseMs: 60000 });

      return finalize(async ({ tx, enqueueJob }) => {
        const distribution = await tx.distributions.create({
          imageId: image.id,
          minifiedImageId: minifiedImage.id
        });

        return { done: true };
      });
    },
  })
```

Each task is performed in a database transaction, so you can safely read and write data as part of your job processing. Task is split into claim, process and finalize phases.

In the claim phase you can read data and perform non side-effecting operations.

The process phase is where you perform the main work of the job. You can optionally send heartbeats to extend the job lease if your processing takes a long time. Make sure to implement it in an idempotent way, as the process phase may be retried multiple times if the worker crashes or the job lease expires.

In the finalize phase you can perform state commit and enqueue further jobs. If the worker crashes during the finalize phase, the whole job is retried from the beginning.

## It looks familiar, right?

This library is inspired by workflow engines like [Temporal](https://temporal.io/) and queue engines like [BullMQ](https://docs.bullmq.io/).

However, instead of introducing a new persistence layer, Queuert leverages your existing database as the source of truth for both your application state and control flow. This allows you to avoid vendor lock-in and use the tools you already trust. Additionally, Queuert focuses on providing a simple and flexible API for defining and processing jobs, without the complexity of a full-fledged workflow engine and not well structured queue engine. By running jobs as database transactions, Queuert ensures data consistency and reliability, making it a great fit for applications that require robust background processing capabilities.
