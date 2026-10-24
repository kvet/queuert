---
title: Job Attempt Middleware
description: Wrap job attempts with cross-cutting logic — tracing, resource injection, audit, contextual logging.
sidebar:
  order: 19
---

`AttemptMiddleware` wraps a **job attempt** — the attempt handler, from the moment the worker acquires the job until the handler returns its `complete` result. Middleware lets you add cross-cutting logic (tracing spans, contextual loggers, audit trails, shared resources) without touching each individual handler.

A middleware has a single hook, `wrapHandler`, which wraps the whole attempt handler. It receives a `next(ctx)` call that yields the inner layer; the object passed to `next` is merged into the `attemptHandler` options, and its type flows into the handler signature. `wrapHandler` must return what `next` returned — the handler's `complete` result.

See the [Worker reference](/queuert/api/core/type-aliases/attemptmiddleware/) for the full type definition.

## Use cases

### Cross-cutting around the whole attempt

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

A failing attempt propagates through `next()` — the middleware can observe, log, or enrich the error. After the middleware chain unwinds, the engine catches the error, reschedules the job, and returns normally. Always re-throw the error so the engine can handle it; swallowing the error without a committed `complete` still fails the attempt.

Inside the handler, `traceId` is typed:

```ts
attemptHandler: async ({ traceId, complete }) => {
  return withTransactionHooks(async (transactionHooks) =>
    sql.begin(async (txSql) =>
      complete({
        txSql,
        transactionHooks,
        output: {/* ... */},
      }),
    ),
  );
};
```

### Load shared data before the handler

Use when you want to load a resource once per attempt and make it available to the handler. The middleware runs outside any transaction, so it reads through your database client directly.

```ts
const loadUser: AttemptMiddleware<typeof stateAdapter, { user: User }> = {
  wrapHandler: async ({ job, next }) => {
    const { userId } = job.input as { userId: string };
    const [user] = await sql`SELECT * FROM users WHERE id = ${userId}`;
    return next({ user });
  },
};
```

Middleware is not tied to a job type, so `job.input` is `unknown` — narrow it (or validate it) before use.

The handler receives the injected ctx directly:

```ts
attemptHandler: async ({ user, complete }) => {
  return withTransactionHooks(async (transactionHooks) =>
    sql.begin(async (txSql) =>
      complete({
        txSql,
        transactionHooks,
        output: {/* ... */},
      }),
    ),
  );
};
```

### Inject helpers used in the handler's transaction

Use to inject helpers that write alongside `complete` — audit recorders, usage meters. The handler owns the transaction, so the helper takes the transaction context from the handler.

```ts
const audit: AttemptMiddleware<
  typeof stateAdapter,
  { audit: (txSql: TransactionSql, event: string) => Promise<void> }
> = {
  wrapHandler: async ({ job, next }) =>
    next({
      audit: async (txSql, event) =>
        void (await txSql`INSERT INTO audit (job_id, event) VALUES (${job.id}, ${event})`),
    }),
};
```

Because the helper writes through the handler's transaction, its rows commit with the job — and roll back with it if `complete` throws or the transaction fails.

```ts
return withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    await audit(txSql, "order-placed");
    return complete({
      txSql,
      transactionHooks,
      output: {/* ... */},
    });
  }),
);
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
  processors: {/* ... */},
});
```

To share a common set of middleware across multiple registries (e.g. multiple [slices](/queuert/guides/slices/) merged into one worker), list them inline at each call site:

```ts
const orderRegistry = createProcessors({
  client,
  jobTypes,
  attemptMiddleware: [tracing, log, auditOrders],
  processors: {/* ... */},
});

const notificationRegistry = createProcessors({
  client,
  jobTypes,
  attemptMiddleware: [tracing, log, auditNotifications],
  processors: {/* ... */},
});
```

Per slice, handler ctx types reflect the actual middleware list for that registry — so `auditOrders` ctx is visible in order handlers but not notification handlers. Inline literals narrow tuple inference automatically; no `as const` is required.

## See also

- [Showcase example](https://github.com/kvet/queuert/tree/main/examples/showcase-middleware) — runnable end-to-end demo of middleware
- [Worker reference](/queuert/api/core/type-aliases/attemptmiddleware/) — full API
- [Slices guide](/queuert/guides/slices/) — splitting workflows across registries
