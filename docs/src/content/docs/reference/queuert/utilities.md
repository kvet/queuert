---
title: Utilities
description: Composition helpers, factory functions, and job-type-system types for the queuert core package.
sidebar:
  order: 6
---

## defineJobTypes

```typescript
const jobTypes = defineJobTypes<{
  "send-email": {
    entry: true;
    input: { to: string; subject: string };
    output: { sent: true };
  };
  "process-attachment": {
    input: { fileUrl: string };
    output: { processedUrl: string };
    continueWith: { typeName: "send-email" };
  };
}>();
```

Creates a compile-time-only type registry. No runtime validation is performed. The returned object carries type information used by `createClient` and `createInProcessWorker` to infer input, output, and chain-flow types.

An optional second type parameter `TExternal` allows `blockers` to reference job types from other slices without owning them:

```typescript
const orderJobTypes = defineJobTypes<
  {
    "orders.confirm": {
      input: { orderId: string };
      output: { confirmed: boolean };
      blockers: [{ typeName: "notifications.send" }];
    };
  },
  // External types — available for blocker reference validation, not owned
  JobTypeDefinitions<typeof notificationJobTypes>
>();
```

- `T` = owned definitions (become the registry's phantom type via `JobTypeDefinitions`)
- `TExternal` = read-only reference context (defaults to `Record<never, never>`, extractable via `ExternalJobTypeDefinitions`)
- `blockers` validates against `T & TExternal`
- The registry's phantom type remains `T` only

## createJobTypes

```typescript
const registry = createJobTypes<MyJobTypes>({
  getTypeNames: () => Object.keys(schemas),
  validateEntry: (typeName) => { ... },
  parseInput: (typeName, input) => { ... },
  parseOutput: (typeName, output) => { ... },
  validateContinueWith: (typeName, target) => { ... },
  validateBlockers: (typeName, blockers) => { ... },
});
```

Creates a registry with runtime validation for input/output parsing. Each callback is invoked at the appropriate lifecycle point. Use this when you need schema validation (e.g. with Zod) beyond compile-time checks. Accepts an optional `TExternal` type parameter for cross-slice blocker reference validation (compile-time only, same as `defineJobTypes`).

- **getTypeNames** — returns the known job type names; used by `createClient` for runtime duplicate detection and deterministic routing when merging slices

## createProcessors

```typescript
const orderProcessors = createProcessors({
  client,
  jobTypes,
  processors: {
    "orders.create": {
      attemptHandler: async ({ job, complete }) => complete(async () => ({ orderId: "123" })),
    },
  },
});
```

Defines a processor registry. Handlers are type-checked against the client's full job type definitions — the returned registry may implement any subset of those types. Cross-slice `continueWith` / blocker references resolve against the client's merged defs, so no slice-level wiring is needed.

- **client** — a `Client` instance; its type parameters drive handler inference (state adapter + job types)
- **processors** — the processor map, typed against the client's definitions
- **attemptMiddleware** — optional middleware tuple applied to every handler in this registry. Ctx injected via `next(ctx)` is typed into each `attemptHandler`, `prepareCallback`, and `completeCallback` option bag. Runs in onion order (first middleware outermost).
- **backoffConfig** — default backoff for every processor in this registry. Overridden by the per-processor value. Falls back to the library default when absent (10s initial, 2× multiplier, 5min max).
- **leaseConfig** — default lease for every processor in this registry. Overridden by the per-processor value. Falls back to the library default when absent (60s lease, 30s renewal).
- **Return type** — a `Processors` carrying the client's definitions via phantom symbols

## createInProcessStateAdapter

```typescript
import { createInProcessStateAdapter } from "queuert";

const stateAdapter = await createInProcessStateAdapter();
```

Creates a state adapter that holds all jobs and chains in memory. Suitable for:

- Single-process production apps that don't need state persistence across restarts
- Testing and examples
- Development and prototyping

Transactions are serializable (one-at-a-time) via an internal async lock — the same isolation model as SQLite's single-writer mode. Operations use per-`typeName` ordered sets and per-`chainId` maps, so acquisition, scheduling, and chain lookups work against small type/chain-scoped collections rather than scanning all jobs.

For multi-process deployments or state that must survive restarts, use a database-backed adapter (`@queuert/postgres`, `@queuert/sqlite`).

## createInProcessNotifyAdapter

```typescript
import { createInProcessNotifyAdapter } from "queuert";

const notifyAdapter = await createInProcessNotifyAdapter();
```

Creates a notify adapter that delivers job-arrival signals via in-process subscriptions. Useful whenever publisher and subscriber run in the same process — single-process apps, tests, and examples. For multi-process deployments, use `@queuert/postgres` (LISTEN/NOTIFY), `@queuert/redis` (pub/sub), or `@queuert/nats`.

## createConsoleLog

```typescript
const log = createConsoleLog();
```

Creates a simple console logger suitable for development. For production, implement a custom `Log` function that integrates with your logging library.

## rescheduleJob

Helper that throws `RescheduleJobError` from within an attempt handler to reschedule the job.

```typescript
function rescheduleJob(schedule: ScheduleOptions, cause?: unknown): never;
```

```typescript
attemptHandler: async ({ job, complete }) => {
  if (!isReady()) {
    rescheduleJob({ afterMs: 30_000 });
  }
  return complete(async () => ({ done: true }));
},
```

## Types

### JobTypes

```typescript
type JobTypes<TJobTypeDefinitions = unknown, TExternalJobTypeDefinitions = Record<never, never>> = {
  readonly getTypeNames: () => readonly string[];
  validateEntry: (typeName: string) => void;
  parseInput: (typeName: string, input: unknown) => unknown;
  parseOutput: (typeName: string, output: unknown) => unknown;
  validateContinueWith: (typeName: string, target: ResolvedJobTypeReference) => void;
  validateBlockers: (typeName: string, blockers: readonly ResolvedJobTypeReference[]) => void;
  readonly [definitionsSymbol]: TJobTypeDefinitions;
  readonly [externalDefinitionsSymbol]: TExternalJobTypeDefinitions;
};
```

The registry object accepted by `createClient` and `createInProcessWorker`.

- **getTypeNames** — returns the known type names; noop registries return `[]`, validated registries delegate to the config
- **validateEntry** — throws if the type name is not marked as an entry point
- **parseInput** / **parseOutput** — parse and return validated data, throwing on invalid shapes
- **validateContinueWith** / **validateBlockers** — verify chain-flow references at runtime

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

The shape of each job type in the type map passed to `defineJobTypes` or `createJobTypes`.

### JobTypeDefinitions

```typescript
type JobTypeDefinitions<T extends JobTypes<any>> = T[typeof definitionsSymbol];
```

Utility type that extracts the phantom job type definitions from a `JobTypes`. Use this instead of indexing the symbol property directly.

```typescript
const jobTypes = defineJobTypes<{
  "send-email": { entry: true; input: { to: string }; output: { sent: true } };
}>();

type MyDefs = JobTypeDefinitions<typeof jobTypes>;
// { "send-email": { entry: true; input: { to: string }; output: { sent: true } } }
```

### ExternalJobTypeDefinitions

```typescript
type ExternalJobTypeDefinitions<T extends JobTypes<any>> = T[typeof externalDefinitionsSymbol];
```

Utility type that extracts the external (cross-slice) phantom definitions from a `JobTypes`. Returns `Record<never, never>` when no external types were declared.

### Processors

Processor registry returned by `createProcessors`. Carries the client's job type definitions and per-entry attempt middleware via phantom symbols. Pass one or an array of them to `createInProcessWorker`.

### ProcessorDefinitions

```typescript
type ProcessorDefinitions<T extends Processors>;
```

Utility type that extracts the job type definitions carried on a `Processors` registry via its phantom symbol.

### Log

```typescript
type Log = (options: TypedLogEntry) => void;
```

Logger function type accepted by `createClient` and `createInProcessWorker`. Receives structured log entries with level, message, and contextual metadata. Implement a custom `Log` function to integrate with your logging library, or use `createConsoleLog()` for development.

## Adapter Interfaces

These interfaces are exported for adapter authors. Most users interact with adapters through factory functions from adapter packages.

**StateAdapter** abstracts database operations for job persistence. Generic over `TTxContext` (transaction context) and `TJobId` (ID type).

**NotifyAdapter** abstracts pub/sub notifications for worker coordination.

**ObservabilityAdapter** abstracts metrics and distributed tracing.

See [Adapter Architecture](/queuert/advanced/adapters/) for full interface definitions and design rationale.

## See Also

- [Client](/queuert/reference/queuert/client/) — Client API reference
- [Worker](/queuert/reference/queuert/worker/) — Worker and job processing reference
- [Entities](/queuert/reference/queuert/entities/) — `Job`, `JobChain`, and resolved variants
- [Errors](/queuert/reference/queuert/errors/) — Error classes reference
- [Adapter Architecture](/queuert/advanced/adapters/) — Full adapter interface definitions
