# Attempt Middleware Showcase

A multi-tenant billing worker whose cross-cutting concerns live in `AttemptMiddleware` instead of in each handler:

- **`wrapHandler`** — an attempt-scoped logger tagged with worker, job type and attempt
- **`wrapPrepare`** — loads the tenant row inside the prepare transaction
- **`wrapStep` / `wrapComplete`** — a usage `meter()` that records billable units in the same transaction as the job, never double-bills a retried attempt, and reports to the metrics backend only after commit

The middleware are typed against the concrete state adapter (`typeof stateAdapter`), so every hook gets a fully typed `sql`.

The second scenario fails the first `send-receipt` attempt after metering: the savepoint rolls the usage record back and metrics never see it, while the unit committed earlier by `step` is deduplicated instead of billed twice.

## Running

```bash
bun install
bun run --filter example-showcase-middleware start
```

See the [Middleware guide](../../docs/src/content/docs/guides/middleware.md) for a task-oriented walkthrough.
