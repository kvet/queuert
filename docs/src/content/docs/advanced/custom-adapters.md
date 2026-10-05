---
title: Custom Adapters
description: Write your own state, notify, or validation adapter for any database client, message broker, or schema library and validate it with Queuert's conformance suite.
sidebar:
  order: 16
---

Queuert's adapter system is designed to be extended. You can implement the `StateAdapter` or `NotifyAdapter` interface from scratch for your own backend — a different database engine, message broker, or anything else. You can also write a **validation adapter** wrapping any schema library (Zod, Valibot, ArkType, TypeBox, or your own). The conformance suite validates that your implementation behaves correctly. It's the same suite Queuert uses internally, exposed as a framework-agnostic runner you embed in a single `test()` block.

## Custom NotifyAdapter

Implement the `NotifyAdapter` type exported from `queuert`. The interface has three notification channels (job scheduled, chain completed, attempt lost), each with a publish and a subscribe method, plus a `provideWakeHint`/`consumeWakeHint` pair that gates how many listeners actually wake on a job-scheduled notification (no-op for adapters without a counter primitive — see [Adapter Architecture](/queuert/advanced/adapters/#wake-hint-methods)) and a `close()` for releasing internal resources:

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

See the [Notify adapter examples](/queuert/examples/#notify-adapters) for end-to-end integrations across Redis, NATS, and PostgreSQL.

## Custom StateAdapter

Implement the `StateAdapter` type exported from `queuert`. This is a larger interface covering job creation, status transitions, attempt tracking, querying, and migrations. See the [Adapter Architecture](/queuert/advanced/adapters/) doc for the full contract and the [Conformance reference](/queuert/api/conformance/readme/) for what the suite tests.

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

See the [State adapter examples](/queuert/examples/#state-adapters) for end-to-end integrations across PostgreSQL and SQLite.

### Contract requirements

Queuert opens no transaction around job processing. The worker's own bookkeeping runs as single autocommit statements, and the only transaction an attempt touches is the user's, passed to `finish`. Correctness therefore comes from conditional writes in the adapter, not from locks Queuert holds. The conformance suite checks each of the following.

**The chain head row is the serialization point, and both sides write it.** Completing a chain (`completeJobs`) writes its head row. Adding a blocker on a chain writes that head row too: before `createJobs` or `continueJobs` with blockers, core calls `getChains({ chainIds, lock: "write", txCtx })`, which must perform a no-op `UPDATE` of each head (for example `SET chain_status = chain_status`) and return the chains, `undefined` for a missing one. A lock alone (`SELECT … FOR UPDATE`) is not enough: under REPEATABLE READ and SERIALIZABLE a lock-only row does not count as concurrently updated, so the completer would read a stale snapshot and leave the dependent job `blocked` behind a completed chain. With both sides writing, the race is a write-write conflict at every isolation level. `completeJobs` no longer requires its caller to pre-lock the head, and `addJobsBlockers` stays insert-only.

**Fenced writes are all-or-nothing.** `completeJobs`, `continueJobs` and `rescheduleJobs` accept an optional per-job `fence: { attempt, workerId }`, and `extendJobAttempt` requires one. A fenced write matches only `status = 'running' AND attempt = N AND attempt_by = workerId`. A miss returns `undefined` at that position and writes nothing — no job update, no head update, no continuation. Drive every derived write from the `RETURNING` of the fenced job `UPDATE` (for example `WITH done AS (UPDATE job … RETURNING …) UPDATE job h … FROM done`); putting the fence only in a CTE `SELECT` or only on the final statement is not enough. Where one statement cannot do it (SQLite `continueJobs`), run the fenced `UPDATE` first and insert continuations only for the rows it returned. `attempt` must only ever be incremented by `startJobAttempt`, so each acquisition has a unique attempt number.

**Skipping held chains in `startJobAttempt` is an optimisation.** The built-in adapters skip a candidate job whose chain head another transaction holds and try the next one. That avoids waiting, but correctness does not depend on it: an adapter that does not skip held heads is still correct, as long as two parallel callers never receive the same job.

**Signatures:**

- `startJobAttempt({ timeoutMsByTypeName, workerId, txCtx? })` — the keys of `timeoutMsByTypeName` are the type filter; set `attemptUntil` to now plus the acquired job type's timeout. Returns the job with its chain, or `undefined`.
- `extendJobAttempt({ jobId, fence, timeoutMs, txCtx? })` — returns `undefined` when the fence misses.
- `reclaimExpiredJobAttempt({ typeNames, ignoredJobIds?, lastAttemptError, txCtx? })` — returns an expired attempt to `pending` and stamps `lastAttemptAt` and `lastAttemptError` with the string core passes.
- `rescheduleJobs({ jobs: [{ jobId, schedule?, error?, fence? }], txCtx? })`, `completeJobs({ jobs: [{ jobId, output, fence? }], completedBy?, txCtx })`, `continueJobs({ jobs: [{ …, continueFromId, fence? }], completedBy?, txCtx })`.
- `getChains({ chainIds, lock?: "exclusive" | "write", txCtx })` — `lock` requires a `txCtx`.
- `txCtx` is optional on `startJobAttempt`, `extendJobAttempt`, `reclaimExpiredJobAttempt` and `rescheduleJobs`: without one, run the statement on the adapter's own connection in autocommit.

**Removed:** `withSavepoint` (on the adapter and on state providers), `hasBlockers` on `startJobAttempt`'s result, and `hasBlockedJobs` on `completeJobs`'s result — core now always calls `unblockJobs` after completing a chain.

## Custom validation adapter

Validation adapters are thin wrappers around schema libraries that produce a `JobTypes` registry. The conformance suite checks that:

- The adapter's six runtime methods (`getTypeNames`, `validateEntry`, `parseInput`, `parseOutput`, `validateContinueWith`, `validateBlockers`) behave correctly.
- Schema validation failures are wrapped in `JobTypeValidationError` with the right `code`, `typeName`, `cause`, and `details`.
- The schema-to-shape inference (`z.infer`, `Static<>`, `T["infer"]`, `v.InferOutput`, etc.) threads through to the phantom job type definitions correctly.

The last point is enforced **at compile time**: each builder in the fixture has a precise return type, so an inference bug in your adapter trips a TypeScript error at the call site of `runValidationAdapterConformance` — before the runtime suite even executes.

```ts
import { runValidationAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createMyJobTypes } from "./my-validation-adapter.js";

test("custom validation adapter passes conformance", async () => {
  await runValidationAdapterConformance(async () => ({
    basic: {
      buildEntry: () =>
        createMyJobTypes({
          main: {
            entry: true,
            input: schema({ id: "string" }),
            output: schema({ ok: "boolean" }),
          },
        }),
      buildNonEntry: () => createMyJobTypes(/* ... */),
      buildContinuationOnly: () => createMyJobTypes(/* ... */),
    },
    continuations: {
      buildNominal: () => createMyJobTypes(/* ... */),
      buildStructural: () => createMyJobTypes(/* ... */),
    },
    blockers: {
      buildNominal: () => createMyJobTypes(/* ... */),
      buildStructural: () => createMyJobTypes(/* ... */),
    },
    external: {
      buildWithExternalSlice: () => createMyJobTypes(/* ... */),
      buildWithExternalSlices: () => createMyJobTypes(/* ... */),
    },
  }));
});
```

The exact phantom shape each builder must produce is encoded in the [`ValidationConformanceFixture`](https://github.com/kvet/queuert/blob/main/packages/core/src/conformance/validation-adapter-cases.ts) type.

See the [Validation adapter examples](/queuert/examples/#validation) for end-to-end integrations across Zod, Valibot, ArkType, and TypeBox.

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
ConformanceError: 2/216 conformance cases failed (214 passed, 0 skipped)
  x continueJobs > inherits chainId from the parent and assigns a new job id
    expected 'chain-abc' to be 'chain-xyz'
  x addJobsBlockers > adds blockers and reports the blocker chain as incomplete
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

- [Conformance API Reference](/queuert/api/conformance/readme/) — full runner and type signatures
- [State Adapters](/queuert/integrations/state-adapters/) — supported drivers and provider interface
- [Notify Adapters](/queuert/integrations/notify-adapters/) — supported clients and provider interface
- [Adapter Architecture](/queuert/advanced/adapters/) — design philosophy and factory patterns
