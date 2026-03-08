---
title: Utilities
description: Composition helpers and standalone utility functions for the queuert core package.
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

Creates a compile-time-only type registry. No runtime validation is performed. The returned object carries type information used by `createClient` and `createWorker` to infer input, output, and chain-flow types.

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
  JobTypeRegistryDefinitions<typeof notificationJobTypes>
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

Creates a registry with runtime validation for input/output parsing. Each callback is invoked at the appropriate lifecycle point. Use this when you need schema validation (e.g. with Zod) beyond compile-time checks. Accepts an optional `TExternal` type parameter for cross-slice blocker reference validation (compile-time only, same as `defineJobTypes`).

- **getTypeNames** -- returns the known job type names; used by `mergeJobTypeRegistries` for runtime duplicate detection and deterministic routing

## mergeJobTypeRegistries

```typescript
const registry = mergeJobTypeRegistries(ordersRegistry, notificationsRegistry);
```

Merges multiple `JobTypeRegistry` instances into a single registry. Accepts two or more registries (variadic).

- **Compile-time duplicate detection** -- overlapping job type names produce a type error
- **Runtime duplicate detection** -- validated registries with overlapping type names throw `DuplicateJobTypeError`
- **Noop registries** (from `defineJobTypes`) merge trivially with no runtime overhead
- **Deterministic routing** -- validated registries use `getTypeNames()` to route calls directly, so validation errors propagate correctly
- **Mixed** -- validated registries are routed deterministically; noop types pass through as fallback

```typescript
const ordersRegistry = defineJobTypes<OrderJobTypes>();
const notificationsRegistry = defineJobTypes<NotificationJobTypes>();

// Compile-time error if types overlap
const registry = mergeJobTypeRegistries(ordersRegistry, notificationsRegistry);

const client = await createClient({ registry, stateAdapter });
```

## defineJobTypeProcessors

```typescript
const orderProcessors = defineJobTypeProcessors(orderJobTypes, {
  "orders.create": {
    attemptHandler: async ({ job, complete }) => complete(async () => ({ orderId: "123" })),
  },
});
```

Defines processors for a job type slice with full type inference. Handlers are type-checked against the slice's definitions (including external references from `TExternal`), then the return type is widened so it is assignable to any `InProcessWorkerProcessors` whose definitions include the slice's types.

- **First argument** -- a `JobTypeRegistry` (from `defineJobTypes` or `createJobTypeRegistry`), used for type inference only
- **Second argument** -- the processor map, typed against the registry's definitions
- **Return type** -- preserves the specific keys but widens the handler types, making it compatible with `createInProcessWorker` and `mergeJobTypeProcessors`

This replaces the `satisfies InProcessWorkerProcessors<...>` pattern, which required manually specifying `JobTypeRegistryDefinitions` and `ExternalJobTypeRegistryDefinitions` type parameters.

## mergeJobTypeProcessors

```typescript
const processors = mergeJobTypeProcessors(orderProcessors, notificationProcessors);
```

Merges processor maps from multiple slices into a single processors object. Accepts two or more processor maps (variadic).

- **Compile-time duplicate detection** -- overlapping processor keys produce a type error
- **Runtime duplicate detection** -- overlapping processor keys throw `DuplicateJobTypeError`
- **Widened return type** -- the result is assignable to `InProcessWorkerProcessors` expected by `createInProcessWorker`

Each slice defines processors using `defineJobTypeProcessors`, typed against its own job type definitions. This allows co-locating job type definitions and processor handlers per feature module.

```typescript
const worker = await createInProcessWorker({
  client,
  processors: mergeJobTypeProcessors(orderProcessors, notificationProcessors),
});
```

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
