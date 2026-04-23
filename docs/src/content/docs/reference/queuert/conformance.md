---
title: Conformance
description: Test-framework-agnostic runner for validating custom state, notify, and validation adapters against Queuert's conformance suites.
sidebar:
  order: 7
---

Queuert's conformance test suites are available as a test-framework-agnostic runner so you can validate a custom state, notify, or validation adapter from inside any `test()` block (vitest, bun test, `node:test`, etc.). The runner has zero external dependencies — assertions are backed by `node:assert`.

Import from the `queuert/conformance` subpath:

```typescript
import {
  runNotifyAdapterConformance,
  runStateAdapterConformance,
  runValidationAdapterConformance,
  ConformanceError,
  type ConformanceReport,
} from "queuert/conformance";
```

## runNotifyAdapterConformance

Runs the notify adapter conformance suite against a user-supplied `NotifyAdapter`. Accepts a factory function that sets up the adapter and returns a fixture:

```typescript
await runNotifyAdapterConformance(async () => ({
  notifyAdapter,
  dispose: async () => {
    /* close clients */
  },
}));
```

Returns `Promise<ConformanceReport>`. Throws `ConformanceError` (with an aggregated report) if any case fails.

The factory is called once. The returned `dispose` runs after all cases regardless of outcome.

## runStateAdapterConformance

Runs the state adapter conformance suite against a user-supplied `StateAdapter`. Accepts a factory function that sets up the adapter and returns a fixture:

```typescript
await runStateAdapterConformance(async () => ({
  stateAdapter: adapter,
  poisonTransaction: async (txCtx) => {
    /* force a transaction abort */
  },
  reset: async () => {
    /* truncate tables between cases */
  },
  dispose: async () => {
    /* close connections, stop containers */
  },
}));
```

- **poisonTransaction** — optional. Forces the active transaction into an aborted state (e.g., PostgreSQL `SELECT 1 FROM nonexistent_table`). Required for backends that support mid-transaction poisoning (PostgreSQL). Cases that need it are reported with `status: "skip"` when the hook is omitted. SQLite does not support mid-transaction poisoning — omit this field.

The factory is called once. `reset` runs before each case to restore a clean slate (e.g., truncate tables). `dispose` runs after all cases regardless of outcome.

## runValidationAdapterConformance

Runs the validation adapter conformance suite against a user-supplied validation adapter (a thin wrapper around a schema library like Zod, Valibot, ArkType, or TypeBox). Accepts a factory function that returns a fixture of typed builders:

```typescript
await runValidationAdapterConformance(async () => ({
  basic: { buildEntry, buildNonEntry, buildContinuationOnly },
  continuations: { buildNominal, buildStructural },
  blockers: { buildNominal, buildStructural },
  external: { buildWithExternalSlice },
}));
```

Unlike state and notify conformance — which test a fixed runtime interface — validation adapters are wrappers whose primary value is **type inference** (`z.infer`, `Static<>`, etc.). Each builder's return type is precisely specified, so the adapter's schema-to-shape mapper must thread inference correctly to satisfy the fixture type at the runner call site. This makes the suite a combined runtime AND type-level conformance check.

Returns `Promise<ConformanceReport>`. Throws `ConformanceError` on any case failure.

The factory is called once. The optional `dispose` runs after all cases regardless of outcome.

## ValidationConformanceFixture

```typescript
type ValidationConformanceFixture = {
  dispose?: () => Promise<void>;
  basic: {
    buildEntry: () => JobTypes</* main with input { id: string }, output { ok: boolean } */>;
    buildNonEntry: () => JobTypes</* internal: non-entry */>;
    buildContinuationOnly: () => JobTypes</* main → next, no output on main */>;
  };
  continuations: {
    buildNominal: () => JobTypes</* step1 → step2 by name */>;
    buildStructural: () => JobTypes</* router → handler by input shape */>;
  };
  blockers: {
    buildNominal: () => JobTypes</* main blocked by 'auth' */>;
    buildStructural: () => JobTypes</* main blocked by anything with input { token: string } */>;
  };
  external: {
    buildWithExternalSlice: () => JobTypes<
      /* orders.* slice */,
      /* notifications.* external slice */
    >;
  };
};
```

