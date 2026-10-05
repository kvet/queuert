---
title: Job Attempt Middleware
description: Wrap job attempts with cross-cutting logic — tracing, resource injection, error classification, contextual logging.
sidebar:
  order: 19
---

`AttemptMiddleware` wraps a **job attempt** — the attempt handler, from the moment the worker hands it the job until it returns. Middleware lets you add cross-cutting logic (tracing spans, contextual loggers, error classification, shared resources) without touching each individual handler.

A middleware has one hook, `wrapHandler`. It receives the running `job`, the `workerId` and a `next(ctx)` callback that runs the inner layer. The object passed to `next` is merged into the `attemptHandler` options, and its type flows into the handler signature. `wrapHandler` must return what `next` returned — the handler's `finish` result.

See the [Worker reference](/queuert/api/core/type-aliases/attemptmiddleware/) for the full type definition.

## Wrapping the attempt

Use `wrapHandler` for concerns that span the full attempt: tracing spans, contextual loggers, per-job resources, error classification.

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

A failing attempt propagates through `next()` — the middleware can observe, log, or enrich the error. After the middleware chain unwinds, the worker checks whether a `finish` committed and, if not, reschedules the job with backoff. Always re-throw the error; swallowing it does not help, since a handler without a committed `finish` still fails the attempt.

Inside the handler, `traceId` is typed:

```ts
attemptHandler: async ({ traceId, finish }) =>
  withTransactionHooks(async (transactionHooks) =>
    db.transaction(async (tx) =>
      finish({
        tx,
        transactionHooks,
        output: {/* ... */},
      }),
    ),
  );
```

### Injecting shared resources

Middleware is not tied to a job type, so `job.input` is `unknown` — narrow it (or validate it) before use.

```ts
const loadUser: AttemptMiddleware<typeof stateAdapter, { user: User }> = {
  wrapHandler: async ({ job, next }) => {
    const { userId } = job.input as { userId: string };
    const [user] = await sql`SELECT * FROM users WHERE id = ${userId}`;
    return next({ user });
  },
};
```

Middleware runs outside any transaction — Queuert opens none around the attempt. Work that must commit with the job's outcome, such as an audit row, belongs in the handler's own transaction, right before `finish`:

```ts
attemptHandler: async ({ job, user, finish }) =>
  withTransactionHooks(async (transactionHooks) =>
    sql.begin(async (txSql) => {
      await txSql`INSERT INTO audit (job_id, user_id, event) VALUES (${job.id}, ${user.id}, 'order-placed')`;
      return finish({ txSql, transactionHooks, output: {/* ... */} });
    }),
  );
```

## Composition and order

Multiple middlewares compose as an onion. The first middleware's "before" runs outermost:

```ts
attemptMiddleware: [tracing, loadUser];
// tracing before → loadUser before → handler → loadUser after → tracing after
```

Each `next(ctx)` call accumulates ctx for inner layers. The handler's final ctx is the intersection of all injected ctxs.

## Sharing middleware across registries

Middleware is declared on the processor registry, not the worker:

```ts
const registry = createProcessors({
  client,
  jobTypes,
  attemptMiddleware: [tracing, loadUser],
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

- [Showcase example](https://github.com/kvet/queuert/tree/main/examples/showcase-middleware) — runnable end-to-end demo of `wrapHandler` middleware
- [Worker reference](/queuert/api/core/type-aliases/attemptmiddleware/) — full API
- [Slices guide](/queuert/guides/slices/) — splitting workflows across registries
