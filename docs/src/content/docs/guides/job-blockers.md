---
title: Job Blockers
description: Fan-out/fan-in job dependencies.
sidebar:
  order: 6
---

Jobs can depend on other chains to complete before they start. A job with incomplete blockers starts as `blocked` and transitions to `pending` when all blockers complete.

```d2
...@../_classes.d2

direction: right

fd1: "fetch-data #1\ndone" { class: job-done; width: 200; height: 80 }
fd2: "fetch-data #2\ndone" { class: job-done; width: 200; height: 80 }
fd3: "fetch-data #3\ndone" { class: job-done; width: 200; height: 80 }

target: "process-all\nblocked → ready" { class: job-accent; width: 240; height: 90 }

fd1 -> target { class: flow-green }
fd2 -> target { class: flow-green }
fd3 -> target { class: flow-green }
```

```ts
const jobTypes = defineJobTypes<{
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
}>();

// Start with blockers (transactionHooks required — see Transaction Hooks guide)
const fetchBlockers = await withTransactionHooks(async (transactionHooks) =>
  client.startChains({
    transactionHooks,
    items: [
      { typeName: "fetch-data", input: { url: "/a" } },
      { typeName: "fetch-data", input: { url: "/b" } },
    ],
  }),
);
await withTransactionHooks(async (transactionHooks) =>
  client.startChain({
    transactionHooks,
    typeName: "process-all",
    input: { ids: ["a", "b", "c"] },
    blockers: fetchBlockers,
  }),
);

// Access completed blockers in worker
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "process-all": {
        attemptHandler: async ({ job, complete }) => {
          const results = job.blockers.map((b) => b.output.data);
          return complete(() => ({ results }));
        },
      },
    },
  }),
});

const stop = await worker.start();
```

## Blocker References

The example above uses **nominal references** — `{ typeName: "fetch-data" }`. Blockers also support fixed tuple slots, variadic rest slots, and **structural references** (`{ input: {...} }`) that match any entry job type with a compatible input shape. Blocker outputs are fully typed in the processor based on the reference. See [Job Type References](/queuert/advanced/job-type-references/) for details and examples.

See [examples/showcase-blockers](https://github.com/kvet/queuert/tree/main/examples/showcase-blockers) for a complete working example demonstrating fan-out/fan-in and fixed blocker slots. See also [Transaction Hooks](../transaction-hooks/) and [Chain Patterns](../chain-patterns/).
