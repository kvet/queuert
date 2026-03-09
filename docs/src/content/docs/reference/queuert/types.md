---
title: Types
description: Job type system, entity types, and configuration types for the queuert core package.
sidebar:
  order: 4
---

## Job Type System

### JobTypeRegistry

```typescript
type JobTypeRegistry<
  TJobTypeDefinitions,
  TExternalJobTypeDefinitions = Record<never, never>,
  TNavigation extends BaseNavigationMap = BaseNavigationMap,
> = {
  getTypeNames: () => readonly string[];
  validateEntry: (typeName: string) => void;
  parseInput: (typeName: string, input: unknown) => unknown;
  parseOutput: (typeName: string, output: unknown) => unknown;
  validateContinueWith: (typeName: string, target: ResolvedJobTypeReference) => void;
  validateBlockers: (typeName: string, blockers: readonly ResolvedJobTypeReference[]) => void;
  readonly [definitionsSymbol]: TJobTypeDefinitions;
  readonly [externalDefinitionsSymbol]: TExternalJobTypeDefinitions;
  readonly [navigationSymbol]: TNavigation;
};
```

The registry object accepted by `createClient` and `createInProcessWorker`.

- **getTypeNames** -- returns the known type names; noop registries return `[]`, validated registries delegate to the config
- **validateEntry** -- throws if the type name is not marked as an entry point
- **parseInput** / **parseOutput** -- parse and return validated data, throwing on invalid shapes
- **validateContinueWith** / **validateBlockers** -- verify chain-flow references at runtime

### BaseJobTypeDefinition

```typescript
type BaseJobTypeDefinition = {
  entry?: boolean; // true for chain entry points
  input: unknown; // Job input data type
  output?: unknown; // Job output data type (terminal jobs)
  continueWith?: JobTypeReference; // Next job in the chain
  blockers?: readonly JobTypeReference[]; // External chain dependencies
};
```

The shape of each job type in the type map passed to `defineJobTypeRegistry` or `createJobTypeRegistry`.

- **entry** -- marks the type as a valid chain entry point
- **input** -- required for every job type
- **output** -- present on terminal jobs that produce a result
- **continueWith** -- names the next job type in the chain
- **blockers** -- declares external chain dependencies that must complete before the job runs

### JobTypeRegistryDefinitions

```typescript
type JobTypeRegistryDefinitions<T extends JobTypeRegistry<any>> = T[typeof definitionsSymbol];
```

Utility type that extracts the phantom job type definitions from a `JobTypeRegistry`. Use this instead of indexing the symbol property directly.

```typescript
const jobTypeRegistry = defineJobTypeRegistry<{
  "send-email": { entry: true; input: { to: string }; output: { sent: true } };
}>();

type MyDefs = JobTypeRegistryDefinitions<typeof jobTypeRegistry>;
// { "send-email": { entry: true; input: { to: string }; output: { sent: true } } }
```

### ExternalJobTypeRegistryDefinitions

```typescript
type ExternalJobTypeRegistryDefinitions<T extends JobTypeRegistry<any>> =
  T[typeof externalDefinitionsSymbol];
```

Utility type that extracts the external (cross-slice) phantom definitions from a `JobTypeRegistry`. Returns `Record<never, never>` when no external types were declared.

```typescript
const orderJobTypeRegistry = defineJobTypeRegistry<
  {
    "orders.confirm": {
      entry: true;
      input: { id: string };
      output: { ok: boolean };
      blockers: [{ typeName: "notifications.send" }];
    };
  },
  JobTypeRegistryDefinitions<typeof notificationJobTypeRegistry>
>();

type ExtDefs = ExternalJobTypeRegistryDefinitions<typeof orderJobTypeRegistry>;
// { "notifications.send": { ... } }
```

When using `createJobTypeProcessorRegistry`, external definitions are automatically extracted from the registry — no need to specify them manually.

### JobTypeRegistryNavigation

```typescript
type JobTypeRegistryNavigation<T extends JobTypeRegistry<any>> = T[typeof navigationSymbol];
```

Utility type that extracts the pre-computed navigation map from a `JobTypeRegistry`. The navigation map is a `NavigationMap` that pre-resolves chain topology at the type level — continuation targets, reachable entry points, input/output types, and blocker metadata per job type name.

### NavigationMap

