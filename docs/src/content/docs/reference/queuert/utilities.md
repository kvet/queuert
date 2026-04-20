---
title: Utilities
description: Composition helpers and standalone utility functions for the queuert core package.
sidebar:
  order: 6
---

## defineJobTypeRegistry

```typescript
const jobTypeRegistry = defineJobTypeRegistry<{
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
const orderJobTypeRegistry = defineJobTypeRegistry<
  {
    "orders.confirm": {
      input: { orderId: string };
      output: { confirmed: boolean };
      blockers: [{ typeName: "notifications.send" }];
    };
  },
  // External types — available for blocker reference validation, not owned
  JobTypeRegistryDefinitions<typeof notificationJobTypeRegistry>
>();
```

- `T` = owned definitions (become the registry's phantom type via `JobTypeRegistryDefinitions`)
- `TExternal` = read-only reference context (defaults to `Record<never, never>`, extractable via `ExternalJobTypeRegistryDefinitions`)
- `blockers` validates against `T & TExternal`
- The registry's phantom type remains `T` only

## createJobTypeRegistry

```typescript
const registry = createJobTypeRegistry<MyJobTypes>({
  getTypeNames: () => Object.keys(schemas),
  validateEntry: (typeName) => { ... },
  parseInput: (typeName, input) => { ... },
  parseOutput: (typeName, output) => { ... },
  validateContinueWith: (typeName, target) => { ... },
  validateBlockers: (typeName, blockers) => { ... },
});
```

Creates a registry with runtime validation for input/output parsing. Each callback is invoked at the appropriate lifecycle point. Use this when you need schema validation (e.g. with Zod) beyond compile-time checks. Accepts an optional `TExternal` type parameter for cross-slice blocker reference validation (compile-time only, same as `defineJobTypeRegistry`).

- **getTypeNames** — returns the known job type names; used by `mergeJobTypeRegistries` for runtime duplicate detection and deterministic routing

## mergeJobTypeRegistries

```typescript
const registry = mergeJobTypeRegistries({ slices: [ordersRegistry, notificationsRegistry] });
```

Merges multiple `JobTypeRegistry` instances into a single registry. Accepts an options bag with a `slices` array of two or more registries.

- **Compile-time duplicate detection** — overlapping job type names produce a type error
- **Runtime duplicate detection** — validated registries with overlapping type names throw `DuplicateJobTypeError`
- **Noop registries** (from `defineJobTypeRegistry`) merge trivially with no runtime overhead
- **Deterministic routing** — validated registries use `getTypeNames()` to route calls directly, so validation errors propagate correctly
- **Mixed** — validated registries are routed deterministically; noop types pass through as fallback

```typescript
const ordersRegistry = defineJobTypeRegistry<OrderJobTypes>();
const notificationsRegistry = defineJobTypeRegistry<NotificationJobTypes>();

// Compile-time error if types overlap
const jobTypeRegistry = mergeJobTypeRegistries({ slices: [ordersRegistry, notificationsRegistry] });

const client = await createClient({ jobTypeRegistry, stateAdapter });
```

## createJobTypeProcessorRegistry

```typescript
const orderJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
  client,
  jobTypeRegistry: orderJobTypeRegistry,
  processors: {
    "orders.create": {
      attemptHandler: async ({ job, complete }) => complete(async () => ({ orderId: "123" })),
    },
  },
});
```

Defines a processor registry for a job type slice with full type inference. Handlers are type-checked against the slice's definitions (including external references from `TExternal`). Returns a `JobTypeProcessorRegistry` that carries the slice's type definitions via phantom symbol properties.

- **client** — a `Client` instance, used to infer the state adapter type for proper handler typing
- **jobTypeRegistry** — a `JobTypeRegistry` (from `defineJobTypeRegistry` or `createJobTypeRegistry`), used for type inference
- **processors** — the processor map, typed against the registry's definitions
- **Return type** — a `JobTypeProcessorRegistry` carrying definitions and external definitions via phantom symbol properties

## mergeJobTypeProcessorRegistries

```typescript
const jobTypeProcessorRegistry = mergeJobTypeProcessorRegistries({
  slices: [orderJobTypeProcessorRegistry, notificationJobTypeProcessorRegistry],
});
```

Merges processor registries from multiple slices into a single registry. Accepts an options bag with a `slices` array of `JobTypeProcessorRegistry` instances.

- **Runtime duplicate detection** — overlapping processor keys throw `DuplicateJobTypeError`
- **Merged return type** — a `JobTypeProcessorRegistry` with unioned definitions, external definitions, and processor keys

Each slice defines processors using `createJobTypeProcessorRegistry`, typed against its own job type definitions. This allows co-locating job type definitions and processor handlers per feature module.

```typescript
const worker = await createInProcessWorker({
  client,
  jobTypeProcessorRegistry: mergeJobTypeProcessorRegistries({
    slices: [orderJobTypeProcessorRegistry, notificationJobTypeProcessorRegistry],
  }),
});
```

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

## See Also

- [Client](/queuert/reference/queuert/client/) — Client API reference
- [Worker](/queuert/reference/queuert/worker/) — Worker and job processing reference
- [Types](/queuert/reference/queuert/types/) — Job, JobChain, and configuration types
- [Errors](/queuert/reference/queuert/errors/) — Error classes reference