Each builder constructs a registry of a precise shape using the adapter under test. The exact phantom defs each builder must produce are encoded in the return types — see [`ValidationConformanceFixture`](https://github.com/kvet/queuert/blob/main/packages/core/src/conformance/validation-adapter-cases.ts) for the full annotated definitions.

Conformance verifies the wrapper layer only — the six runtime methods (`getTypeNames`, `validateEntry`, `parseInput`, `parseOutput`, `validateContinueWith`, `validateBlockers`) and how core's `createJobTypes` wraps thrown errors into `JobTypeValidationError`. Compile-time validation rules (like rejecting blockers that reference continuation-only types) live in core's `ValidatedJobTypeDefinitions` and are tested there — the positive type checks above are sufficient to prove the adapter feeds them correctly.

## StateConformanceFixture

```typescript
type StateConformanceFixture = {
  stateAdapter: StateAdapter<any, any>;
  poisonTransaction?: (txCtx: any) => Promise<void>;
  reset?: () => Promise<void>;
  dispose?: () => Promise<void>;
};
```

## NotifyConformanceFixture

```typescript
type NotifyConformanceFixture = {
  notifyAdapter: NotifyAdapter;
  reset?: () => Promise<void>;
  dispose?: () => Promise<void>;
};
```

## Options

All three runners accept an optional second argument with the same shape:

```typescript
type StateConformanceOptions = {
  caseTimeoutMs?: number;
  onResult?: (result: ConformanceResult) => void;
};
```

- **caseTimeoutMs** — optional per-case timeout on the case body. When exceeded, the case is marked failed with a timeout error.
- **onResult** — fires after each case completes. Useful for streaming progress to the user's test reporter.

## ConformanceReport

```typescript
type ConformanceReport = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: ConformanceResult[];
};

type ConformanceResult = {
  name: string;
  status: "pass" | "fail" | "skip";
  error?: Error;
  cleanupError?: Error;
  skipReason?: string;
  durationMs: number;
};
```

Returned on a fully successful run. On any failure, `ConformanceError` is thrown instead — the full report is accessible via `err.report`.

A case is marked `"skip"` when it declines to run — for example, when a state adapter omits `poisonTransaction` for a backend that cannot support mid-transaction poisoning (SQLite). `skipReason` carries the explanation; `error` is left unset.

`cleanupError` is populated when the `cleanup` callback throws. For cases where the body passed, a cleanup failure flips the result to `"fail"` and is reported in `error`. For cases where the body already failed, the cleanup failure is preserved in `cleanupError` alongside the original `error` so neither is lost.

## ConformanceError

```typescript
class ConformanceError extends Error {
  readonly report: ConformanceReport;
}
```

Thrown when one or more cases fail. `error.message` is a human-readable summary with failed case names and their assertion messages, plus any cleanup failures from passing or failing cases. `error.cause` is an `AggregateError` preserving the original thrown errors (and their stack traces) so IDEs and CI tools can still render them.

## Expect

The runner passes a minimal `Expect` shim to each case's `run` callback. It covers the matchers used by the conformance suites and is backed by `node:assert/strict`:

- `.toBe`, `.toEqual`, `.toBeDefined`, `.toBeUndefined`, `.toBeNull`
- `.toBeGreaterThan`, `.toBeGreaterThanOrEqual`, `.toBeLessThan`, `.toBeLessThanOrEqual`
- `.toBeInstanceOf`, `.toContain`, `.toHaveLength`
- `.toThrow`
- `.not.` negation of all the above
- `.rejects.toThrow`
- `expect.poll(fn, { timeout, interval }).toBe(value)` / `.toEqual(value)`
- `expect.fail(message)`

This shim is internal to case execution — you don't need to import it to use `runNotifyAdapterConformance` / `runStateAdapterConformance`.

## See Also

- [Custom Adapters](/queuert/advanced/custom-adapters/) — writing and testing custom adapters with vitest, bun test, and `node:test` examples
- [State Adapters](/queuert/integrations/state-adapters/) — building a custom state provider
- [Notify Adapters](/queuert/integrations/notify-adapters/) — building a custom notify provider
