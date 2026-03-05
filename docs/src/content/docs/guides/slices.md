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
import { defineJobTypes } from "queuert";

export const orderJobTypes = defineJobTypes<{
  "orders.create": { entry: true; input: { userId: string }; output: { orderId: string } };
  "orders.fulfill": { input: { orderId: string }; output: { fulfilled: boolean } };
}>();
```

**Processors** implement the handlers, typed against the slice's definitions:

```ts
// slice-orders-processors.ts
import { type InProcessWorkerProcessors, type JobTypeRegistryDefinitions } from "queuert";
import { type stateAdapter } from "./adapters.js";
import { type orderJobTypes } from "./slice-orders-definitions.js";

export const orderProcessors = {
  "orders.create": {
    attemptHandler: async ({ job, complete }) =>
      complete(async ({ continueWith }) =>
        continueWith({ typeName: "orders.fulfill", input: { orderId: "123" } }),
      ),
  },
  "orders.fulfill": {
    attemptHandler: async ({ job, complete }) => complete(async () => ({ fulfilled: true })),
  },
} satisfies InProcessWorkerProcessors<
  typeof stateAdapter,
  JobTypeRegistryDefinitions<typeof orderJobTypes>
>;
```

Using `satisfies` ensures each processor is type-checked against its own slice's definitions without widening the type.

## Composing Slices

At the application level, merge registries and processors from all slices:

```ts
import {
  createClient,
  createInProcessWorker,
  mergeJobTypeRegistries,
  mergeJobTypeProcessors,
} from "queuert";
import { orderJobTypes } from "./slice-orders-definitions.js";
import { orderProcessors } from "./slice-orders-processors.js";
import { notificationJobTypes } from "./slice-notifications-definitions.js";
import { notificationProcessors } from "./slice-notifications-processors.js";

const registry = mergeJobTypeRegistries(orderJobTypes, notificationJobTypes);

const client = await createClient({ stateAdapter, notifyAdapter, registry });

const worker = await createInProcessWorker({
  client,
  processors: mergeJobTypeProcessors(orderProcessors, notificationProcessors),
});
```

Both merge functions detect overlapping keys at compile time and at runtime:

- **Compile-time** — overlapping type names or processor keys produce a TypeScript error
- **Runtime** — validated registries with overlapping `getTypeNames()` throw `DuplicateJobTypeError`

## Naming Convention

Prefix job type names with the slice name to avoid collisions:

```
orders.create-order
orders.fulfill-order
notifications.send-notification
```

This also makes logs and dashboards easy to scan by feature.

## See Also

- [Utilities — mergeJobTypeRegistries](/queuert/reference/queuert/utilities/#mergejobttyperegistries) — API reference
- [Utilities — mergeJobTypeProcessors](/queuert/reference/queuert/utilities/#mergejobtypeprocessors) — API reference
- [Type Safety](../type-safety/) — how Queuert enforces types end-to-end
- [showcase-slices example](https://github.com/kvet/queuert/blob/main/examples/showcase-slices/src/index.ts) — full runnable example
