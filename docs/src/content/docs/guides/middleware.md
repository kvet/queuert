---
title: Job Attempt Middleware
description: Wrap job attempts with cross-cutting logic — tracing, resource injection, audit, contextual logging.
sidebar:
  order: 19
---

`AttemptMiddleware` wraps a **job attempt** — the unit of work that includes the prepare phase, the handler, and the complete phase. Middleware lets you add cross-cutting logic (tracing spans, contextual loggers, audit trails, shared resources) without touching each individual handler.

A middleware has three optional hooks, each wrapping a different phase:

| Hook           | Wraps                               | Injects ctx into          |
| -------------- | ----------------------------------- | ------------------------- |
| `wrapHandler`  | the whole attempt handler           | `attemptHandler` options  |
| `wrapPrepare`  | the user-supplied prepare callback  | prepare-callback options  |
| `wrapComplete` | the user-supplied complete callback | complete-callback options |

All three accept a `next(ctx)` call that yields the inner layer. The object passed to `next` is merged into the callback options for that phase, and its type flows into the handler signature.

See the [Worker reference](/queuert/reference/queuert/worker/#attemptmiddleware) for the full type definition.

## When to use each hook

### `wrapHandler` — cross-cutting around the whole attempt

Use for concerns that span the full attempt: tracing spans, contextual loggers, per-job resources, error classification.

```ts
const tracing: AttemptMiddleware<any, { traceId: string }> = {
  wrapHandler: async ({ job, next }) => {
    const traceId = crypto.randomUUID();
    console.log(`[${traceId}] start ${job.typeName}`);
    try {
      return await next({ traceId });
    } finally {
      console.log(`[${traceId}] end`);
    }
  },
};
```

Inside the handler, `traceId` is typed:

```ts
attemptHandler: async ({ traceId, complete }) => {
  return complete(async () => ({
    /* ... */
  }));
};
```

### `wrapPrepare` — set up shared data inside the prepare transaction

Use when you want to load a resource once per attempt and make it available to the handler. The middleware runs inside the prepare transaction (so DB reads are consistent with the rest of the attempt).

```ts
const loadUser: AttemptMiddleware<any, {}, { user: User }> = {
  wrapPrepare: async ({ job, txCtx, next }) => {
    const user = await userRepo.findById(job.input.userId, { txCtx });
    return next({ user });
  },
};
```

The handler invokes the prepare callback explicitly to receive the injected ctx:

```ts
attemptHandler: async ({ prepare, complete }) => {
  const user = await prepare({ mode: "staged" }, async ({ user }) => user);
  return complete(async () => ({
    /* ... */
  }));
};
```

### `wrapComplete` — inject helpers used during completion

Use to inject helpers that are only meaningful in the complete transaction — audit recorders, outbox inserters, post-commit notifiers.

```ts
const audit: AttemptMiddleware<any, {}, {}, { audit: (event: string) => void }> = {
  wrapComplete: async ({ job, txCtx, next }) =>
    next({
      audit: (event) => auditRepo.insert({ event, jobId: job.id, txCtx }),
    }),
};
```

```ts
return complete(async ({ audit }) => {
  audit("order-placed");
  return {
    /* ... */
  };
});
```

## Composition and order

Multiple middlewares compose as an onion. The first middleware's "before" runs outermost:

```ts
attemptMiddleware: [tracing, audit];
// tracing before → audit before → handler → audit after → tracing after
```

Each `next(ctx)` call accumulates ctx for inner layers. The handler's final ctx is the intersection of all injected ctxs.

## Sharing middleware across registries

Middleware is declared on the processor registry, not the worker:

```ts
const registry = createProcessors({
  client,
  jobTypes,
  attemptMiddleware: [tracing, audit],
  processors: {
    /* ... */
  },
});
```

To share a common set of middleware across multiple registries (e.g. multiple [slices](/queuert/guides/slices/) merged into one worker), list them inline at each call site:

```ts
const orderRegistry = createProcessors({
  client,
  jobTypes,
  attemptMiddleware: [tracing, log, auditOrders],
  processors: {
    /* ... */
  },
});

const notificationRegistry = createProcessors({
  client,
  jobTypes,
  attemptMiddleware: [tracing, log, auditNotifications],
  processors: {
    /* ... */
  },
});
```

Per slice, handler ctx types reflect the actual middleware list for that registry — so `auditOrders` ctx is visible in order handlers but not notification handlers. Inline literals narrow tuple inference automatically; no `as const` is required.

## See also

- [Showcase example](https://github.com/kvet/queuert/tree/main/examples/showcase-middleware) — runnable end-to-end demo of all three hooks
- [Worker reference](/queuert/reference/queuert/worker/#attemptmiddleware) — full API
- [Slices guide](/queuert/guides/slices/) — splitting workflows across registries
