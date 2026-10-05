# Attempt Middleware Showcase

A multi-tenant billing worker whose cross-cutting concerns live in `AttemptMiddleware` instead of in each handler:

Each middleware is a `wrapHandler` that injects typed context into the handler:

- **logging** — an attempt-scoped `log` tagged with worker, job type and attempt
- **tenant** — loads the tenant row before the handler runs
- **metering** — a `meter()` that records billable units in the transaction the handler passes it, never double-bills a retried attempt, and reports to the metrics backend only after commit

The middleware are typed against the concrete state adapter (`typeof stateAdapter`), and `meter()` takes the handler's typed `txSql`.

The second scenario fails the first `send-receipt` attempt after metering inside its `finish` transaction: the transaction rolls the usage record back and metrics never see it, while the unit committed earlier in its own transaction is deduplicated instead of billed twice.

## Running

```bash
bun install
bun run --filter example-showcase-middleware start
```

See the [Middleware guide](../../docs/src/content/docs/guides/middleware.md) for a task-oriented walkthrough.