```typescript
type NavigationMap<TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [K in keyof TJobTypeDefinitions & string]: {
    continuationTypes: string; // Union of resolved continueWith target type names
    reachingEntries: string; // Union of entry type names that can reach this type
    input: unknown; // Extracted input type
    output: unknown; // Extracted output type
    isEntry: boolean; // Whether this type is a chain entry point
    hasBlockers: boolean; // Whether this type declares blockers
    blockerRefs: readonly JobTypeReference[]; // Raw blocker references
  };
};
```

A compile-time map computed from job type definitions. Each entry pre-resolves the chain topology for a single job type name. Consumer types like `ChainJobTypeNames`, `EntryJobTypeDefinitions`, and `BlockerChains` operate on a `NavigationMap` rather than re-computing relationships from raw definitions.

`BaseNavigationMap` and `BaseNavigationEntry` are the unconstrained base types used in generic positions.

## Attempt Handler Types

These types describe the attempt handler function and its `prepare`/`complete` parameters. They are generic over the state adapter and job type definitions. Exported for use in type annotations and `satisfies` expressions when defining processors in separate files.

### AttemptHandler

The core function called for each job attempt. Receives `signal`, `job`, `prepare`, and `complete`.

### AttemptComplete

The typed `complete` function provided to the attempt handler. Call it to finalize the job — either return the output to complete the chain, or call `continueWith` to extend it.

### AttemptCompleteCallback

The callback passed to `complete()`. Receives `AttemptCompleteOptions` and returns the result.

### AttemptCompleteOptions

Options received by the complete callback: `continueWith` (to extend the chain), `transactionHooks`, and the transaction context.

### AttemptPrepare

The typed `prepare` function provided to the attempt handler. Controls the processing mode and optionally runs a callback within the prepare transaction.

### AttemptPrepareCallback

The callback passed to `prepare(options, callback)`. Receives the transaction context.

### AttemptPrepareOptions

```typescript
type AttemptPrepareOptions = { mode: "atomic" | "staged" };
```

Configuration for the prepare phase. `"atomic"` runs prepare and complete in the same transaction. `"staged"` commits prepare first, then runs complete in a new transaction with lease renewal.

## Entity Types

### Job

```typescript
type Job<TJobId, TJobTypeName, TChainTypeName, TInput> = {
  id: TJobId;
  chainId: TJobId;
  typeName: TJobTypeName;
  chainTypeName: TChainTypeName;
  chainIndex: number;
  input: TInput;
  createdAt: Date;
  scheduledAt: Date;
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running"; leasedBy?: string; leasedUntil?: Date }
  | { status: "completed"; completedAt: Date; completedBy: string | null }
);
```

A discriminated union on **status**. All jobs carry their chain identity via **chainId** and **chainTypeName**, and their position via **chainIndex**. The **running** variant includes lease metadata. The **completed** variant includes completion timestamps and the worker identity.

### ResolvedJobWithBlockers

```typescript
type ResolvedJobWithBlockers<TJobId, TNavigationMap, TJobTypeName, TChainTypeName> = Job<
  TJobId,
  TJobTypeName,
  TChainTypeName,
  TNavigationMap[TJobTypeName]["input"]
> & {
  blockers: CompletedBlockerChains<TJobId, TNavigationMap, TJobTypeName>;
};
```

A `Job` extended with resolved blocker chains. **blockers** contains the completed blocker chain data, available inside worker handlers when the job type declares blockers.

### JobStatus

```typescript
type JobStatus = "blocked" | "pending" | "running" | "completed";
```

The four possible job states. Used in list filters and discriminated union narrowing.

### JobChain

```typescript
type JobChain<TJobId, TChainTypeName, TInput, TOutput> = {
  id: TJobId;
  typeName: TChainTypeName;
  input: TInput;
  createdAt: Date;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running" }
  | { status: "completed"; output: TOutput; completedAt: Date }
);
```

A discriminated union on **status**. Represents the full lifecycle of a chain from creation to completion. The **completed** variant includes the chain output and completion timestamp.

### CompletedJobChain

`JobChain` narrowed to `status: "completed"`. Guarantees the presence of **output** and **completedAt** fields.

### JobChainStatus

```typescript
type JobChainStatus = "blocked" | "pending" | "running" | "completed";
```

The four possible chain states. Used in list filters and discriminated union narrowing.

## Pagination

### Page

```typescript
type Page<T> = {
  items: T[];
  nextCursor: string | null; // null when no more pages
};
```

