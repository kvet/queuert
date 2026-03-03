---
title: Errors
description: Error classes for the queuert core package.
sidebar:
  order: 4
---

All error classes extend `Error`. Properties listed are `readonly`.

## JobNotFoundError

```typescript
class JobNotFoundError extends Error {
  readonly jobId: string | undefined;
}
```

Thrown when a job cannot be found by ID.

## JobChainNotFoundError

```typescript
class JobChainNotFoundError extends Error {
  readonly chainId: string | undefined;
}
```

Thrown when a job chain cannot be found by ID.

## JobAlreadyCompletedError

```typescript
class JobAlreadyCompletedError extends Error {
  readonly jobId: string | undefined;
}
```

Thrown when attempting to complete a job that is already completed.

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

Thrown by `createJobTypeRegistry` when runtime validation fails.

- **code** -- identifies the specific validation failure
- **typeName** -- the job type that failed validation
- **details** -- additional context about the failure

## WaitChainTimeoutError

```typescript
class WaitChainTimeoutError extends Error {
  readonly chainId: string | undefined;
  readonly timeoutMs: number | undefined;
}
```

Thrown by `awaitJobChain` when the timeout expires or the signal is aborted.

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

Thrown by `deleteJobChains` when external chains depend on the deletion targets as blockers. **references** lists each dependency, pairing the blocker **chainId** with the **referencedByJobId** that depends on it.

## HookNotRegisteredError

```typescript
class HookNotRegisteredError extends Error {
  readonly key: symbol;
}
```

Thrown when a transaction hook is accessed before being registered.

## See Also

- [Client](/queuert/reference/queuert/client/) — Client API reference
- [Worker](/queuert/reference/queuert/worker/) — Worker and job processing reference
- [Types](/queuert/reference/queuert/types/) — Job, JobChain, and configuration types
- [Error Handling](/queuert/guides/error-handling/) — Error handling patterns guide
