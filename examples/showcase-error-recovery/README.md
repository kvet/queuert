# Error Recovery Showcase

Queuert's engine-level error recovery guarantees.

Scenarios: CHECK constraint violation in the handler's transaction (rolls back together with `complete`), a throw after `complete` inside the transaction (everything rolls back), a throw after the transaction committed (the completion is kept), a failed external call before the transaction opens, and `lastAttemptError` inspection on retry.

## Running

```bash
pnpm install
pnpm --filter example-showcase-error-recovery start
```
