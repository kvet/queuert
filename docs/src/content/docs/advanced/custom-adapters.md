---
title: Custom Adapters
description: Write your own state or notify adapter for any database client, ORM, or message broker and validate it with Queuert's conformance suite.
sidebar:
  order: 16
---

Queuert's adapter system is designed to be extended. You can implement the `StateAdapter` or `NotifyAdapter` interface from scratch for your own backend — a different database engine, message broker, or anything else. The conformance suite validates that your implementation behaves correctly. It's the same suite Queuert uses internally, exposed as a framework-agnostic runner you embed in a single `test()` block.

## Custom NotifyAdapter

Implement the `NotifyAdapter` type exported from `queuert`. The interface has three notification channels (job scheduled, chain completed, ownership lost), each with a publish and a subscribe method:

```ts
import { runNotifyAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createMyNotifyAdapter } from "./my-notify-adapter.js";

test("custom notify adapter passes conformance", async () => {
  await runNotifyAdapterConformance(async () => {
    const notifyAdapter = createMyNotifyAdapter();
    return {
      notifyAdapter,
      dispose: async () => {
        /* teardown */
      },
    };
  });
}, 60_000);
```

## Custom StateAdapter

Implement the `StateAdapter` type exported from `queuert`. This is a larger interface covering job creation, status transitions, leasing, querying, and migrations. See the [Adapter Architecture](/queuert/advanced/adapters/) doc for the full contract and the [Conformance reference](/queuert/reference/queuert/conformance/) for what the suite tests.

```ts
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createMyStateAdapter } from "./my-state-adapter.js";

test("custom state adapter passes conformance", async () => {
  await runStateAdapterConformance(async () => {
    const stateAdapter = createMyStateAdapter();
    return {
      stateAdapter,
      reset: async () => {
        /* truncate tables */
      },
      dispose: async () => {
        /* teardown */
      },
    };
  });
}, 300_000);
```

## Running under other test frameworks

The runner is framework-agnostic — it throws on failure. Any framework that reports a thrown error as a test failure will work.

### bun test

```ts
import { test } from "bun:test";
import { runStateAdapterConformance } from "queuert/conformance";

test(
  "custom state adapter passes conformance",
  async () => {
    await runStateAdapterConformance(async () => /* … */);
  },
  { timeout: 300_000 },
);
```

### node:test

```ts
import test from "node:test";
import { runStateAdapterConformance } from "queuert/conformance";

test(
  "custom state adapter passes conformance",
  { timeout: 300_000 },
  async () => {
    await runStateAdapterConformance(async () => /* … */);
  },
);
```

### mocha / jest / jasmine

Same shape — wrap the `await runStateAdapterConformance(...)` call in whatever `it()` or `test()` your framework provides. Raise the per-test timeout to `300_000` for state conformance (notify conformance fits inside 60s).

## What happens on failure

On any case failure the runner throws a `ConformanceError` whose message summarizes which cases failed plus their assertion messages:

```
ConformanceError: 2/132 conformance cases failed (130 passed, 0 skipped)
  x createJobs > preserves provided chainId
    expected 'chain-abc' to be 'chain-xyz'
  x addJobsBlockers > marks job blocked when incomplete blockers present
    expected 'pending' to be 'blocked'
```

`err.cause` is an `AggregateError` holding the original thrown errors with full stacks, so IDEs and CI viewers can jump to the failing case source line inside `queuert/conformance`.

For per-case progress, supply an `onResult` callback:

```ts
await runNotifyAdapterConformance(factory, {
  onResult: (result) => {
    console.log(`${result.status === "pass" ? "✓" : "✗"} ${result.name}`);
  },
});
```

## See Also

- [Conformance API Reference](/queuert/reference/queuert/conformance/) — full runner and type signatures
- [State Adapters](/queuert/integrations/state-adapters/) — supported drivers and provider interface
- [Notify Adapters](/queuert/integrations/notify-adapters/) — supported clients and provider interface
- [Adapter Architecture](/queuert/advanced/adapters/) — design philosophy and factory patterns
