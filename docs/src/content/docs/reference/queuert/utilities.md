---
title: Utilities
description: Composition helpers and standalone utility functions for the queuert core package.
sidebar:
  order: 6
---

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

## mergeJobTypeProcessors

```typescript
const processors = mergeJobTypeProcessors(orderProcessors, notificationProcessors);
```

Merges processor maps from multiple slices into a single processors object. Accepts two or more processor maps (variadic).

- **Compile-time duplicate detection** -- overlapping processor keys produce a type error
- **Runtime duplicate detection** -- overlapping processor keys throw `DuplicateJobTypeError`
- **Widened return type** -- the result is assignable to `InProcessWorkerProcessors` expected by `createInProcessWorker`

Each slice defines processors typed against its own job type definitions using `satisfies InProcessWorkerProcessors`. This allows co-locating job type definitions and processor handlers per feature module.

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