Cursor-based pagination wrapper returned by all list methods. Pass **nextCursor** back as the `cursor` parameter to fetch the next page. A `null` cursor indicates the final page.

### OrderDirection

```typescript
type OrderDirection = "asc" | "desc";
```

Controls sort order in list queries. Most list methods default to `"desc"`.

## Configuration Types

### ScheduleOptions

```typescript
type ScheduleOptions = { at: Date; afterMs?: never } | { at?: never; afterMs: number };
```

Deferred job scheduling. The two fields are mutually exclusive.

- **at** -- schedules for an absolute timestamp
- **afterMs** -- schedules relative to the current time

### DeduplicationOptions

```typescript
type DeduplicationOptions = {
  key: string; // Deduplication key
  scope?: "incomplete" | "any"; // Match incomplete chains only or all (default: "incomplete")
  windowMs?: number; // Time window for "any" scope
};
```

Chain deduplication configuration passed to `startJobChain`.

- **key** -- identifies the logical operation
- **scope** -- match incomplete chains only (`"incomplete"`, the default) or all chains within the time window (`"any"`)
- **windowMs** -- required when scope is `"any"`

### BackoffConfig

```typescript
type BackoffConfig = {
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier?: number; // Default: 2.0
};
```

Exponential backoff parameters.

- **initialDelayMs** -- delay after the first failure
- **maxDelayMs** -- caps the delay
- **multiplier** -- controls exponential growth (default: `2.0`)

### RetryConfig

```typescript
type RetryConfig = BackoffConfig & {
  maxAttempts?: number;
};
```

Extends `BackoffConfig` with **maxAttempts**, the maximum number of retry attempts before the job is abandoned.

### LeaseConfig

```typescript
type LeaseConfig = {
  leaseMs: number;
  renewIntervalMs: number;
};
```

Controls job lease duration and renewal.

- **leaseMs** -- total lease time granted to a worker
- **renewIntervalMs** -- how often the worker renews the lease before it expires

### TypedAbortSignal

```typescript
type TypedAbortSignal<T> = Omit<AbortSignal, "reason"> & {
  readonly reason: T | undefined;
};
```

An `AbortSignal` with a typed **reason**. Used in worker handlers to communicate why a job was aborted.

### JobAbortReason

```typescript
type JobAbortReason = "taken_by_another_worker" | "error" | "not_found" | "already_completed";
```

The possible abort reasons passed through `TypedAbortSignal` in worker job handlers.

- **taken_by_another_worker** -- the lease was lost to another worker
- **error** -- an internal failure occurred
- **not_found** -- the job no longer exists
- **already_completed** -- the job was already completed

## Logging

### Log

```typescript
type Log = (entry: TypedLogEntry) => void;
```

Logger function type accepted by `createClient` and `createWorker`. Receives structured log entries with level, message, and contextual metadata.

### createConsoleLog

```typescript
const log = createConsoleLog();
```

Creates a simple console logger suitable for development. For production, implement a custom `Log` function that integrates with your logging library.

## Adapter Interfaces

These interfaces are exported for adapter authors. Most users interact with adapters through factory functions from adapter packages.

**StateAdapter** abstracts database operations for job persistence. Generic over `TTxContext` (transaction context) and `TJobId` (ID type).

**NotifyAdapter** abstracts pub/sub notifications for worker coordination. Methods: `notifyJobScheduled`, `listenJobScheduled`, `notifyJobChainCompleted`, `listenJobChainCompleted`, `notifyJobOwnershipLost`, `listenJobOwnershipLost`.

**ObservabilityAdapter** abstracts metrics and distributed tracing. Includes worker events, job events, chain events, durations, gauges, and tracing spans.

See [Adapter Architecture](/queuert/advanced/adapters/) for full interface definitions and design rationale.

## See Also

- [Client](/queuert/reference/queuert/client/) — Client API reference
- [Worker](/queuert/reference/queuert/worker/) — Worker and job processing reference
- [Utilities](/queuert/reference/queuert/utilities/) — Composition helpers and utility functions
- [Errors](/queuert/reference/queuert/errors/) — Error classes reference
- [Core Concepts](/queuert/getting-started/core-concepts/) — Job chain model introduction
- [Type Safety](/queuert/guides/type-safety/) — Type safety features guide
- [Adapter Architecture](/queuert/advanced/adapters/) — Full adapter interface definitions
