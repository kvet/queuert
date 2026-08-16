---
title: Job Attempt Middleware
description: Wrap job attempts with cross-cutting logic — tracing, resource injection, audit, contextual logging.
sidebar:
  order: 19
---

`AttemptMiddleware` wraps a **job attempt** — the unit of work that includes the prepare phase, the handler, and the complete phase. Middleware lets you add cross-cutting logic (tracing spans, contextual loggers, audit trails, shared resources) without touching each individual handler.

A middleware has four optional hooks, each wrapping a different phase:

| Hook           | Wraps                               | Injects ctx into          |
| -------------- | ----------------------------------- | ------------------------- |
| `wrapHandler`  | the whole attempt handler           | `attemptHandler` options  |
| `wrapPrepare`  | the user-supplied prepare callback  | prepare-callback options  |
| `wrapStep`     | each user-supplied step callback    | step-callback options     |
| `wrapComplete` | the user-supplied complete callback | complete-callback options |

All four accept a `next(ctx)` call that yields the inner layer. The object passed to `next` is merged into the callback options for that phase, and its type flows into the handler signature.

See the [Worker reference](/queuert/api/core/type-aliases/attemptmiddleware/) for the full type definition.

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
    } catch (error) {
      console.error(`[${traceId}] attempt failed`, error);
      throw error;
    } finally {
      console.log(`[${traceId}] end`);
    }
  },
};
```

A failing attempt propagates through `next()` — the middleware can observe, log, or enrich the error. After the middleware chain unwinds, the engine catches the error, reschedules the job, and returns normally. Always re-throw the error so the engine can handle it; swallowing the error without calling `complete` still fails the attempt.

Inside the handler, `traceId` is typed:

```ts
attemptHandler: async ({ traceId, complete }) => {
  return complete(async ({ finish }) =>
    finish({
      output: {
        /* ... */
      },
    }),
  );
};
```

### `wrapPrepare` — set up shared data inside the prepare transaction

Use when you want to load a resource once per attempt and make it available to the handler. The middleware runs inside the prepare transaction (so DB reads are consistent with the rest of the attempt).

```ts
const loadUser: AttemptMiddleware<typeof stateAdapter, {}, { user: User }> = {
  wrapPrepare: async ({ job, txSql, next }) => {
    const [user] = await txSql`SELECT * FROM users WHERE id = ${job.input.userId}`;
    return next({ user });
  },
};
```

The handler invokes the prepare callback explicitly to receive the injected ctx:

```ts
attemptHandler: async ({ prepare, complete }) => {
  const user = await prepare({ mode: "staged" }, async ({ user }) => user);
  return complete(async ({ finish }) =>
    finish({
      output: {
        /* ... */
      },
    }),
  );
};
```

### `wrapStep` — wrap intermediate transactions

Use to inject context into each `step` call — metrics recorders, progress trackers, shared resources that need the transaction context. The middleware runs inside each `step` transaction.

```ts
const metrics: AttemptMiddleware<typeof stateAdapter, {}, {}, { metrics: Metrics }> = {
  wrapStep: async ({ job, txSql, next }) => {
    const metrics = new Metrics(job.id, txSql);
    return next({ metrics });
  },
};
```

Inside the handler, `metrics` is typed on the step callback:

```ts
await step(async ({ metrics }) => {
  metrics.record("batch-processed", batch.length);
  // ...
});
```

### `wrapComplete` — inject helpers used during complete

Use to inject helpers that are only meaningful in the complete transaction — audit recorders, usage meters, post-commit notifiers.

```ts
const audit: AttemptMiddleware<
  typeof stateAdapter,
  {},
  {},
  {},
  { audit: (event: string) => Promise<void> }
> = {
  wrapComplete: async ({ job, txSql, next }) =>
    next({
      audit: async (event) =>
        void (await txSql`INSERT INTO audit (job_id, event) VALUES (${job.id}, ${event})`),
    }),
};
```

Because the helper writes through the complete transaction, its rows commit with the job — and roll back with the attempt if the handler throws.

```ts
return complete(async ({ finish, audit }) => {
  audit("order-placed");
  return finish({
    output: {
      /* ... */
    },
  });
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

- [Showcase example](https://github.com/kvet/queuert/tree/main/examples/showcase-middleware) — runnable end-to-end demo of middleware hooks
- [Worker reference](/queuert/api/core/type-aliases/attemptmiddleware/) — full API
- [Slices guide](/queuert/guides/slices/) — splitting workflows across registries
