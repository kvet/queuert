# Attempt Middleware Showcase

Composes two `AttemptMiddleware` instances to demonstrate all four hooks (`wrapHandler`, `wrapPrepare`, `wrapExecute`, `wrapComplete`) and how typed ctx flows into the handler.

## Running

```bash
bun install
bun run --filter example-showcase-middleware start
```

See the [Middleware guide](../../docs/src/content/docs/guides/middleware.md) for a task-oriented walkthrough.
