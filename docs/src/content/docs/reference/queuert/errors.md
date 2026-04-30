---
title: Errors
description: Error classes for the queuert core package.
sidebar:
  order: 5
---

All error classes extend `Error`. Properties listed are `readonly`.

## JobNotFoundError

```typescript
class JobNotFoundError extends Error {
  readonly jobId: string | undefined;
}
```

Thrown when a job cannot be found by ID.

## ChainNotFoundError

```typescript
class ChainNotFoundError extends Error {
  readonly chainId: string | undefined;
}
```

Thrown when a chain cannot be found by ID. Raised by `awaitChain` and `completeChain`. Deletion APIs do not throw this: `deleteChain` returns `undefined` for missing chains, and `deleteChains` silently skips missing IDs.

## JobAlreadyCompletedError

```typescript
class JobAlreadyCompletedError extends Error {
  readonly jobId: string | undefined;
}
```

Thrown when attempting to complete a job that is already completed.

## JobNotTriggerableError

```typescript
class JobNotTriggerableError extends Error {
  readonly jobId: string | undefined;
  readonly status: string | undefined;
}
```

Thrown by `triggerJob` and `triggerJobs` when a job is not in a triggerable state. Only `pending` jobs can be triggered. `triggerJobs` validates atomically — it throws on the first invalid job before triggering any.

## JobTakenByAnotherWorkerError

```typescript
class JobTakenByAnotherWorkerError extends Error {
  readonly jobId: string | undefined;
  readonly workerId: string | undefined;
  readonly leasedBy: string | null | undefined;
}
```

Thrown during job processing when another worker has acquired the job's lease.

## JobTypeMismatchError

```typescript
class JobTypeMismatchError extends Error {
  readonly expectedTypeName: string;
  readonly actualTypeName: string;
}
```

Thrown when a **typeName** parameter doesn't match the actual type of a job or chain.

## JobTypeValidationError

```typescript
class JobTypeValidationError extends Error {
  readonly code: JobTypeValidationErrorCode;
  readonly typeName: string;
  readonly details: Record<string, unknown>;
}

type JobTypeValidationErrorCode =
  | "not_entry_point"
  | "invalid_continuation"
  | "invalid_blockers"
  | "invalid_input"
  | "invalid_output";
```

Thrown by `createJobTypes` when runtime validation fails.

- **code** — identifies the specific validation failure
- **typeName** — the job type that failed validation
- **details** — additional context about the failure

## WaitChainTimeoutError

```typescript
class WaitChainTimeoutError extends Error {
  readonly chainId: string | undefined;
  readonly timeoutMs: number | undefined;
}
```

Thrown by `awaitChain` when the timeout expires or the signal is aborted.

## RescheduleJobError

```typescript
class RescheduleJobError extends Error {
  readonly schedule: ScheduleOptions;
}
```

Thrown by the `rescheduleJob` helper to reschedule a job from within an attempt handler. The worker catches this and reschedules the job automatically.

## BlockerReferenceError

```typescript
class BlockerReferenceError extends Error {
  readonly references: readonly BlockerReference[];
}

type BlockerReference = {
  chainId: string;
  referencedByJobId: string;
};
```

Thrown by `deleteChains` when external chains depend on the deletion targets as blockers. **references** lists each dependency, pairing the blocker **chainId** with the **referencedByJobId** that depends on it.

## DuplicateJobTypeError

```typescript
class DuplicateJobTypeError extends Error {
  readonly duplicateTypeNames: readonly string[];
}
```

Thrown by `createClient` (when merging an array of `JobTypes` slices) and `createInProcessWorker` (when merging an array of `Processors` slices) if slices have overlapping type names. **duplicateTypeNames** lists the conflicting keys.

## UnknownJobTypeError

```typescript
class UnknownJobTypeError extends Error {
  readonly typeName: string;
  readonly registeredTypeNames: readonly string[];
}
```

Thrown by a merged `JobTypes` (built from an array of slices passed to `createClient`) when an operation references a type name that no slice owns. Only raised when every slice in the merge was built with `createJobTypes` — mixed merges that include a `defineJobTypes` slice keep no-op pass-through semantics for unknown types.

- **typeName** — the type that no slice claimed
- **registeredTypeNames** — the type names registered across the merged slices, useful for diagnosing typos

## HookNotRegisteredError

```typescript
class HookNotRegisteredError extends Error {
  readonly key: symbol;
}
```

Thrown when a transaction hook is accessed before being registered.

## TransactionContextRequiredError

```typescript
class TransactionContextRequiredError extends Error {}
```

Thrown when a mutating client method (e.g. `startChain`, `triggerJob`, `triggerJobs`, `deleteChain`, `deleteChains`) is called without a `tx` provided by `withTransaction`. Mutations must run inside a transaction so the transactional outbox pattern holds.

## See Also

- [Client](/queuert/reference/queuert/client/) — Client API reference
- [Worker](/queuert/reference/queuert/worker/) — Worker and job processing reference
- [Entities](/queuert/reference/queuert/entities/) — `Job`, `Chain`, and resolved variants
- [Utilities](/queuert/reference/queuert/utilities/) — Composition helpers and utility functions
- [Error Handling](/queuert/guides/error-handling/) — Error handling patterns guide
