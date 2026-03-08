---
title: Job Blockers
description: Fan-out/fan-in job dependencies.
sidebar:
  order: 6
---

Jobs can depend on other job chains to complete before they start. A job with incomplete blockers starts as `blocked` and transitions to `pending` when all blockers complete.

```ts
type Definitions = {
  "fetch-data": {
    entry: true;
    input: { url: string };
    output: { data: string };
  };
  "process-all": {
    entry: true;
    input: { ids: string[] };
    output: { results: string[] };
    blockers: [{ typeName: "fetch-data" }, ...{ typeName: "fetch-data" }[]]; // Wait for multiple fetches (tuple with rest)
  };
};

// Start with blockers (transactionHooks required — see Transaction Hooks guide)
const fetchBlockers = await withTransactionHooks(async (transactionHooks) =>
  Promise.all([
    client.startJobChain({ transactionHooks, typeName: "fetch-data", input: { url: "/a" } }),
    client.startJobChain({ transactionHooks, typeName: "fetch-data", input: { url: "/b" } }),
  ]),
);
await withTransactionHooks(async (transactionHooks) =>
  client.startJobChain({
    transactionHooks,
    typeName: "process-all",
    input: { ids: ["a", "b", "c"] },
    blockers: fetchBlockers,
  }),
);

// Access completed blockers in worker
const worker = await createInProcessWorker({
  client,
  processorRegistry: defineJobTypeProcessorRegistry(client, jobTypes, {
    "process-all": {
      attemptHandler: async ({ job, complete }) => {
        const results = job.blockers.map((b) => b.output.data);
        return complete(() => ({ results }));
      },
    },
  }),
});

const stop = await worker.start();
```

See [examples/showcase-blockers](https://github.com/kvet/queuert/tree/main/examples/showcase-blockers) for a complete working example demonstrating fan-out/fan-in and fixed blocker slots. See also [Transaction Hooks](../transaction-hooks/) and [Chain Patterns](../chain-patterns/).
