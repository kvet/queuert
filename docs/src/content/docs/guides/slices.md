---
title: Feature Slices
description: Organize job types and processors into independent feature modules.
sidebar:
  order: 15
---

As your application grows, defining all job types and processors in a single file becomes unwieldy. Feature slices let you split them by domain — each slice owns its type definitions and processor handlers, composed together at the application level.

## Defining a Slice

A slice consists of two files: definitions and processors.

**Definitions** declare the job types for a feature:

```ts
// slice-orders-definitions.ts
import { defineJobTypeRegistry } from "queuert";

export const orderJobTypeRegistry = defineJobTypeRegistry<{
  "orders.create": { entry: true; input: { userId: string }; output: { orderId: string } };
  "orders.fulfill": { input: { orderId: string }; output: { fulfilled: boolean } };
}>();
```

**Processors** implement the handlers, typed against the slice's definitions:

```ts
// slice-orders-processors.ts
import { createJobTypeProcessorRegistry } from "queuert";
import { client } from "./client.js";
import { orderJobTypeRegistry } from "./slice-orders-definitions.js";

export const orderProcessorRegistry = createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
  "orders.create": {
    attemptHandler: async ({ job, complete }) =>
      complete(async ({ continueWith }) =>
        continueWith({ typeName: "orders.fulfill", input: { orderId: "123" } }),
      ),
  },
  "orders.fulfill": {
    attemptHandler: async ({ job, complete }) => complete(async () => ({ fulfilled: true })),
  },
});
```

`createJobTypeProcessorRegistry` type-checks each handler against the slice's own definitions, then returns a `JobTypeProcessorRegistry` that carries the slice's type definitions via phantom symbol properties. This enables lightweight compatibility checks when passed to `createInProcessWorker` or `mergeJobTypeProcessorRegistries`.

## Composing Slices

At the application level, merge registries and processors from all slices:

```ts
import {
  createClient,
  createInProcessWorker,
  mergeJobTypeRegistries,
  mergeJobTypeProcessorRegistries,
} from "queuert";
import { orderJobTypeRegistry } from "./slice-orders-definitions.js";
import { orderProcessorRegistry } from "./slice-orders-processors.js";
import { notificationJobTypeRegistry } from "./slice-notifications-definitions.js";
import { notificationProcessorRegistry } from "./slice-notifications-processors.js";

const registry = mergeJobTypeRegistries(orderJobTypeRegistry, notificationJobTypeRegistry);

const client = await createClient({ stateAdapter, notifyAdapter, registry });

const worker = await createInProcessWorker({
  client,
  processorRegistry: mergeJobTypeProcessorRegistries(
    orderProcessorRegistry,
    notificationProcessorRegistry,
  ),
});
```

`mergeJobTypeRegistries` detects overlapping keys at compile time and at runtime:

- **Compile-time** — overlapping type names produce a TypeScript error
- **Runtime** — validated registries with overlapping `getTypeNames()` throw `DuplicateJobTypeError`

`mergeJobTypeProcessorRegistries` detects overlapping processor keys at runtime, throwing `DuplicateJobTypeError`.

## Cross-Slice References

When a slice needs to reference job types from another slice — for example, declaring a blocker from the notifications domain — use the optional `TExternal` type parameter on `defineJobTypeRegistry`:

```ts
// slice-orders-definitions.ts
import { type JobTypeRegistryDefinitions, defineJobTypeRegistry } from "queuert";
import { type notificationJobTypeRegistry } from "./slice-notifications-definitions.js";

export const orderJobTypeRegistry = defineJobTypeRegistry<
  {
    "orders.place": {
      entry: true;
      input: { userId: string };
      continueWith: { typeName: "orders.confirm" };
    };
    "orders.confirm": {
      input: { orderId: string };
      output: { confirmed: boolean };
      blockers: [{ typeName: "notifications.send" }];
    };
  },
  // External types — available for blocker reference validation, not owned by this slice
  JobTypeRegistryDefinitions<typeof notificationJobTypeRegistry>
>();
```

- `T` (first parameter) = owned definitions — these become the registry's phantom type
- `TExternal` (second parameter) = read-only reference context, defaults to `Record<never, never>`
- `blockers` validates against entry types in `T & TExternal`
- The registry's phantom type remains `T` only — `TExternal` types are not included

This eliminates the need for "workflow slices" that duplicate type definitions just to make blocker references type-check. After merging with `mergeJobTypeRegistries`, all references resolve against the full set of definitions.

When writing processors for a slice with external references, `createJobTypeProcessorRegistry` automatically extracts both owned and external definitions from the registry:

```ts
// slice-orders-processors.ts
import { createJobTypeProcessorRegistry } from "queuert";
import { client } from "./client.js";
import { orderJobTypeRegistry } from "./slice-orders-definitions.js";

const orderProcessorRegistry = createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
  // handlers have full type inference for continueWith, blockers, etc.
});
```

## Naming Convention

Prefix job type names with the slice name to avoid collisions:

```
orders.create-order
orders.fulfill-order
notifications.send-notification
```

This also makes logs and dashboards easy to scan by feature.

## See Also

- [Utilities — mergeJobTypeRegistries](/queuert/reference/queuert/utilities/#mergejobtyperegistries) — API reference
- [Utilities — mergeJobTypeProcessorRegistries](/queuert/reference/queuert/utilities/#mergejobtypeprocessorregistries) — API reference
- [Type Safety](../type-safety/) — how Queuert enforces types end-to-end
- [showcase-slices example](https://github.com/kvet/queuert/blob/main/examples/showcase-slices/src/index.ts) — full runnable example
