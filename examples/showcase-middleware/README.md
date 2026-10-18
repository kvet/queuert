# Attempt Middleware Showcase

A multi-tenant billing worker whose cross-cutting concerns live in `AttemptMiddleware` instead of in each handler:

- **`wrapHandler`** — an attempt-scoped logger tagged with worker, job type and attempt
- **`wrapPrepare`** — loads the tenant row inside the prepare transaction
- **`wrapComplete`** — a usage `meter()` that records billable units in the same transaction as the job, so a failed attempt bills nothing, and reports to the metrics backend only after commit

The middleware are typed against the concrete state adapter (`typeof stateAdapter`), so every hook gets a fully typed `sql`.

The second scenario fails the first `send-receipt` attempt after metering: the savepoint rolls the usage record back and metrics never see it, and the retry bills the unit exactly once.

## Running

```bash
pnpm install
pnpm --filter example-showcase-middleware start
```

See the [Middleware guide](../../docs/src/content/docs/guides/middleware.md) for a task-oriented walkthrough.
